import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { assertCanView, visibleAccounts } from '../domain/access';
import { getCardTotals, getRefundedTotals, listLedger } from '../db/repo';

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

  // A bare 'to=2026-09-30' would exclude that whole day, since every timestamp
  // on it sorts after the bare date. Extend it to the end of the day.
  const to = c.req.query('to');
  const toBound = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;

  const page = await listLedger(c.env.DB, {
    accountIds,
    from: c.req.query('from'),
    to: toBound,
    periodFrom: c.req.query('periodFrom'),
    periodTo: c.req.query('periodTo'),
    categoryId: c.req.query('category'),
    cardId: c.req.query('card'),
    cursor: c.req.query('cursor'),
    limit: Number(c.req.query('limit') ?? 50),
  });

  // Tell the client how much has come back on each purchase, so a returned
  // item reads as returned rather than as two unrelated rows.
  const spendIds = page.entries.filter((e) => e.type === 'spend').map((e) => e.id);
  const refunded = await getRefundedTotals(c.env.DB, spendIds);

  return c.json({
    ...page,
    entries: page.entries.map((e) =>
      refunded.has(e.id) ? { ...e, refundedCents: refunded.get(e.id) } : e,
    ),
  });
});

/** Per-card totals under the same filters as the ledger list. */
ledgerRoutes.get('/reports/by-card', async (c) => {
  const ctx = c.get('access');
  const requested = c.req.query('account');

  let accountIds: string[];
  if (requested) {
    assertCanView(ctx, requested);
    accountIds = [requested];
  } else {
    accountIds = visibleAccounts(ctx).map((a) => a.id);
  }

  const to = c.req.query('to');
  const totals = await getCardTotals(c.env.DB, {
    accountIds,
    periodFrom: c.req.query('periodFrom'),
    periodTo: c.req.query('periodTo'),
    from: c.req.query('from'),
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to,
  });

  return c.json({ totals });
});
