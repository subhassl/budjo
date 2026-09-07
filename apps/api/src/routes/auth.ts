import { Hono, type Context } from 'hono';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { AppEnv } from '../env';
import { badRequest, forbidden, unauthorized } from '../lib/http';
import { isProduction } from '../env';
import { hashCode, newId, timingSafeEqual } from '../lib/ids';
import { nowIso } from '../lib/time';
import {
  challengeCookie, clearChallengeCookie, clearSessionCookie, challengeCookieName,
  readCookie, sessionCookie, sessionCookieName, sessionExpiryIso,
  signChallenge, signSession, verifyChallenge, verifySession,
} from '../lib/session';

/**
 * Passkeys only — there is no password column anywhere in the schema.
 *
 * Registration needs an admin-issued invite code. The one exception is the
 * bootstrap case: while *nobody* in the family has registered a credential yet,
 * a seeded user may be claimed without a code. That window closes permanently
 * the moment the first passkey exists, which is what makes it safe.
 */
export const authRoutes = new Hono<AppEnv>();

interface CredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

/**
 * The relying party for WebAuthn, and whether cookies get the Secure flag.
 *
 * Derived from the URL the Worker was actually reached on, NOT from the
 * client-supplied Origin header — otherwise a caller could nominate its own
 * expected origin, or ask for a cookie without Secure. The one exception is
 * local development, where the Vite proxy means the browser's origin
 * (localhost:5173) genuinely differs from the Worker's (localhost:8787).
 */
function rp(c: Context<AppEnv>) {
  const requestUrl = new URL(c.req.url);
  const live = isProduction(c.env);
  const origin = live ? requestUrl.origin : (c.req.header('Origin') ?? requestUrl.origin);
  return { origin, rpID: new URL(origin).hostname, secure: live };
}

async function credentialCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM credentials').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Who can be claimed right now, if the deployment has never been used. */
authRoutes.get('/bootstrap', async (c) => {
  const count = await credentialCount(c.env.DB);
  if (count > 0) return c.json({ available: false, users: [] });
  const { results } = await c.env.DB
    .prepare(`SELECT id, display_name, role FROM users WHERE status = 'active' ORDER BY created_at`)
    .all<{ id: string; display_name: string; role: string }>();
  return c.json({
    available: true,
    users: results.map((u) => ({ id: u.id, displayName: u.display_name, role: u.role })),
  });
});

