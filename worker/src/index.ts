import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { requireAuth } from './lib/auth';
import { fail, parseBody } from './lib/http';
import { menuImageKey } from './lib/menu';
import { photoResponse } from './lib/photos';
import { storeImageKey } from './lib/stores';
import auth from './routes/auth';
import drivers from './routes/drivers';
import history from './routes/history';
import dropoffs from './routes/dropoffs';
import jobs from './routes/jobs';
import menu from './routes/menu';
import orders from './routes/orders';
import owner from './routes/owner';
import stores from './routes/stores';
import ws from './routes/ws';
import type { AppEnv, User } from './types';

const app = new Hono<AppEnv>();

app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/stores', stores);
// Menu photos are public (no token) so any client can show them; each upload gets a new name, so cache for good.
app.get('/menu-images/:store/:file', (c) =>
  photoResponse(c.env.PROOFS, menuImageKey(c.req.url), 'public, max-age=31536000, immutable'),
);
// Shop logos and payment QRs, public like menu photos.
app.get('/store-images/:owner/:file', (c) =>
  photoResponse(c.env.PROOFS, storeImageKey(c.req.url), 'public, max-age=31536000, immutable'),
);
// Pickup is switched off by PICKUP_ENABLED (wrangler.jsonc) while Drop off ships first.
const pickupOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.PICKUP_ENABLED !== 'true') fail(403, 'Pickup is not available yet');
  await next();
});
app.use('/orders', pickupOnly);
app.use('/orders/*', pickupOnly);
app.use('/jobs', pickupOnly);
app.use('/jobs/*', pickupOnly);
app.use('/menu', pickupOnly);
app.use('/menu/*', pickupOnly);
app.route('/orders', orders);
app.route('/jobs', jobs);
app.route('/menu', menu);
app.route('/drivers', drivers);
app.route('/dropoffs', dropoffs);
app.route('/owner', owner);
app.route('/history', history);
app.route('/ws', ws);

app.get('/me', requireAuth, async (c) => {
  const user = await c.env.DB.prepare('SELECT id, email, name, phone, role FROM users WHERE id = ?')
    .bind(c.get('user').id)
    .first<User>();
  if (!user) fail(401, 'Session expired, please sign in again');
  return c.json({ user });
});

const pushTokenSchema = z.object({ token: z.string().startsWith('ExponentPushToken[').max(200) });

/** Enough of a push token to tell devices apart in logs without exposing it. */
const maskToken = (token: unknown) =>
  typeof token === 'string' && token.length > 12 ? `${token.slice(0, 22)}…${token.slice(-4)}` : JSON.stringify(token ?? null);

app.post('/me/push-token', requireAuth, async (c) => {
  const user = c.get('user');
  // Hono caches the parsed body, so parseBody below reads the same JSON again for free.
  const raw = (await c.req.json().catch(() => undefined)) as { token?: unknown } | undefined;
  console.log('[push-token] received', { userId: user.id, role: user.role, token: maskToken(raw?.token) });
  if (!pushTokenSchema.safeParse(raw).success) {
    console.warn('[push-token] rejected: not an Expo push token', { userId: user.id, token: maskToken(raw?.token) });
  }
  const { token } = await parseBody(c, pushTokenSchema);
  const db = c.env.DB;
  // A token belongs to one phone: take it off whoever used this phone before, so their pushes stop ringing here.
  const [moved, saved] = await db.batch([
    db.prepare('UPDATE users SET push_token = NULL WHERE push_token = ? AND id != ?').bind(token, user.id),
    db.prepare('UPDATE users SET push_token = ? WHERE id = ?').bind(token, user.id),
  ]);
  console.log('[push-token] saved', {
    userId: user.id,
    role: user.role,
    token: maskToken(token),
    updated: saved.meta.changes,
    takenFromOthers: moved.meta.changes,
  });
  return c.json({ ok: true });
});

const pushTokenErrorSchema = z.object({
  step: z.enum(['channel', 'permission', 'projectId', 'getExpoPushTokenAsync', 'save']),
  error: z.string().max(500),
  platform: z.string().max(20).optional(),
});

/** The app reports why it couldn't register for push; only logged, so phones that fail silently can be diagnosed. */
app.post('/me/push-token/error', requireAuth, async (c) => {
  const user = c.get('user');
  const { step, error, platform } = await parseBody(c, pushTokenErrorSchema);
  console.warn('[push-token] failed', { userId: user.id, role: user.role, platform, step, error });
  return c.json({ ok: true });
});

/** Sign out: this account stops getting pushes on this phone. */
app.delete('/me/push-token', requireAuth, async (c) => {
  const user = c.get('user');
  const { meta } = await c.env.DB.prepare('UPDATE users SET push_token = NULL WHERE id = ?').bind(user.id).run();
  console.log('[push-token] cleared', { userId: user.id, role: user.role, updated: meta.changes });
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

export default app;
export { Dispatch } from './do/dispatch';
export { Trip } from './do/trip';
