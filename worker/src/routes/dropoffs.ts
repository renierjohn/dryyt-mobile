import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { getDropoff, listDropoffs, viewFor } from '../lib/dropoffs';
import { computeFees, type Rate } from '../lib/fees';
import { fail, parseBody, parseId } from '../lib/http';
import { photoResponse, readPhoto } from '../lib/photos';
import { pushToUsers } from '../lib/push';
import { blockedDrivers, dispatchFor, newRequestFrom, tripFor } from '../lib/rooms';
import { roadDistanceKm } from '../lib/routing';
import type { AppEnv } from '../types';

const createSchema = z.object({
  store_id: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(200).optional(),
});


/** The laundry shop's pin, or 400 when it isn't a laundry shop or has no pin yet. */
async function shopFor(c: Context<AppEnv>, storeId: number) {
  const store = await c.env.DB.prepare("SELECT id, group_id, lat, lng FROM stores WHERE id = ? AND type = 'laundry'")
    .bind(storeId)
    .first<{ id: number; group_id: string; lat: number | null; lng: number | null }>();
  if (!store) fail(400, 'store_id: choose a laundry shop');
  if (store.lat === null || store.lng === null) fail(400, 'store_id: this shop has no map location yet');
  return { ...store, lat: store.lat, lng: store.lng };
}

/** The drop off in the URL, or 404 when the caller may not see it. */
async function load(c: Context<AppEnv>) {
  const row = await getDropoff(c.env.DB, parseId(c));
  if (!row || !viewFor(row, c.get('user'))) fail(404, 'Drop off not found');
  return row;
}

/** Durable Object work after D1 has committed: a failure is logged, never turned into a 500 for a done action. */
async function afterCommit(label: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    console.error(`${label} failed`, err);
  }
}

async function respond(c: Context<AppEnv>, id: number) {
  const row = await getDropoff(c.env.DB, id);
  return c.json({ dropoff: row && viewFor(row, c.get('user')) });
}

const dropoffs = new Hono<AppEnv>();
dropoffs.use('*', requireAuth);

