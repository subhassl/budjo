import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE = 'budjo_session';
const CHALLENGE_COOKIE = 'budjo_challenge';
const SESSION_DAYS = 30;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  sub: string; // user id
  sid: string; // sessions.id, so a session can be revoked server-side
}

export async function signSession(secret: string, claims: SessionClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/**
 * The WebAuthn challenge rides in a short-lived signed cookie rather than a
 * database table: it's single-use, expires in minutes, and this keeps the
 * ceremony to two round trips with no cleanup job.
 */
export interface ChallengeClaims {
  challenge: string;
  userId: string;
  purpose: 'register' | 'login';
  inviteId?: string;
}

export async function signChallenge(secret: string, claims: ChallengeClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key(secret));
}

export async function verifyChallenge(secret: string, token: string): Promise<ChallengeClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    if (typeof payload.challenge !== 'string' || typeof payload.userId !== 'string') return null;
    return {
      challenge: payload.challenge,
      userId: payload.userId,
      purpose: payload.purpose === 'register' ? 'register' : 'login',
      inviteId: typeof payload.inviteId === 'string' ? payload.inviteId : undefined,
    };
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const sessionCookieName = SESSION_COOKIE;
export const challengeCookieName = CHALLENGE_COOKIE;

function baseAttrs(secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; ${baseAttrs(secure)}; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${baseAttrs(secure)}; Max-Age=0`;
}

export function challengeCookie(token: string, secure: boolean): string {
  return `${CHALLENGE_COOKIE}=${token}; ${baseAttrs(secure)}; Max-Age=300`;
}

export function clearChallengeCookie(secure: boolean): string {
  return `${CHALLENGE_COOKIE}=; ${baseAttrs(secure)}; Max-Age=0`;
}

export function sessionExpiryIso(from = new Date()): string {
  return new Date(from.getTime() + SESSION_DAYS * 86400_000).toISOString();
}
