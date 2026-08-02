// Server-only. Encrypted session cookie — there is no database, so the GitHub
// token travels in the cookie itself rather than in a session store.
//
// AES-256-GCM, so the cookie is both unreadable and tamper-evident: a modified
// byte fails the auth tag and decrypts to null rather than to attacker-chosen
// data. Hand-rolled on node:crypto to avoid a dependency for ~40 lines.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'ps_session';
export const STATE_COOKIE = 'ps_oauth_state';

export type Session = {
  /** GitHub user access token. */
  token: string;
  login: string;
  /** Seconds since epoch. */
  expiresAt: number;
};

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  // Hashed rather than used raw so any length of secret yields a valid 32-byte key.
  return createHash('sha256').update(secret).digest();
}

export function seal(value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    // Wrong key, tampered payload, or garbage. All are "not logged in".
    return null;
  }
}

export function readSession(sealed: string | undefined): Session | null {
  const session = unseal<Session>(sealed);
  if (!session?.token) return null;
  if (session.expiresAt && session.expiresAt < Math.floor(Date.now() / 1000)) return null;
  return session;
}

/// CSRF for the OAuth round trip: a nonce we mint, hand to GitHub, and require
/// back unchanged. Without it, an attacker can complete a login in a victim's
/// browser using their own authorization code.
export function signState(nonce: string): string {
  return createHmac('sha256', key()).update(nonce).digest('base64url');
}

export function stateMatches(returned: string | null, expected: string | undefined): boolean {
  if (!returned || !expected) return false;
  const a = Buffer.from(returned);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newState(): { nonce: string; state: string } {
  const nonce = randomBytes(16).toString('base64url');
  return { nonce, state: `${nonce}.${signState(nonce)}` };
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const [nonce, sig] = state.split('.');
  if (!nonce || !sig) return false;
  return stateMatches(sig, signState(nonce));
}