dropoffs.post('/', requireRole('customer'), async (c) => {
  const input = await parseBody(c, createSchema);
  const db = c.env.DB;

  const store = await shopFor(c, input.store_id);

  const rate = await db.prepare('SELECT base_fee, rate_per_km, commission_pct FROM rates WHERE group_id = ?').bind(store.group_id).first<Rate>();
  if (!rate) fail(500, 'No rates set for this area');

  const roadKm = await roadDistanceKm(c.env, input, { lat: store.lat, lng: store.lng });
  const fees = computeFees(roadKm, rate);

  let id: number;
  try {
    const row = await db
      .prepare(
        `INSERT INTO transactions (room_id, customer_id, store_id, customer_lat, customer_lng, customer_address,
           shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        crypto.randomUUID(),
        c.get('user').id,
        store.id,
        input.lat,
        input.lng,
        input.address || `Pinned location ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`,
        store.lat,
        store.lng,
        roadKm,
        fees.delivery_fee,
        fees.service_fee,
        fees.total_delivery_fee,
      )
      .first<{ id: number }>();
    id = row!.id;
  } catch (err) {
    // transactions_one_active_per_customer
    if (String(err).includes('UNIQUE')) fail(409, 'You already have an active drop off');
    throw err;
  }

  const created = (await getDropoff(db, id))!;
  try {
    await dispatchFor(c.env, created.store_group_id).newRequest(newRequestFrom(created, await blockedDrivers(db, created.store_id)));
  } catch (err) {
    await db.prepare("UPDATE transactions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'searching'").bind(id).run();
    throw err;
  }
  return c.json({ dropoff: viewFor(created, c.get('user')) }, 201);
});

dropoffs.get('/', requireRole('customer'), async (c) => {
  const user = c.get('user');
  const rows = await listDropoffs(c.env.DB, 't.customer_id = ? ORDER BY t.id DESC', user.id);
  return c.json({ dropoffs: rows.map((r) => viewFor(r, user)) });
});

dropoffs.get('/:id', async (c) => respond(c, (await load(c)).id));

dropoffs.post('/:id/cancel', requireRole('customer'), async (c) => {
  const row = await load(c);
  const db = c.env.DB;
  if (!['searching', 'driver_accepted', 'en_route_pickup'].includes(row.status)) {
    fail(409, `Cannot cancel a drop off that is ${row.status.replaceAll('_', ' ')}`);
  }
  const cancellable = "status IN ('searching', 'driver_accepted', 'en_route_pickup')";
  // One batch: the driver is freed only if the cancel itself lands.
  const [, cancelled] = await db.batch([
    db.prepare(`UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions WHERE id = ? AND ${cancellable})`).bind(row.id),
    db.prepare(`UPDATE transactions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND ${cancellable}`).bind(row.id),
  ]);
  if (cancelled.meta.changes === 0) fail(409, 'Drop off changed, refresh and try again');

  // Re-read: a driver may have accepted between load() and the update.
  const after = await db.prepare('SELECT driver_id FROM transactions WHERE id = ?').bind(row.id).first<{ driver_id: number | null }>();
  const driverId = after?.driver_id ?? undefined;
  await afterCommit('cancel removeRequest', () =>
    dispatchFor(c.env, row.store_group_id).removeRequest(row.id, { t: 'cancelled', transaction_id: row.id }, driverId),
  );
  if (row.status === 'driver_accepted' || row.status === 'en_route_pickup') {
    const trip = tripFor(c.env, row.room_id);
    await afterCommit('cancel trip notify', () => trip.notify({ t: 'status', status: 'cancelled' }));
    await afterCommit('cancel trip stop', () => trip.stop());
  }
  return respond(c, row.id);
});

/** The driver gives up a trip, only while the customer is offline (an online customer cancels themselves). */
dropoffs.post('/:id/driver-cancel', requireRole('driver'), async (c) => {
  const row = await load(c);
  const driverId = c.get('user').id;
  if (!['en_route_pickup', 'en_route_shop'].includes(row.status)) fail(409, `Cannot cancel a drop off that is ${row.status.replaceAll('_', ' ')}`);

  const trip = tripFor(c.env, row.room_id);
  if (await trip.customerOnline()) fail(409, 'The customer is online; ask them to cancel');

  const db = c.env.DB;
  const mine = "id = ? AND driver_id = ? AND status IN ('en_route_pickup', 'en_route_shop')";
  // One batch: the driver is freed only if the cancel itself lands.
  const [, cancelled] = await db.batch([
    db.prepare(`UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions WHERE ${mine})`).bind(row.id, driverId),
    db.prepare(`UPDATE transactions SET status = 'cancelled', updated_at = datetime('now') WHERE ${mine}`).bind(row.id, driverId),
  ]);
  if (cancelled.meta.changes === 0) fail(409, 'Drop off changed, refresh and try again');

  await afterCommit('driver-cancel trip notify', () => trip.notify({ t: 'status', status: 'cancelled' }));
  await afterCommit('driver-cancel trip stop', () => trip.stop());
  c.executionCtx.waitUntil(
    pushToUsers(db, [row.customer_id], 'Drop off cancelled', `${row.driver_name ?? 'Your driver'} cancelled the trip.`, { transaction_id: row.id }),
  );
  return respond(c, row.id);
});

dropoffs.post('/:id/confirm-driver', requireRole('customer'), async (c) => {
  const row = await load(c);
  const { meta } = await c.env.DB.prepare(
    "UPDATE transactions SET status = 'en_route_pickup', updated_at = datetime('now') WHERE id = ? AND status = 'driver_accepted' AND driver_id = ?",
  )
    .bind(row.id, row.driver_id)
    .run();
  if (meta.changes === 0) fail(409, 'The driver is no longer waiting for you');

  await afterCommit('confirm removeRequest', () =>
    dispatchFor(c.env, row.store_group_id).removeRequest(
      row.id,
      { t: 'confirmed', transaction_id: row.id, room_id: row.room_id },
      row.driver_id ?? undefined,
    ),
  );
  await afterCommit('confirm trip start', () => tripFor(c.env, row.room_id).start(row.id));
  return respond(c, row.id);
});

dropoffs.post('/:id/reject-driver', requireRole('customer'), async (c) => {
  const row = await load(c);
  const db = c.env.DB;
  const held = "id = ? AND status = 'driver_accepted' AND driver_id = ?";
  // One batch: the driver is freed only if the turn-down itself lands.
  const [, rejected] = await db.batch([
    db.prepare(`UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions WHERE ${held})`).bind(row.id, row.driver_id),
    db
      .prepare(`UPDATE transactions SET status = 'searching', driver_id = NULL, updated_at = datetime('now') WHERE ${held}`)
      .bind(row.id, row.driver_id),
  ]);
  if (rejected.meta.changes === 0) fail(409, 'There is no driver to turn down');

  await afterCommit('reject requeue', async () =>
    dispatchFor(c.env, row.store_group_id).reject(row.id, newRequestFrom(row, await blockedDrivers(db, row.store_id)), row.driver_id!),
  );
  return respond(c, row.id);
});

dropoffs.post('/:id/picked-up', requireRole('driver'), async (c) => {
  const row = await load(c);
  const { meta } = await c.env.DB.prepare(
    "UPDATE transactions SET status = 'en_route_shop', updated_at = datetime('now') WHERE id = ? AND driver_id = ? AND status = 'en_route_pickup'",
  )
    .bind(row.id, c.get('user').id)
    .run();
  if (meta.changes === 0) fail(409, 'Only a drop off on the way to pickup can be picked up');

  await afterCommit('picked-up trip notify', () => tripFor(c.env, row.room_id).notify({ t: 'status', status: 'en_route_shop' }));
  return respond(c, row.id);
});

const dropSchema = z.object({
  weight_kg: z.number().positive().max(100),
  laundry_fee: z.number().int().min(0).max(10_000_000),
  notes: z.string().trim().max(500).default(''),
  proof_photo_key: z.string().min(1),
});

dropoffs.post('/:id/proof-upload', requireRole('driver'), async (c) => {
  const row = await load(c);
  if (row.status !== 'en_route_shop') fail(409, 'Take the photo at the laundry shop');

  const { body, type, ext } = await readPhoto(c);

  const key = `proof/${row.id}/${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(key, body, { httpMetadata: { contentType: type } });
  return c.json({ key }, 201);
});

