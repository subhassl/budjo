import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { assertCanView, visibleAccounts } from '../domain/access';
import { listLedger } from '../db/repo';

export const ledgerRoutes = new Hono<AppEnv>();

ledgerRoutes.get('/ledger', async (c) => {
  const ctx = c.get('access');
  const requested = c.req.query('account');

  // Never widen beyond what this user may see: a member asking for someone
  // else's account gets a 404, not a filtered-but-present list.
  let accountIds: string[];
  if (requested) {
    assertCanView(ctx, requested);
    accountIds = [requested];
  } else {
    accountIds = visibleAccounts(ctx).map((a) => a.id);
  }

  const page = await listLedger(c.env.DB, {
    accountIds,
    from: c.req.query('from'),
    to: c.req.query('to'),
    categoryId: c.req.query('category'),
    cardId: c.req.query('card'),
    cursor: c.req.query('cursor'),
    limit: Number(c.req.query('limit') ?? 50),
  });

  return c.json(page);
});
