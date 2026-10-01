import {
  dateOf, occurredAtFor, paymentSchedule, paymentsDue,
  type InstallmentPlan, type PlanTerms,
} from '@budjo/shared';
import { ledgerInsert } from './ledger';

interface PlanRow {
  id: string;
  account_id: string;
  description: string;
  total_cents: number;
  months: number;
  day_of_month: number;
  first_period: string;
  category_id: string | null;
  card_id: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
}

const termsOf = (row: PlanRow): PlanTerms => ({
  totalCents: row.total_cents,
  months: row.months,
  dayOfMonth: row.day_of_month,
  firstPeriod: row.first_period,
});

/** What the ledger says has been charged, per plan: payment number → cents. */
async function postedByPlan(db: D1Database, planId?: string): Promise<Map<string, Map<number, number>>> {
  const { results } = await db
    .prepare(
      `SELECT installment_plan_id AS plan_id, installment_no AS no, amount_cents
         FROM ledger_entries
        WHERE installment_plan_id IS NOT NULL ${planId ? 'AND installment_plan_id = ?' : ''}`,
    )
    .bind(...(planId ? [planId] : []))
    .all<{ plan_id: string; no: number; amount_cents: number }>();

  const out = new Map<string, Map<number, number>>();
  for (const row of results) {
    if (!out.has(row.plan_id)) out.set(row.plan_id, new Map());
    out.get(row.plan_id)!.set(row.no, -row.amount_cents);
  }
  return out;
}

/**
 * Inserts for every payment that has fallen due and is not in the ledger yet.
 *
 * Catches up as far back as it needs to: a plan entered after its first few
 * payments, or a job that did not run for a week, both end with every due
 * payment posted in the month it belonged to. Safe to run any number of times —
 * a unique index on (plan, payment number) drops the repeats.
 *
 * A payment posts whether or not the account can afford it. The money is owed
 * to the lender either way; refusing to record it would only make the balance
 * lie.
 */
export async function duePaymentStatements(
  db: D1Database,
  timeZone: string,
  now = new Date(),
  planId?: string,
): Promise<D1PreparedStatement[]> {
  const { results: plans } = await db
    .prepare(
      `SELECT * FROM installment_plans
        WHERE cancelled_at IS NULL ${planId ? 'AND id = ?' : ''}`,
    )
    .bind(...(planId ? [planId] : []))
    .all<PlanRow>();
  if (plans.length === 0) return [];

  const posted = await postedByPlan(db, planId);
  const today = dateOf(now, timeZone);
  const statements: D1PreparedStatement[] = [];

  for (const plan of plans) {
    const done = new Set(posted.get(plan.id)?.keys() ?? []);
    for (const payment of paymentsDue(termsOf(plan), done, today)) {
      statements.push(
        ledgerInsert(db, {
          accountId: plan.account_id,
          actorUserId: plan.created_by,
          type: 'spend',
          amountCents: -payment.amountCents,
          period: payment.period,
          categoryId: plan.category_id,
          cardId: plan.card_id,
          note: `${plan.description} (${payment.no} of ${plan.months})`,
          occurredAt: occurredAtFor(payment.date, timeZone, now),
          createdBy: plan.created_by,
          installmentPlanId: plan.id,
          installmentNo: payment.no,
        }),
      );
    }
  }
  return statements;
}

export async function listPlans(
  db: D1Database,
  accountIds: readonly string[],
  canManage: (accountId: string) => boolean,
): Promise<InstallmentPlan[]> {
  if (accountIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT * FROM installment_plans
        WHERE account_id IN (${accountIds.map(() => '?').join(',')})
        ORDER BY created_at DESC`,
    )
    .bind(...accountIds)
    .all<PlanRow>();

  const posted = await postedByPlan(db);

  return results.map((row) => {
    const paid = posted.get(row.id) ?? new Map<number, number>();
    const payments = paymentSchedule(termsOf(row)).map((p) => ({ ...p, posted: paid.has(p.no) }));
    const unpaid = payments.filter((p) => !p.posted);
    const cancelled = row.cancelled_at !== null;
    const status = cancelled ? 'cancelled' : unpaid.length === 0 ? 'completed' : 'active';
    const open = status === 'active' ? unpaid : [];

    return {
      id: row.id,
      accountId: row.account_id,
      description: row.description,
      totalCents: row.total_cents,
      months: row.months,
      dayOfMonth: row.day_of_month,
      firstPeriod: row.first_period,
      categoryId: row.category_id,
      cardId: row.card_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      cancelledAt: row.cancelled_at,
      status,
      monthlyCents: payments[0]!.amountCents,
      paidCount: paid.size,
      paidCents: [...paid.values()].reduce((t, c) => t + c, 0),
      remainingCents: open.reduce((t, p) => t + p.amountCents, 0),
      remainingCount: open.length,
      next: open[0] ? { no: open[0].no, date: open[0].date, period: open[0].period, amountCents: open[0].amountCents } : null,
      payments,
      canManage: canManage(row.account_id),
    };
  });
}
