import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../lib/auth';
import { listDropoffs, viewFor } from '../lib/dropoffs';
import { fail } from '../lib/http';
import { listOrders } from '../lib/orders';
import type { AppEnv } from '../types';

const querySchema = z.object({
  /** `next` from the previous page. */
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** The driver's part of a drop off is over from dropped_off on (or it was cancelled). */
const DRIVER_DONE = "('dropped_off', 'owner_confirmed', 'completed', 'payment_pending', 'cancelled')";

/**
 * Orders and drop offs in one list, a page at a time: shop-confirmed drop offs (waiting for payment) first, then newest.
 * Customers: everything they placed, by creation time. Drivers: jobs they finished, by last update.
 * The cursor `pin|at|kind|id` matches the sort order, so pages never skip or repeat rows.
 */
const PIN = "(status = 'owner_confirmed')";
const DROPOFFS = {
  customer: `SELECT 'dropoff' AS kind, id, created_at AS at, ${PIN} AS pin FROM transactions WHERE customer_id = ?1`,
  driver: `SELECT 'dropoff' AS kind, id, updated_at AS at, ${PIN} AS pin FROM transactions WHERE driver_id = ?1 AND status IN ${DRIVER_DONE}`,
};
const ORDERS = {
  customer: `SELECT 'order', id, created_at, 0 FROM orders WHERE customer_id = ?1`,
  driver: `SELECT 'order', id, updated_at, 0 FROM orders WHERE driver_id = ?1 AND status = 'delivered'`,
};
/** Drop offs, plus Pickup orders while PICKUP_ENABLED is on. */
const sources = (role: 'customer' | 'driver', pickup: boolean) => (pickup ? `${DROPOFFS[role]} UNION ALL ${ORDERS[role]}` : DROPOFFS[role]);

type Entry = { kind: 'order' | 'dropoff'; id: number; at: string; pin: number };

const history = new Hono<AppEnv>();
history.use('*', requireAuth);

history.get('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'customer' && user.role !== 'driver') fail(403, 'Only customers and drivers have a history');
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) fail(400, 'Invalid history query');
  const { before, limit } = parsed.data;

  let cursor = '';
  const binds: unknown[] = [user.id];
  if (before) {
    const [pin, at, kind, id] = before.split('|');
    if ((pin !== '0' && pin !== '1') || !at || !kind || !Number.isInteger(Number(id))) fail(400, 'Invalid history cursor');
    cursor = 'WHERE pin < ?2 OR (pin = ?2 AND (at < ?3 OR (at = ?3 AND (kind > ?4 OR (kind = ?4 AND id < ?5)))))';
    binds.push(Number(pin), at, kind, Number(id));
  }
  const db = c.env.DB;
  const { results } = await db
    .prepare(`SELECT * FROM (${sources(user.role, c.env.PICKUP_ENABLED === 'true')}) ${cursor} ORDER BY pin DESC, at DESC, kind ASC, id DESC LIMIT ${limit + 1}`)
    .bind(...binds)
    .all<Entry>();

  const page = results.slice(0, limit);
  const ids = (kind: Entry['kind']) => page.filter((e) => e.kind === kind).map((e) => e.id);
  const inList = (n: number) => `(${Array(n).fill('?').join(', ')})`;
  const orderIds = ids('order');
  const dropoffIds = ids('dropoff');
  const orders = new Map((orderIds.length ? await listOrders(db, `o.id IN ${inList(orderIds.length)}`, ...orderIds) : []).map((o) => [o.id, o]));
  const dropoffs = new Map(
    (dropoffIds.length ? await listDropoffs(db, `t.id IN ${inList(dropoffIds.length)}`, ...dropoffIds) : []).map((d) => [d.id, viewFor(d, user)]),
  );

  // Drivers' total earnings ride along on the first page, so the History tab needs no other request.
  const earnings =
    user.role === 'driver' && !before
      ? ((await db.prepare('SELECT earnings FROM driver_data WHERE user_id = ?').bind(user.id).first<{ earnings: number }>())?.earnings ?? 0)
      : undefined;

  const last = page[page.length - 1];
  return c.json({
    items: page.map((e) => (e.kind === 'order' ? { kind: e.kind, order: orders.get(e.id) } : { kind: e.kind, dropoff: dropoffs.get(e.id) })),
    next: results.length > limit && last ? `${last.pin}|${last.at}|${last.kind}|${last.id}` : null,
    ...(earnings !== undefined && { earnings }),
  });
});

export default history;
