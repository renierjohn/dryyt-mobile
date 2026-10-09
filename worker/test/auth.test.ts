import { describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

const ana = { email: ' Ana@Test.com ', password: 'password123', name: 'Ana', phone: '09171234567', role: 'customer' };

describe('auth', () => {
  it('registers a user, normalizing email', async () => {
    const res = await api('/auth/register', { body: ana });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: 'ana@test.com',
      name: 'Ana',
      phone: '09171234567',
      role: 'customer',
    });
  });

  it('rejects a duplicate email', async () => {
    await api('/auth/register', { body: ana });
    const res = await api('/auth/register', { body: { ...ana, email: 'ana@test.com' } });
    expect(res).toEqual({ status: 409, body: { error: 'Email is already registered' } });
  });

  it('rejects a short password and an unknown role', async () => {
    expect((await api('/auth/register', { body: { ...ana, password: 'short' } })).status).toBe(400);
    expect((await api('/auth/register', { body: { ...ana, role: 'admin' } })).status).toBe(400);
    expect((await api('/auth/register', { body: undefined, method: 'POST' })).status).toBe(400);
  });

  it('logs in with the right password only', async () => {
    await api('/auth/register', { body: ana });
    const ok = await api('/auth/login', { body: { email: 'ANA@test.com', password: 'password123' } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('ana@test.com');
    expect(ok.body.user.password_hash).toBeUndefined();

    const bad = await api('/auth/login', { body: { email: 'ana@test.com', password: 'wrong-password' } });
    expect(bad).toEqual({ status: 401, body: { error: 'Invalid email or password' } });

    const unknown = await api('/auth/login', { body: { email: 'nobody@test.com', password: 'password123' } });
    expect(unknown.status).toBe(401);
  });

  it('returns the current user from /me', async () => {
    const { token, user } = await registerUser('driver');
    const res = await api('/me', { token });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: 'driver' });
  });

  it('rejects missing or invalid tokens', async () => {
    expect(await api('/me')).toEqual({ status: 401, body: { error: 'Not signed in' } });
    const res = await api('/me', { token: 'garbage' });
    expect(res).toEqual({ status: 401, body: { error: 'Session expired, please sign in again' } });
  });
});
