import { Hono } from 'hono';
import {
  createSpendCheckSchema, quickSpendSchema, repriceSchema, settleSpendCheckSchema,
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
  const checks = await listChecksForAccounts(c.env.DB, accountIds, statuses);
  return c.json({ checks });
});

spendCheckRoutes.post('/spend-checks/:id/settle', idempotency, async (c) => {
  const parsed = settleSpendCheckSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());

  const ctx = c.get('access');
  const check = await getSpendCheck(c.env.DB, c.req.param('id'));
  if (!check) throw notFound('No such spend check');
  assertCanSpend(ctx, check.accountId);

  const settled = await settleSpendCheck(
    c.env.DB, ctx, c.get('family'), check.id, parsed.data.actualCents,
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
  const result = await quickSpend(c.env.DB, ctx, c.get('family'), parsed.data);
  return c.json(result);
});
