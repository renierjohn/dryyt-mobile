import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';

import type { AppEnv, AuthUser, Role } from '../types';
import { fail } from './http';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export function signToken(user: AuthUser, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ sub: user.id, role: user.role, exp }, secret, 'HS256');
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) fail(401, 'Not signed in');

  let user: AuthUser;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    user = { id: Number(payload.sub), role: payload.role as Role };
  } catch {
    fail(401, 'Session expired, please sign in again');
  }
  c.set('user', user);
  await next();
});

export const requireRole = (role: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('user').role !== role) fail(403, `Only ${role}s can do this`);
    await next();
  });
