const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'; // no l/o, easier to read aloud

/**
 * Rejection sampling rather than `byte % 34`.
 *
 * 256 is not a multiple of 34, so a plain modulo makes 18 of the 34 symbols
 * likelier than the other 16 — worth about 0.7 bits out of 40 on an invite
 * code. Immaterial against a real attacker, but a biased generator is the kind
 * of thing that is quietly wrong for years, and discarding the ragged tail of
 * the byte range costs nothing.
 */
function randomString(length: number): string {
  const limit = 256 - (256 % ALPHABET.length); // 238: the largest unbiased span
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length - out.length + 8);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Prefixed, sortable-ish ids: `chk_2f9k...`. Prefix makes logs readable. */
export function newId(prefix: string): string {
  return `${prefix}_${randomString(16)}`;
}

/** Human-typeable invite code, e.g. `4KP2-9WQ7`. */
export function newInviteCode(): string {
  const raw = randomString(8).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export async function hashCode(code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code.trim().toUpperCase()));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish comparison for hex digests. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
