import {
  occurredAtFor, periodFromDate, periodOf,
  type DecisionResult, type FamilySettings, type Remedy, type SpendCheck,
} from '@budjo/shared';
import { decide, isOverdrawnSettlement } from '../domain/decision';
import { advanceLimitCents, amountForPeriod } from '../domain/allocation';
import { canSpendFromAccount, canTakeAdvance, type AccessContext } from '../domain/access';
import { getAllocationRules, getBalance, getBalances, getOpenAdvances, getSpendCheck } from '../db/repo';
import { toSpendCheck, type SpendCheckRow } from '../db/rows';
import { ledgerInsert } from './ledger';
import { newId } from '../lib/ids';
import { isoPlusHours, nowIso } from '../lib/time';
import { conflict, notFound } from '../lib/http';

export interface CreateCheckInput {
  accountId: string;
  estimatedCents: number;
  categoryId?: string | null;
  cardId?: string | null;
  merchant?: string | null;
  note?: string | null;
}

export interface CreateCheckResult {
  check: SpendCheck;
  result: DecisionResult;
  remedies: Remedy[];
}

/**
 * Create a spend check and return its verdict.
 *
 * There is no override: a DENIED check is recorded and terminal, and the user
 * is handed the remedies that actually apply to them. Because the decision is
 * a read followed by a write, the insert carries its own guard (see below) so
 * two checks racing for the last $50 cannot both land — which matters for the
 * joint account, where both of us can be in different shops at once.
 */
export async function createSpendCheck(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  input: CreateCheckInput,
  now = new Date(),
): Promise<CreateCheckResult> {
  const iso = nowIso(now);
  const balance = await getBalance(db, input.accountId, iso);
  const result = decide({
    amountCents: input.estimatedCents,
    balanceCents: balance.balanceCents,
    holdCents: balance.holdCents,
    reserveThresholdCents: family.reserveThresholdCents,
  });

  const id = newId('chk');
  const expiresAt = isoPlusHours(family.holdTtlHours, now);
  const base = {
    id,
    accountId: input.accountId,
    actorUserId: ctx.user.id,
    estimatedCents: input.estimatedCents,
    categoryId: input.categoryId ?? null,
    cardId: input.cardId ?? null,
    merchant: input.merchant ?? null,
    note: input.note ?? null,
    decisionAvailableCents: result.availableCents,
    expiresAt,
    createdAt: iso,
  };

  if (result.decision === 'denied') {
    await insertCheck(db, { ...base, decision: 'denied', status: 'denied' });
    return {
      check: (await getSpendCheck(db, id))!,
      result,
      remedies: await buildRemedies(db, ctx, family, input.accountId, result.shortfallCents, iso),
    };
  }

  // Guarded insert: the row only lands if the account still has the money at
  // write time. If someone beat us to it the insert writes nothing, and we
  // report the denial from freshly-read numbers rather than the stale read.
  await insertCheck(db, { ...base, decision: result.decision, status: 'pending' }, { guard: true, iso });

  const landed = await getSpendCheck(db, id);
  if (!landed) {
    const fresh = await getBalance(db, input.accountId, iso);
    const raced = decide({
      amountCents: input.estimatedCents,
      balanceCents: fresh.balanceCents,
      holdCents: fresh.holdCents,
      reserveThresholdCents: family.reserveThresholdCents,
    });
    await insertCheck(db, {
      ...base,
      decisionAvailableCents: raced.availableCents,
      decision: 'denied',
      status: 'denied',
    });
    return {
      check: (await getSpendCheck(db, id))!,
      result: { ...raced, decision: 'denied' },
      remedies: await buildRemedies(db, ctx, family, input.accountId, raced.shortfallCents || 1, iso),
    };
  }

  return { check: landed, result, remedies: [] };
}

interface InsertArgs {
  id: string;
  accountId: string;
  actorUserId: string;
  estimatedCents: number;
  categoryId: string | null;
  cardId: string | null;
  merchant: string | null;
  note: string | null;
  decision: 'approved' | 'tight' | 'denied';
  decisionAvailableCents: number;
  status: 'pending' | 'denied';
  expiresAt: string;
  createdAt: string;
}

