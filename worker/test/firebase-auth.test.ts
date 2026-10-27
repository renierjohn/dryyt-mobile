import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

const PROJECT = 'dryyt-7b40a';
const KID = 'test-kid';
let keys: CryptoKeyPair;
let jwk: JsonWebKey;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** A Firebase-style ID token signed with the test key; `claims` override the valid defaults. */
async function idToken(claims: Record<string, unknown> = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'firebase-uid-1',
    iat: now,
    auth_time: now,
    exp: now + 3600,
    email: 'Ana.Google@Example.com',
    email_verified: true,
    name: 'Ana Google',
    ...claims,
  };
  const signing = `${enc({ alg: 'RS256', kid: KID })}.${enc(body)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signing)));
  return `${signing}.${b64url(sig)}`;
}

const signIn = async (claims?: Record<string, unknown>, key?: CryptoKey) => api('/auth/firebase', { body: { id_token: await idToken(claims, key) } });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
});

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get('https://www.googleapis.com')
    .intercept({ path: '/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com' })
    .reply(200, { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }, { headers: { 'cache-control': 'public, max-age=0' } })
    .persist();
});
afterEach(() => fetchMock.deactivate());

describe('Google sign-in (Firebase Auth)', () => {
  it('creates a customer for a new verified email, then signs the same account in again', async () => {
    const first = await signIn({ email: 'new.google@example.com' });
    expect(first.status).toBe(201);
    expect(first.body.user).toMatchObject({ email: 'new.google@example.com', name: 'Ana Google', role: 'customer', phone: '' });
    expect(first.body.token).toEqual(expect.any(String));

    const again = await signIn({ email: 'new.google@example.com' });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
    // The new account has no usable password.
    expect((await api('/auth/login', { body: { email: 'new.google@example.com', password: 'password123' } })).status).toBe(401);
  });

  it('signs into the existing account with that email, keeping its role (one account per email)', async () => {
    const driver = await registerUser('driver');
    const email = (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(driver.user.id).first<{ email: string }>())!.email;
    const res = await signIn({ email: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: driver.user.id, role: 'driver' });
  });

  it('lets an unverified email (Facebook) create an account, but never sign into an existing one', async () => {
    const facebook = { email_verified: false, firebase: { sign_in_provider: 'facebook.com' } };
    const created = await signIn({ ...facebook, email: 'fb.only@example.com' });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: 'fb.only@example.com', role: 'customer' });

    const driver = await registerUser('driver');
    const email = (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(driver.user.id).first<{ email: string }>())!.email;
    const res = await signIn({ ...facebook, email });
    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('token');
  });

  it('refuses blocked accounts', async () => {
    const customer = await registerUser('customer');
    await env.DB.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(customer.user.id).run();
    const email = (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(customer.user.id).first<{ email: string }>())!.email;
    expect((await signIn({ email })).status).toBe(403);
  });

  it('rejects bad tokens and unverified emails', async () => {
    const other = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const now = Math.floor(Date.now() / 1000);
    expect((await signIn({}, other.privateKey)).status).toBe(401); // wrong signature
    expect((await signIn({ aud: 'another-project' })).status).toBe(401);
    expect((await signIn({ iss: 'https://securetoken.google.com/another-project' })).status).toBe(401);
    expect((await signIn({ exp: now - 3600 })).status).toBe(401);
    expect((await signIn({ email: undefined })).status).toBe(401);
    expect((await api('/auth/firebase', { body: { id_token: 'not-a-jwt' } })).status).toBe(401);
  });
});