dropoffs.post('/:id/drop', requireRole('driver'), async (c) => {
  const row = await load(c);
  const input = await parseBody(c, dropSchema);
  if (!input.proof_photo_key.startsWith(`proof/${row.id}/`) || !(await c.env.PROOFS.head(input.proof_photo_key))) {
    fail(400, 'proof_photo_key: upload the photo first');
  }

  const db = c.env.DB;
  const driverId = c.get('user').id;
  const stillAtShop = "SELECT 1 FROM transactions WHERE id = ? AND driver_id = ? AND status = 'en_route_shop'";
  // One batch = one transaction: either everything lands or the drop off stays retryable.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO owner_transactions (transaction_id, store_id, weight_kg, laundry_fee, notes, proof_photo_key) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (${stillAtShop})`,
      )
      .bind(row.id, row.store_id, input.weight_kg, input.laundry_fee, input.notes, input.proof_photo_key, row.id, driverId),
    db.prepare(`UPDATE drivers SET busy = 0 WHERE user_id = ? AND EXISTS (${stillAtShop})`).bind(driverId, row.id, driverId),
    db
      .prepare(
        "UPDATE transactions SET status = 'dropped_off', laundry_fee = ?, updated_at = datetime('now') WHERE id = ? AND driver_id = ? AND status = 'en_route_shop'",
      )
      .bind(input.laundry_fee, row.id, driverId),
  ]);
  if (results[2].meta.changes === 0) fail(409, 'Only a picked-up drop off can be dropped off');

  const trip = tripFor(c.env, row.room_id);
  await afterCommit('drop trip notify', () => trip.notify({ t: 'status', status: 'dropped_off' }));
  await afterCommit('drop trip finish', () => trip.finish());
  if (row.store_owner_id) {
    c.executionCtx.waitUntil(
      pushToUsers(db, [row.store_owner_id], 'New drop off', `${row.customer_name}'s laundry has arrived.`, { transaction_id: row.id }, 'ownerOrder'),
    );
  }
  return respond(c, row.id);
});

dropoffs.get('/:id/proof', async (c) => {
  const row = await load(c);
  return photoResponse(c.env.PROOFS, row.proof_photo_key);
});

/** The customer sees the assigned driver's face and license while deciding and until the drop off reaches the shop. */
const DRIVER_PHOTO_STATUSES = ['driver_accepted', 'en_route_pickup', 'en_route_shop'];

dropoffs.get('/:id/driver-photo/:kind', requireRole('customer'), async (c) => {
  const row = await load(c);
  if (!DRIVER_PHOTO_STATUSES.includes(row.status)) fail(404, 'No photo');
  const kind = c.req.param('kind');
  if (kind !== 'face' && kind !== 'id') fail(404, 'Not found');
  return photoResponse(c.env.PROOFS, kind === 'face' ? row.driver_photo_face : row.driver_photo_id);
});

const paymentSchema = z.object({ paid: z.boolean() });

dropoffs.post('/:id/payment', async (c) => {
  const row = await load(c);
  const { paid } = await parseBody(c, paymentSchema);
  const user = c.get('user');
  if (user.role === 'driver') fail(403, 'Only the customer or the shop can update payment');
  if (!paid && user.role !== 'owner') fail(403, 'Only the shop can mark a drop off as unpaid');

  const to = paid ? 'completed' : 'payment_pending';
  const from = paid ? ['owner_confirmed', 'payment_pending'] : ['owner_confirmed', 'completed'];
  const { meta } = await c.env.DB.prepare(
    "UPDATE transactions SET status = ?, updated_at = datetime('now') WHERE id = ? AND status IN (?, ?)",
  )
    .bind(to, row.id, ...from)
    .run();
  if (meta.changes === 0) fail(409, `Cannot update payment while the drop off is ${row.status.replaceAll('_', ' ')}`);
  return respond(c, row.id);
});

export default dropoffs;