async function insertCheck(
  db: D1Database,
  a: InsertArgs,
  guard?: { guard: true; iso: string },
): Promise<void> {
  const columns = `(id, account_id, actor_user_id, estimated_cents, category_id, card_id, merchant,
                    note, decision, decision_available_cents, status, overdrawn, expires_at, created_at)`;
  const values = `?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,?13`;

  const sql = guard
    ? `INSERT INTO spend_checks ${columns}
       SELECT ${values}
        WHERE ?4 <= (
          COALESCE((SELECT SUM(amount_cents) FROM ledger_entries WHERE account_id = ?2), 0)
          - COALESCE((SELECT SUM(estimated_cents) FROM spend_checks
                       WHERE account_id = ?2 AND status = 'pending' AND expires_at > ?14), 0))`
    : `INSERT INTO spend_checks ${columns} VALUES (${values})`;

  const stmt = db.prepare(sql).bind(
    a.id, a.accountId, a.actorUserId, a.estimatedCents, a.categoryId, a.cardId, a.merchant,
    a.note, a.decision, a.decisionAvailableCents, a.status, a.expiresAt, a.createdAt,
    ...(guard ? [guard.iso] : []),
  );
  await stmt.run();
}

/**
 * What a denied check offers instead. Only remedies this user can actually
 * carry out appear — a child with no joint access and advances turned off sees
 * neither, and is told to ask a parent.
 */
export async function buildRemedies(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  deniedAccountId: string,
  shortfallCents: number,
  iso: string,
): Promise<Remedy[]> {
  const remedies: Remedy[] = [];
  const balances = await getBalances(db, iso);
  const byId = new Map(balances.map((b) => [b.accountId, b]));

  const deniedAmountNeeded = (byId.get(deniedAccountId)?.availableCents ?? 0) + shortfallCents;

  for (const account of ctx.accounts) {
    if (account.id === deniedAccountId) continue;
    if (!canSpendFromAccount(ctx, account.id)) continue;
    const available = byId.get(account.id)?.availableCents ?? 0;
    if (available >= deniedAmountNeeded) {
      remedies.push({
        kind: 'switch_account',
        label: `Spend from ${account.name}`,
        accountId: account.id,
        availableCents: available,
        shortfallCents,
      });
    }
  }

  if (canTakeAdvance(ctx, deniedAccountId)) {
    const [rules, advances] = await Promise.all([
      getAllocationRules(db, deniedAccountId),
      getOpenAdvances(db, deniedAccountId),
    ]);
    const period = periodOf(new Date(iso), family.timezone);
    const monthly = amountForPeriod(rules.get(deniedAccountId) ?? [], period) ?? 0;
    const account = ctx.accounts.find((a) => a.id === deniedAccountId)!;
    const outstanding = (advances.get(deniedAccountId) ?? []).reduce((s, a) => s + a.amountCents, 0);
    const headroom = advanceLimitCents({
      maxAdvanceCents: account.maxAdvanceCents,
      monthlyAllocationCents: monthly,
      alreadyOutstandingCents: outstanding,
    });
    if (headroom >= shortfallCents && shortfallCents > 0) {
      remedies.push({
        kind: 'advance',
        label: 'Take an advance from next month',
        accountId: deniedAccountId,
        availableCents: headroom,
        shortfallCents,
      });
    }
  }

  return remedies;
}

/**
 * Settling always succeeds — including when the actual amount overdraws the
 * account, and including on a check whose hold already expired. The money has
 * been spent; refusing to record it would only make the ledger wrong.
 */
