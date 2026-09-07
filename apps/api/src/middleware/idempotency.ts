import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { nowIso } from '../lib/time';

/**
 * Replays the stored response when a client retries a mutation with the same
 * Idempotency-Key. The offline queue in the PWA depends on this: a spend
 * submitted on a flaky connection must not become two spends.
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  const user = c.get('user');
  const scoped = `${user.id}:${key}`;

  const existing = await c.env.DB
    .prepare('SELECT response_json, status_code FROM idempotency_keys WHERE key = ?')
    .bind(scoped)
    .first<{ response_json: string; status_code: number }>();

  if (existing) {
    return new Response(existing.response_json, {
      status: existing.status_code,
      headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' },
    });
  }

  await next();

  const res = c.res;
  if (res.status < 400) {
    const body = await res.clone().text();
    await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys (key, user_id, request_hash, response_json, status_code, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(scoped, user.id, c.req.path, body, res.status, nowIso())
      .run();
  }
};
