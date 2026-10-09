import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { listDropoffs, viewFor } from '../lib/dropoffs';
import { fail, parseBody } from '../lib/http';
import { photoResponse, readPhoto } from '../lib/photos';
import type { AppEnv } from '../types';

const onlineSchema = z.object({ online: z.boolean() });
const notesSchema = z.object({ notes: z.string().trim().max(200) });

/** URL kind → driver_data column. */
const PHOTO_COLUMNS = { face: 'photo_face', id: 'photo_id' } as const;
type DriverData = { photo_face: string | null; photo_id: string | null; notes: string; status: number; face_check: 'passed' | 'skipped' | null };

function photoColumn(kind: string) {
  if (!(kind in PHOTO_COLUMNS)) fail(404, 'Not found');
  return PHOTO_COLUMNS[kind as keyof typeof PHOTO_COLUMNS];
}

const loadData = (db: D1Database, userId: number) =>
  db.prepare('SELECT photo_face, photo_id, notes, status, face_check FROM driver_data WHERE user_id = ?').bind(userId).first<DriverData>();

/** What the driver sees: whether each photo is in, the notes, and the badge. Keys stay server-side. */
const verificationView = (d: DriverData | null) => ({
  has_face: Boolean(d?.photo_face),
  has_id: Boolean(d?.photo_id),
  /** 'skipped': the face photo was taken without the live face check and waits for a closer look. */
  face_check: d?.photo_face ? (d.face_check ?? null) : null,
  notes: d?.notes ?? '',
  verified: d?.status === 1,
});

const drivers = new Hono<AppEnv>();
drivers.use('*', requireAuth, requireRole('driver'));

drivers.get('/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const state = await db.prepare('SELECT online, busy FROM drivers WHERE user_id = ?').bind(user.id).first<{ online: number; busy: number }>();
  const [job] = await listDropoffs(
    db,
    "t.driver_id = ? AND t.status IN ('driver_accepted', 'en_route_pickup', 'en_route_shop', 'dropped_off') ORDER BY t.status = 'dropped_off', t.id DESC LIMIT 1",
    user.id,
  );
  return c.json({
    driver: { online: state?.online === 1, busy: state?.busy === 1 },
    job: job ? viewFor(job, user) : null,
  });
});

drivers.post('/me/online', async (c) => {
  const { online } = await parseBody(c, onlineSchema);
  await c.env.DB.prepare("UPDATE drivers SET online = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(online ? 1 : 0, c.get('user').id)
    .run();
  return c.json({ online });
});

drivers.get('/me/verification', async (c) => c.json({ verification: verificationView(await loadData(c.env.DB, c.get('user').id)) }));

const LOCKED = 'Your details are verified and can no longer be changed';

// Verified details are locked; a developer unverifies (yarn driver:verify --off) to allow changes.
drivers.post('/me/verification', async (c) => {
  const { notes } = await parseBody(c, notesSchema);
  const userId = c.get('user').id;
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO driver_data (user_id, notes) VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE SET notes = excluded.notes, updated_at = datetime('now') WHERE status = 0`,
  )
    .bind(userId, notes)
    .run();
  if (meta.changes === 0) fail(409, LOCKED);
  return c.json({ verification: verificationView(await loadData(c.env.DB, userId)) });
});

/** Face uploads pass `?face_check=skipped` when the app's live face check couldn't run; anything else counts as passed. */
drivers.post('/me/verification/photo/:kind', async (c) => {
  const column = photoColumn(c.req.param('kind'));
  const faceCheck = column === 'photo_face' ? (c.req.query('face_check') === 'skipped' ? 'skipped' : 'passed') : null;
  const userId = c.get('user').id;
  const before = await loadData(c.env.DB, userId);
  if (before?.status === 1) fail(409, LOCKED);
  const { body, type, ext } = await readPhoto(c);

  const key = `driver/${userId}/${c.req.param('kind')}-${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(key, body, { httpMetadata: { contentType: type } });
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO driver_data (user_id, ${column}, face_check) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET ${column} = excluded.${column}, face_check = COALESCE(excluded.face_check, face_check),
       updated_at = datetime('now') WHERE status = 0`,
  )
    .bind(userId, key, faceCheck)
    .run();
  // Verified while the photo was uploading: drop the new photo, keep the verified one.
  if (meta.changes === 0) {
    c.executionCtx.waitUntil(c.env.PROOFS.delete(key));
    fail(409, LOCKED);
  }
  if (before?.[column]) c.executionCtx.waitUntil(c.env.PROOFS.delete(before[column]));
  return c.json({ verification: verificationView(await loadData(c.env.DB, userId)) }, 201);
});

drivers.get('/me/verification/photo/:kind', async (c) => {
  const column = photoColumn(c.req.param('kind'));
  return photoResponse(c.env.PROOFS, (await loadData(c.env.DB, c.get('user').id))?.[column]);
});

export default drivers;
