import { Hono } from 'hono';
import { z } from 'zod';

import { signToken } from '../lib/auth';
import { fail, parseBody } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/password';
import type { AppEnv, User } from '../types';

const email = z.string().trim().toLowerCase().email('Enter a valid email');

const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(7, 'Phone is required'),
  role: z.enum(['customer', 'driver', 'owner']),
});

export const loginSchema = z.object({ email, password: z.string().min(1) });

/** The user for these credentials, or a 401. */
export async function checkLogin(db: D1Database, input: z.infer<typeof loginSchema>): Promise<User> {
  const row = await db.prepare('SELECT id, email, name, phone, role, password_hash, blocked FROM users WHERE email = ?')
    .bind(input.email)
    .first<User & { password_hash: string; blocked: number }>();
  if (!row || !(await verifyPassword(input.password, row.password_hash))) fail(401, 'Invalid email or password');
  // Only after the password matches, so this never tells strangers which emails exist.
  if (row.blocked === 1) fail(403, 'This account is blocked. Please contact support.');
  const { password_hash: _, blocked: __, ...user } = row;
  return user;
}

const auth = new Hono<AppEnv>();

auth.post('/register', async (c) => {
  const input = await parseBody(c, registerSchema);
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(input.email).first();
  if (existing) fail(409, 'Email is already registered');

  const user = await db
    .prepare(
      'INSERT INTO users (email, password_hash, name, phone, role) VALUES (?, ?, ?, ?, ?) RETURNING id, email, name, phone, role',
    )
    .bind(input.email, await hashPassword(input.password), input.name, input.phone, input.role)
    .first<User>();
  if (!user) fail(500, 'Could not create user');
  if (user.role === 'driver') await db.prepare('INSERT INTO drivers (user_id) VALUES (?)').bind(user.id).run();

  return c.json({ token: await signToken(user, c.env.JWT_SECRET), user }, 201);
});

auth.post('/login', async (c) => {
  const user = await checkLogin(c.env.DB, await parseBody(c, loginSchema));
  return c.json({ token: await signToken(user, c.env.JWT_SECRET), user });
});

export default auth;