export async function settleSpendCheck(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  checkId: string,
  actualCents: number,
  opts: { occurredOn?: string } = {},
  now = new Date(),
): Promise<SpendCheck> {
  const iso = nowIso(now);
  const check = await getSpendCheck(db, checkId);
  if (!check) throw notFound('No such spend check');
  if (check.status !== 'pending' && check.status !== 'expired') {
    throw conflict(`This check is already ${check.status}`);
  }

  const balance = await getBalance(db, check.accountId, iso);
  const ownHold = check.status === 'pending' && check.expiresAt > iso ? check.estimatedCents : 0;
  const availableExcludingThisHold = balance.balanceCents - (balance.holdCents - ownHold);
  const overdrawn = isOverdrawnSettlement(actualCents, availableExcludingThisHold);

  // A backdated spend belongs to the month it happened, not the month it was
  // typed in. The balance is a running sum over every entry, so this only moves
  // which month's "spent" total it lands in — no money appears or vanishes.
  const period = opts.occurredOn ? periodFromDate(opts.occurredOn) : periodOf(now, family.timezone);
  const occurredAt = opts.occurredOn
    ? occurredAtFor(opts.occurredOn, family.timezone, now)
    : iso;

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE spend_checks
          SET status = 'settled', actual_cents = ?, overdrawn = ?, settled_at = ?
        WHERE id = ? AND status IN ('pending','expired')`,
    ).bind(actualCents, overdrawn ? 1 : 0, iso, checkId),
  ];

  if (actualCents > 0) {
    statements.push(
      ledgerInsert(db, {
        accountId: check.accountId,
        actorUserId: ctx.user.id,
        type: 'spend',
        amountCents: -actualCents,
        period,
        categoryId: check.categoryId,
        cardId: check.cardId,
        spendCheckId: check.id,
        note: check.merchant ?? check.note,
        occurredAt,
        createdBy: ctx.user.id,
      }),
    );
  }

  await db.batch(statements);
  return (await getSpendCheck(db, checkId))!;
}

/**
 * Also accepts an expired check. A check whose hold timed out is still shown on
 * the home screen asking whether the money was spent, so "no, I didn't" has to
 * be answerable — otherwise the only way to clear it would be to record a spend
 * that never happened.
 */
export async function cancelSpendCheck(db: D1Database, checkId: string): Promise<SpendCheck> {
  const check = await getSpendCheck(db, checkId);
  if (!check) throw notFound('No such spend check');
  if (check.status !== 'pending' && check.status !== 'expired') {
    throw conflict(`This check is already ${check.status}`);
  }
  await db
    .prepare(
      `UPDATE spend_checks SET status = 'cancelled'
        WHERE id = ? AND status IN ('pending','expired')`,
    )
    .bind(checkId)
    .run();
  return (await getSpendCheck(db, checkId))!;
}

/**
 * "Spend from Joint instead" — the first remedy on a denied check, and equally
 * useful on an approved one when you realise the dinner was a joint dinner.
 * Implemented as cancel-and-recreate so the ledger keeps both intents visible.
 */
export async function repriceSpendCheck(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  checkId: string,
  targetAccountId: string,
  now = new Date(),
): Promise<CreateCheckResult> {
  const check = await getSpendCheck(db, checkId);
  if (!check) throw notFound('No such spend check');
  if (check.status !== 'pending' && check.status !== 'denied') {
    throw conflict(`This check is already ${check.status}`);
  }

  const created = await createSpendCheck(
    db, ctx, family,
    {
      accountId: targetAccountId,
      estimatedCents: check.estimatedCents,
      categoryId: check.categoryId,
      cardId: check.cardId,
      merchant: check.merchant,
      note: check.note,
    },
    now,
  );

  if (check.status === 'pending') {
    await db
      .prepare(`UPDATE spend_checks SET status = 'cancelled', superseded_by = ? WHERE id = ? AND status = 'pending'`)
      .bind(created.check.id, checkId)
      .run();
  } else {
    await db.prepare('UPDATE spend_checks SET superseded_by = ? WHERE id = ?').bind(created.check.id, checkId).run();
  }

  return created;
}

/** One-tap "already spent it": create and settle in a single call. */
export async function quickSpend(
  db: D1Database,
  ctx: AccessContext,
  family: FamilySettings,
  input: CreateCheckInput & { actualCents?: number; occurredOn?: string },
  now = new Date(),
): Promise<{ check: SpendCheck; result: DecisionResult; remedies: Remedy[] }> {
  const created = await createSpendCheck(db, ctx, family, input, now);
  if (created.check.status !== 'pending') return created;
  const settled = await settleSpendCheck(
    db, ctx, family, created.check.id,
    input.actualCents ?? input.estimatedCents,
    input.occurredOn ? { occurredOn: input.occurredOn } : {},
    now,
  );
  return { ...created, check: settled };
}

export async function listChecksForAccounts(
  db: D1Database,
  accountIds: readonly string[],
  statuses: readonly string[],
  opts: { limit?: number; maxAgeDays?: number } = {},
): Promise<SpendCheck[]> {
  if (accountIds.length === 0) return [];
  const { limit = 50, maxAgeDays } = opts;

  const clauses = [
    `account_id IN (${accountIds.map(() => '?').join(',')})`,
    `status IN (${statuses.map(() => '?').join(',')})`,
  ];
  const binds: unknown[] = [...accountIds, ...statuses];

  // Keeps a forgotten check from six months ago off the home screen while it
  // still shows the ones you might plausibly remember.
  if (maxAgeDays !== undefined) {
    clauses.push('created_at >= ?');
    binds.push(new Date(Date.now() - maxAgeDays * 86_400_000).toISOString());
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM spend_checks WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<SpendCheckRow>();
  return results.map(toSpendCheck);
}
