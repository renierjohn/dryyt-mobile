import type { Bindings } from '../types';
import { fail } from './http';

/** Google's public keys for Firebase Auth ID tokens, as JWKs. */
const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

type Jwk = JsonWebKey & { kid: string };
type Claims = {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  firebase?: { sign_in_provider?: string };
};

/** Keys by kid, kept for as long as Google's Cache-Control allows (they rotate about daily). */
let cache: { keys: Map<string, CryptoKey>; until: number } | null = null;

async function publicKey(kid: string) {
  if (!cache || Date.now() >= cache.until || !cache.keys.has(kid)) {
    const res = await fetch(KEYS_URL);
    if (!res.ok) fail(503, 'Google sign-in is unavailable, try again');
    const { keys } = (await res.json()) as { keys: Jwk[] };
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    const imported = await Promise.all(
      keys.map(async (k) => [k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])] as const),
    );
    cache = { keys: new Map(imported), until: Date.now() + maxAge * 1000 };
  }
  return cache.keys.get(kid) ?? null;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
const decodeJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64url(s)));

/**
 * The email (and whether Firebase verified it), name and sign-in provider in a Firebase Auth ID token for this project,
 * or a 401. Checks the RS256 signature
 * against Google's keys and the claims Firebase documents (iss, aud, exp, iat, auth_time, sub).
 */
export async function verifyFirebaseToken(env: Pick<Bindings, 'FIREBASE_PROJECT_ID'>, token: string) {
  const invalid = () => fail(401, 'Google sign-in failed, try again');
  const parts = token.split('.');
  if (parts.length !== 3) invalid();
  let header: { alg: string; kid: string };
  let claims: Claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    invalid();
  }
  if (header!.alg !== 'RS256') invalid();
  const key = await publicKey(header!.kid);
  if (!key) invalid();
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key!, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) invalid();

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID;
  const c = claims!;
  // A minute of leeway for clock skew.
  if (c.aud !== project || c.iss !== `https://securetoken.google.com/${project}` || !c.sub || c.exp < now - 60 || c.iat > now + 60 || c.auth_time > now + 60) {
    invalid();
  }
  if (!c.email) fail(401, 'Your account has no email. Add one to it, or sign up with your email.');
  return {
    email: c.email.toLowerCase(),
    // Google emails are verified; Facebook ones usually come through unverified.
    emailVerified: c.email_verified === true,
    name: c.name?.trim() || c.email.split('@')[0],
    provider: c.firebase?.sign_in_provider ?? '',
  };
}
