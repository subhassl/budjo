import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { spendableAccounts, visibleAccounts } from '../domain/access';
import { buildSummaries } from '../services/summary';
import { listCardRules, listCards, listCategories } from '../db/repo';
import { conflict } from '../lib/http';
import { nowIso } from '../lib/time';

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

/**
 * Your own passkeys and sessions. Not an admin screen: these are the keys to
 * your account, and you should be able to see and revoke them without asking
 * anyone.
 */
accountRoutes.get('/me/passkeys', async (c) => {
  const user = c.get('user');
  const [{ results: credentials }, { results: sessions }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, nickname, created_at, last_used_at FROM credentials
        WHERE user_id = ? ORDER BY created_at`,
    ).bind(user.id).all<{ id: string; nickname: string | null; created_at: string; last_used_at: string | null }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(user.id, nowIso()).all<{ n: number }>(),
  ]);

  return c.json({
    passkeys: credentials.map((cred) => ({
      id: cred.id,
      nickname: cred.nickname,
      createdAt: cred.created_at,
      lastUsedAt: cred.last_used_at,
    })),
    activeSessions: sessions[0]?.n ?? 0,
  });
});

accountRoutes.delete('/me/passkeys/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>();

  // Removing the last one would lock you out with no way back except an admin
  // minting an invite — and if you are the only admin, nothing at all.
  if ((row?.n ?? 0) <= 1) {
    throw conflict('That is your only passkey — add another device before removing this one');
  }

  await c.env.DB
    .prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .run();
  return c.json({ ok: true });
});

/** Sign out everywhere else, keeping this device signed in. */
accountRoutes.post('/me/sessions/revoke-others', async (c) => {
  const res = await c.env.DB
    .prepare(
      `UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
    )
    .bind(nowIso(), c.get('user').id, c.get('sessionId'))
    .run();
  return c.json({ revoked: res.meta?.changes ?? 0 });
});

accountRoutes.get('/reference', async (c) => {
  const [categories, cards, cardRules] = await Promise.all([
    listCategories(c.env.DB),
    listCards(c.env.DB),
    listCardRules(c.env.DB),
  ]);
  return c.json({ categories, cards, cardRules });
});
