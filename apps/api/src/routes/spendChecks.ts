import { Hono } from 'hono';
import {
  createSpendCheckSchema, dateOf, isCalendarDate, quickSpendSchema, repriceSchema,
  settleSpendCheckSchema,
} from '@budjo/shared';
import type { AppEnv } from '../env';
import { assertCanSpend, assertCanView } from '../domain/access';
import {
  cancelSpendCheck, createSpendCheck, listChecksForAccounts, quickSpend,
  repriceSpendCheck, settleSpendCheck,
} from '../services/spendChecks';
import { getSpendCheck } from '../db/repo';
import { badRequest, notFound } from '../lib/http';
import { idempotency } from '../middleware/idempotency';
import { visibleAccounts } from '../domain/access';

export const spendCheckRoutes = new Hono<AppEnv>();

/**
 * You can record something you forgot to log, but not something that hasn't
 * happened. A future-dated spend would sit in a month the allocation hasn't
 * reached, which is a budgeting question this app deliberately doesn't answer.
 */
function assertPastOrToday(occurredOn: string | undefined, timezone: string): void {
  if (!occurredOn) return;
  if (!isCalendarDate(occurredOn)) throw badRequest('That is not a real date');
  if (occurredOn > dateOf(new Date(), timezone)) {
    throw badRequest('You cannot log a spend in the future');
  }
}

spendCheckRoutes.post('/spend-checks', idempotency, async (c) => {
  const parsed = createSpendCheckSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  assertCanSpend(ctx, parsed.data.accountId);

  const result = await createSpendCheck(c.env.DB, ctx, c.get('family'), parsed.data);
  return c.json(result);
});

spendCheckRoutes.get('/spend-checks', async (c) => {
  const ctx = c.get('access');
  const status = c.req.query('status') ?? 'pending';
  const statuses = status === 'all'
    ? ['pending', 'settled', 'cancelled', 'expired', 'denied']
    : status.split(',');
  const accountIds = visibleAccounts(ctx).map((a) => a.id);
  const checks = await listChecksForAccounts(c.env.DB, accountIds, statuses,
    status === 'all' ? {} : { maxAgeDays: 30 });
  return c.json({ checks });
});

spendCheckRoutes.post('/spend-checks/:id/settle', idempotency, async (c) => {
  const parsed = settleSpendCheckSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  const check = await getSpendCheck(c.env.DB, c.req.param('id'));
  if (!check) throw notFound('No such spend check');
  assertCanSpend(ctx, check.accountId);

  assertPastOrToday(parsed.data.occurredOn, c.get('family').timezone);
  const settled = await settleSpendCheck(
    c.env.DB, ctx, c.get('family'), check.id, parsed.data.actualCents,
    parsed.data.occurredOn ? { occurredOn: parsed.data.occurredOn } : {},
  );
  return c.json({ check: settled });
});

spendCheckRoutes.post('/spend-checks/:id/cancel', async (c) => {
  const ctx = c.get('access');
  const check = await getSpendCheck(c.env.DB, c.req.param('id'));
  if (!check) throw notFound('No such spend check');
  assertCanSpend(ctx, check.accountId);
  return c.json({ check: await cancelSpendCheck(c.env.DB, check.id) });
});

/** "Spend from Joint instead" — re-run this check against another account. */
spendCheckRoutes.post('/spend-checks/:id/reprice', async (c) => {
  const parsed = repriceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  const check = await getSpendCheck(c.env.DB, c.req.param('id'));
  if (!check) throw notFound('No such spend check');
  assertCanView(ctx, check.accountId);
  assertCanSpend(ctx, parsed.data.accountId);

  const result = await repriceSpendCheck(
    c.env.DB, ctx, c.get('family'), check.id, parsed.data.accountId,
  );
  return c.json(result);
});

/** One-tap "already spent it". */
spendCheckRoutes.post('/spends', idempotency, async (c) => {
  const parsed = quickSpendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  assertCanSpend(ctx, parsed.data.accountId);
  assertPastOrToday(parsed.data.occurredOn, c.get('family').timezone);
  const result = await quickSpend(c.env.DB, ctx, c.get('family'), parsed.data);
  return c.json(result);
});
