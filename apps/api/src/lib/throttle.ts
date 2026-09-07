import { HttpError } from './http';

export interface ThrottleRule {
  /** What is being limited, e.g. 'invite-redeem'. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * A fixed-window counter in D1.
 *
 * Guessing an invite code is already infeasible — 34^8 is about 40 bits, so a
 * thousand guesses a second would take decades — but "infeasible" is not a
 * reason to let someone try forever unobserved. This caps the attempt rate and
 * leaves a row behind when someone does.
 *
 * Fixed windows allow up to twice the limit across a boundary. That is fine
 * here: the point is to stop sustained hammering, not to be exact.
 */
export async function enforceThrottle(
  db: D1Database,
  rule: ThrottleRule,
  clientId: string,
  now = new Date(),
): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule.name}:${clientId}:${windowStart.toISOString()}`;
  const expiresAt = new Date(windowStart.getTime() + windowMs).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_attempts (bucket_key, attempts, window_start, expires_at)
       VALUES (?1, 1, ?2, ?3)
       ON CONFLICT(bucket_key) DO UPDATE SET attempts = attempts + 1`,
    )
    .bind(key, windowStart.toISOString(), expiresAt)
    .run();

  const row = await db
    .prepare('SELECT attempts FROM auth_attempts WHERE bucket_key = ?')
    .bind(key)
    .first<{ attempts: number }>();

  if ((row?.attempts ?? 0) > rule.limit) {
    const retryAfter = Math.ceil((Date.parse(expiresAt) - now.getTime()) / 1000);
    throw new HttpError(429, 'Too many attempts — wait a minute and try again', {
      code: 'rate_limited',
      details: { retryAfterSeconds: Math.max(1, retryAfter) },
    });
  }
}

/** Best-effort caller identity. Cloudflare sets CF-Connecting-IP at the edge. */
export function clientIdFor(headers: Headers): string {
  return headers.get('CF-Connecting-IP') ?? headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Drop windows that have closed. Called from the daily maintenance pass. */
export async function pruneThrottleBuckets(db: D1Database, now = new Date()): Promise<number> {
  const res = await db
    .prepare('DELETE FROM auth_attempts WHERE expires_at <= ?')
    .bind(now.toISOString())
    .run();
  return res.meta?.changes ?? 0;
}
