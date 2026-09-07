import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { getFamily, getUser, listAccessibleAccountIds, listAccounts } from '../db/repo';
import { needsMaintenance, runMaintenance } from '../services/maintenance';
import { readCookie, sessionCookieName, verifySession } from '../lib/session';
import { unauthorized } from '../lib/http';
import { nowIso } from '../lib/time';

/**
 * Loads the caller and everything the access rules need to decide anything:
 * the user, the family settings, every account, and this user's access rows.
 *
 * Also carries the lazy half of the monthly allocation. Cron is the primary
 * path; this exists so a dormant deployment still allocates the moment someone
 * opens the app, and it does real work at most once a day.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readCookie(c.req.header('Cookie'), sessionCookieName);
  if (!token) throw unauthorized();

  const claims = await verifySession(c.env.SESSION_SECRET, token);
  if (!claims) throw unauthorized();

  const session = await c.env.DB
    .prepare('SELECT id, expires_at, revoked_at FROM sessions WHERE id = ? AND user_id = ?')
    .bind(claims.sid, claims.sub)
    .first<{ id: string; expires_at: string; revoked_at: string | null }>();
  if (!session || session.revoked_at || session.expires_at <= nowIso()) throw unauthorized();

  const user = await getUser(c.env.DB, claims.sub);
  if (!user) throw unauthorized();
  if (user.status !== 'active') throw unauthorized('This account is disabled');

  let family = await getFamily(c.env.DB);

  const lastRun = await c.env.DB
    .prepare('SELECT last_maintenance_at FROM family WHERE id = ?')
    .bind(family.id)
    .first<{ last_maintenance_at: string | null }>();
  if (needsMaintenance(lastRun?.last_maintenance_at ?? null)) {
    await runMaintenance(c.env.DB, family);
    family = await getFamily(c.env.DB);
  }

  const [accounts, accessibleAccountIds] = await Promise.all([
    listAccounts(c.env.DB),
    listAccessibleAccountIds(c.env.DB, user.id),
  ]);

  c.set('user', user);
  c.set('family', family);
  c.set('accounts', accounts);
  c.set('sessionId', session.id);
  c.set('access', { user, accounts, accessibleAccountIds });

  await next();
};
