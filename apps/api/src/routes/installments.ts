import { Hono } from 'hono';
import {
  createInstallmentPlanSchema, dateOf, defaultFirstPeriod, nextPeriod, periodOf, prevPeriod,
} from '@budjo/shared';
import type { AppEnv } from '../env';
import { assertCanSpend, canSpendFromAccount, isAdmin, visibleAccounts } from '../domain/access';
import { auditInsert } from '../services/ledger';
import { duePaymentStatements, listPlans } from '../services/installments';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { idempotency } from '../middleware/idempotency';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

export const installmentRoutes = new Hono<AppEnv>();

const shift = (period: string, months: number) => {
  let p = period;
  for (let i = 0; i < Math.abs(months); i++) p = months < 0 ? prevPeriod(p) : nextPeriod(p);
  return p;
};

/** Every plan on an account the caller can see — active, finished and cancelled. */
installmentRoutes.get('/installments', async (c) => {
  const ctx = c.get('access');
  const plans = await listPlans(
    c.env.DB,
    visibleAccounts(ctx).map((a) => a.id),
    (accountId) => canSpendFromAccount(ctx, accountId) || isAdmin(ctx.user),
  );
  return c.json({ plans });
});

/**
 * Start a payment plan.
 *
 * Like logging a spend, this needs spend access on the account and nothing
 * more. There is no approval step and no affordability check: the purchase has
 * already been made, and the plan only records what is now owed each month.
 */
installmentRoutes.post('/installments', idempotency, async (c) => {
  const parsed = createInstallmentPlanSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
  const input = parsed.data;

  const ctx = c.get('access');
  assertCanSpend(ctx, input.accountId);

  if (input.totalCents < input.months) throw badRequest('That is less than a cent a month');

  const family = c.get('family');
  const now = new Date();
  const current = periodOf(now, family.timezone);
  const firstPeriod = input.firstPeriod
    ?? defaultFirstPeriod(dateOf(now, family.timezone), input.dayOfMonth);

  // Wide enough to enter a plan that is already part-paid, narrow enough to
  // catch a mistyped year before it posts three years of charges.
  if (firstPeriod < shift(current, -36) || firstPeriod > shift(current, 12)) {
    throw badRequest('The first payment has to be within the last three years or the next one');
  }

  const id = newId('pln');
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO installment_plans
           (id, account_id, description, total_cents, months, day_of_month, first_period,
            category_id, card_id, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, input.accountId, input.description, input.totalCents, input.months,
        input.dayOfMonth, firstPeriod, input.categoryId ?? null, input.cardId ?? null,
        ctx.user.id, nowIso(now),
      ),
    auditInsert(c.env.DB, ctx.user.id, 'installment.create', { type: 'installment_plan', id }, {
      ...input, firstPeriod,
    }),
  ]);

  // Anything already due — today's payment, or months that passed before the
  // plan was entered — is charged now rather than waiting for tonight's job.
  const due = await duePaymentStatements(c.env.DB, family.timezone, now, id);
  if (due.length > 0) await c.env.DB.batch(due);

  return c.json({ ok: true, id, postedNow: due.length }, 201);
});

/**
 * Stop a plan charging. What has already been charged stays in the ledger —
 * this is for paying something off early or returning it, not for undoing it.
 */
installmentRoutes.post('/installments/:id/cancel', async (c) => {
  const plan = await c.env.DB
    .prepare('SELECT id, account_id, cancelled_at FROM installment_plans WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; account_id: string; cancelled_at: string | null }>();
  if (!plan) throw notFound('No such payment plan');

  const ctx = c.get('access');
  if (!canSpendFromAccount(ctx, plan.account_id) && !isAdmin(ctx.user)) throw forbidden();
  if (plan.cancelled_at) throw conflict('That plan is already stopped');

  await c.env.DB.batch([
    c.env.DB
      .prepare('UPDATE installment_plans SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND cancelled_at IS NULL')
      .bind(nowIso(), ctx.user.id, plan.id),
    auditInsert(c.env.DB, ctx.user.id, 'installment.cancel', { type: 'installment_plan', id: plan.id }),
  ]);
  return c.json({ ok: true });
});