authRoutes.post('/passkey/register/options', async (c) => {
  const body: { code?: string; userId?: string } =
    await c.req.json<{ code?: string; userId?: string }>().catch(() => ({}));
  const { rpID, secure } = rp(c);

  let userId: string | undefined;
  let inviteId: string | undefined;

  if (body.code) {
    const codeHash = await hashCode(body.code, c.env.SESSION_SECRET);
    const invite = await c.env.DB
      .prepare(`SELECT id, user_id, code_hash, expires_at, used_at FROM invites WHERE code_hash = ?`)
      .bind(codeHash)
      .first<{ id: string; user_id: string; code_hash: string; expires_at: string; used_at: string | null }>();
    if (!invite || !timingSafeEqual(invite.code_hash, codeHash)) throw forbidden('That invite code is not valid');
    if (invite.used_at) throw forbidden('That invite code has already been used');
    if (invite.expires_at <= nowIso()) throw forbidden('That invite code has expired');
    userId = invite.user_id;
    inviteId = invite.id;
  } else if ((await credentialCount(c.env.DB)) === 0 && body.userId) {
    userId = body.userId; // first-run claim
  } else {
    throw forbidden('An invite code is required');
  }

  const user = await c.env.DB
    .prepare(`SELECT id, display_name, email FROM users WHERE id = ? AND status = 'active'`)
    .bind(userId)
    .first<{ id: string; display_name: string; email: string | null }>();
  if (!user) throw badRequest('No such user');

  const { results: existing } = await c.env.DB
    .prepare('SELECT credential_id, transports FROM credentials WHERE user_id = ?')
    .bind(user.id)
    .all<{ credential_id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName: c.env.APP_NAME ?? 'Budjo',
    rpID,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.email ?? user.display_name,
    userDisplayName: user.display_name,
    attestationType: 'none',
    excludeCredentials: existing.map((e) => ({
      id: e.credential_id,
      transports: e.transports ? (JSON.parse(e.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const token = await signChallenge(c.env.SESSION_SECRET, {
    challenge: options.challenge,
    userId: user.id,
    purpose: 'register',
    ...(inviteId ? { inviteId } : {}),
  });
  c.header('Set-Cookie', challengeCookie(token, secure));
  return c.json(options);
});

authRoutes.post('/passkey/register/verify', async (c) => {
  const { origin, rpID, secure } = rp(c);
  const token = readCookie(c.req.header('Cookie'), challengeCookieName);
  if (!token) throw badRequest('Registration timed out — start again');
  const claims = await verifyChallenge(c.env.SESSION_SECRET, token);
  if (!claims || claims.purpose !== 'register') throw badRequest('Registration timed out — start again');

  const response = await c.req.json();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: claims.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw badRequest('Could not verify that passkey');
  }

  const { credential } = verification.registrationInfo;
  const nickname = c.req.header('User-Agent')?.slice(0, 60) ?? null;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO credentials (id, user_id, credential_id, public_key, counter, transports, nickname, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      newId('cred'),
      claims.userId,
      credential.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      nickname,
      nowIso(),
    ),
  ];
  if (claims.inviteId) {
    statements.push(
      c.env.DB.prepare('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .bind(nowIso(), claims.inviteId),
    );
  }
  await c.env.DB.batch(statements);

  const sessionToken = await startSession(c.env.DB, c.env.SESSION_SECRET, claims.userId, c.req.header('User-Agent'));
  c.header('Set-Cookie', clearChallengeCookie(secure));
  c.header('Set-Cookie', sessionCookie(sessionToken, secure), { append: true });
  return c.json({ ok: true });
});

authRoutes.post('/passkey/login/options', async (c) => {
  const { rpID, secure } = rp(c);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    // Empty list: passkeys are discoverable, so the authenticator offers the
    // right one and login is a single tap with no username step.
    allowCredentials: [],
  });
  const token = await signChallenge(c.env.SESSION_SECRET, {
    challenge: options.challenge,
    userId: '',
    purpose: 'login',
  });
  c.header('Set-Cookie', challengeCookie(token, secure));
  return c.json(options);
});

authRoutes.post('/passkey/login/verify', async (c) => {
  const { origin, rpID, secure } = rp(c);
  const token = readCookie(c.req.header('Cookie'), challengeCookieName);
  if (!token) throw unauthorized('Sign-in timed out — try again');
  const claims = await verifyChallenge(c.env.SESSION_SECRET, token);
  if (!claims || claims.purpose !== 'login') throw unauthorized('Sign-in timed out — try again');

  const response = await c.req.json<{ id: string }>();
  const cred = await c.env.DB
    .prepare('SELECT id, user_id, credential_id, public_key, counter, transports FROM credentials WHERE credential_id = ?')
    .bind(response.id)
    .first<CredentialRow>();
  if (!cred) throw unauthorized('That passkey is not registered');

  const verification = await verifyAuthenticationResponse({
    response: response as never,
    expectedChallenge: claims.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.credential_id,
      publicKey: isoBase64URL.toBuffer(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? (JSON.parse(cred.transports) as never) : undefined,
    },
  });

  if (!verification.verified) throw unauthorized('Could not verify that passkey');

  const user = await c.env.DB
    .prepare('SELECT status FROM users WHERE id = ?')
    .bind(cred.user_id)
    .first<{ status: string }>();
  if (!user || user.status !== 'active') throw unauthorized('This account is disabled');

  await c.env.DB
    .prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, nowIso(), cred.id)
    .run();

  const sessionToken = await startSession(c.env.DB, c.env.SESSION_SECRET, cred.user_id, c.req.header('User-Agent'));
  c.header('Set-Cookie', clearChallengeCookie(secure));
  c.header('Set-Cookie', sessionCookie(sessionToken, secure), { append: true });
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const { secure } = rp(c);
  const token = readCookie(c.req.header('Cookie'), sessionCookieName);
  if (token) {
    const claims = await verifySession(c.env.SESSION_SECRET, token);
    if (claims) {
      await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
        .bind(nowIso(), claims.sid).run();
    }
  }
  c.header('Set-Cookie', clearSessionCookie(secure));
  return c.json({ ok: true });
});

async function startSession(
  db: D1Database,
  secret: string,
  userId: string,
  userAgent?: string,
): Promise<string> {
  const sid = newId('ses');
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent) VALUES (?,?,?,?,?)')
    .bind(sid, userId, sessionExpiryIso(), nowIso(), userAgent?.slice(0, 200) ?? null)
    .run();
  return signSession(secret, { sub: userId, sid });
}
