import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { driverVehicle } from '../lib/fees';
import { requireVerifiedDriver } from '../lib/verified';
import { fail, parseBody, parseId } from '../lib/http';
import { getOrder, hidePhone, listOrders } from '../lib/orders';
import { pickupChanged } from '../lib/pickup-live';
import type { AppEnv, OrderStatus } from '../types';

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { accepted: 'picked_up', picked_up: 'delivered' };

const statusSchema = z.object({ status: z.enum(['picked_up', 'delivered']) });


const jobs = new Hono<AppEnv>();
jobs.use('*', requireAuth, requireRole('driver'));

jobs.get('/available', async (c) => {
  // Only the jobs booked for this driver's vehicle.
  const pending = await listOrders(c.env.DB, "o.status = 'pending' AND o.vehicle_type = ? ORDER BY o.id", await driverVehicle(c.env.DB, c.get('user').id));
  return c.json({ jobs: pending.map(hidePhone) });
});

jobs.get('/active', async (c) => {
  const row = await c.env.DB.prepare("SELECT id FROM transactions_pickup WHERE driver_id = ? AND status IN ('accepted', 'picked_up')")
    .bind(c.get('user').id)
    .first<{ id: number }>();
  return c.json({ job: row ? await getOrder(c.env.DB, row.id) : null });
});

jobs.get('/history', async (c) => {
  const history = await listOrders(c.env.DB, "o.driver_id = ? AND o.status = 'delivered' ORDER BY o.updated_at DESC, o.id DESC", c.get('user').id);
  return c.json({ jobs: history });
});

jobs.post('/:id/accept', async (c) => {
  const id = parseId(c);
  const db = c.env.DB;
  const driverId = c.get('user').id;
  await requireVerifiedDriver(db, driverId);
  const vehicle = await driverVehicle(db, driverId);
  const job = await db.prepare('SELECT vehicle_type FROM transactions_pickup WHERE id = ?').bind(id).first<{ vehicle_type: number }>();
  if (!job) fail(404, 'Job not found');
  if (job.vehicle_type !== vehicle) fail(409, 'This job is booked for another vehicle');
  const busy = await db.prepare('UPDATE drivers SET busy = 1 WHERE user_id = ? AND busy = 0').bind(driverId).run();
  if (busy.meta.changes === 0) fail(409, 'Finish your active job first');
  const free = () => db.prepare('UPDATE drivers SET busy = 0 WHERE user_id = ?').bind(driverId).run();

  let changes: number;
  try {
    const { meta } = await db
      .prepare("UPDATE transactions_pickup SET driver_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .bind(driverId, id)
      .run();
    changes = meta.changes;
  } catch (err) {
    await free();
    // orders_one_active_job unique index
    if (String(err).includes('UNIQUE')) fail(409, 'Finish your active job first');
    throw err;
  }

  if (changes === 0) {
    await free();
    const exists = await db.prepare('SELECT id FROM transactions_pickup WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Job not found');
    fail(409, 'Job is no longer available');
  }

  pickupChanged(c, id);
  return c.json({ job: await getOrder(db, id) });
});

jobs.post('/:id/release', async (c) => {
  const id = parseId(c);
  const db = c.env.DB;

  const order = await db.prepare('SELECT driver_id FROM transactions_pickup WHERE id = ?').bind(id).first<{ driver_id: number | null }>();
  if (!order) fail(404, 'Job not found');
  if (order.driver_id !== c.get('user').id) fail(403, 'This is not your job');

  // One batch: the driver is freed only if the release itself lands.
  const [, released] = await db.batch([
    db.prepare("UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions_pickup WHERE id = ? AND status = 'accepted')").bind(id),
    db.prepare("UPDATE transactions_pickup SET driver_id = NULL, status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'accepted'").bind(id),
  ]);
  if (released.meta.changes === 0) fail(409, 'Only jobs not yet picked up can be released');

  pickupChanged(c, id);
  return c.json({ job: await getOrder(db, id) });
});

jobs.post('/:id/status', async (c) => {
  const id = parseId(c);
  const { status } = await parseBody(c, statusSchema);
  const db = c.env.DB;

  const order = await db.prepare('SELECT driver_id, status FROM transactions_pickup WHERE id = ?').bind(id).first<{ driver_id: number | null; status: OrderStatus }>();
  if (!order) fail(404, 'Job not found');
  if (order.driver_id !== c.get('user').id) fail(403, 'This is not your job');
  if (NEXT_STATUS[order.status] !== status) fail(409, `Cannot change status from ${order.status} to ${status}`);

  const move = db.prepare("UPDATE transactions_pickup SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?").bind(status, id, order.status);
  // Delivered frees the driver and counts the items in the same batch, each guarded by the old state so they land only
  // with the status change (a repeated "delivered" changes nothing).
  const results =
    status === 'delivered'
      ? await db.batch([
          db.prepare('UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions_pickup WHERE id = ? AND status = ?)').bind(id, order.status),
          db
            .prepare(
              `UPDATE store_menu_items
               SET popularity = popularity + (SELECT SUM(qty) FROM order_items WHERE order_id = ?1 AND menu_item_id = store_menu_items.id)
               WHERE id IN (SELECT menu_item_id FROM order_items WHERE order_id = ?1) AND (SELECT status FROM transactions_pickup WHERE id = ?1) = ?2`,
            )
            .bind(id, order.status),
          move,
        ])
      : [await move.run()];
  if (results[results.length - 1].meta.changes === 0) fail(409, 'Job changed, refresh and try again');

  pickupChanged(c, id, { board: false });
  return c.json({ job: await getOrder(db, id) });
});

export default jobs;
