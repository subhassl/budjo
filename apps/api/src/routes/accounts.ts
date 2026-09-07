import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { spendableAccounts, visibleAccounts } from '../domain/access';
import { buildSummaries } from '../services/summary';
import { listCardRules, listCards, listCategories } from '../db/repo';

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get('/me', async (c) => {
  const ctx = c.get('access');
  return c.json({
    user: c.get('user'),
    family: c.get('family'),
    accounts: visibleAccounts(ctx),
    spendableAccountIds: spendableAccounts(ctx).map((a) => a.id),
  });
});

/** The home screen in one call: balances, holds, this month, next month. */
accountRoutes.get('/accounts', async (c) => {
  const summaries = await buildSummaries(c.env.DB, c.get('access'), c.get('family'));
  return c.json({ accounts: summaries });
});

accountRoutes.get('/reference', async (c) => {
  const [categories, cards, cardRules] = await Promise.all([
    listCategories(c.env.DB),
    listCards(c.env.DB),
    listCardRules(c.env.DB),
  ]);
  return c.json({ categories, cards, cardRules });
});
