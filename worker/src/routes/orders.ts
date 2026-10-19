import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { computeFees, discountedPrice, type Rate } from '../lib/fees';
import { fail, parseBody, parseId } from '../lib/http';
import { getOrder, hidePhone, listOrders } from '../lib/orders';
import { photoResponse, readPhoto } from '../lib/photos';
import { orderRoom, pickupChanged } from '../lib/pickup-live';
import { pushToUsers } from '../lib/push';
import { roadDistanceKm } from '../lib/routing';
import type { AppEnv, LatLng, StoreType } from '../types';

const pin = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

const createSchema = z.object({
  // Drop offs are v2 (/dropoffs); orders are pickups only.
  type: z.literal('pickup'),
  store_id: z.number().int().positive(),
  items: z
    .array(z.object({ menu_item_id: z.number().int().positive(), qty: z.number().int().min(1).max(50) }))
    .max(50)
    .default([]),
  // A pinned location prices delivery by road distance (like drop offs); a typed address alone pays the flat fee.
  lat: pin.lat.optional(),
  lng: pin.lng.optional(),
  customer_address: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(500).default(''),
  // Food is paid upfront to the store's payment QR: a reference number, a photo (from /orders/payment-photo), or both.
  payment_ref: z.string().trim().max(100).default(''),
  payment_photo_key: z.string().max(200).optional(),
  // From /orders/quote for the same store and pin: skips pricing the road again.
  quote_token: z.string().max(1000).optional(),
});

const quoteSchema = z.object({ store_id: z.number().int().positive(), ...pin });

/** The store with its group's rate (null fields when the group has none). */
type Store = { id: number; type: StoreType; lat: number | null; lng: number | null; owner_id: number | null } & { [K in keyof Rate]: Rate[K] | null };
type Quote = { road_km: number; delivery_fee: number; service_fee: number };
type QuoteClaims = Quote & { store_id: number; lat: number; lng: number; exp: number };

/** A quote stays good for Send proof of payment this long. */
const QUOTE_TTL_SECONDS = 15 * 60;
// Its own secret, so a quote token can never pass as a session token.
const quoteSecret = (env: AppEnv['Bindings']) => `${env.JWT_SECRET}:quote`;

/** Same pricing as a drop off: the store group's rate over the road distance from the customer to the store. */
async function quoteFor(env: AppEnv['Bindings'], store: Store, at: LatLng): Promise<Quote> {
  if (store.lat === null || store.lng === null) fail(400, 'store_id: this store has no map location yet');
  if (store.base_fee === null || store.rate_per_km === null || store.commission_pct === null) fail(500, 'No rates set for this area');
  const roadKm = await roadDistanceKm(env, at, { lat: store.lat, lng: store.lng });
  const fees = computeFees(roadKm, { base_fee: store.base_fee, rate_per_km: store.rate_per_km, commission_pct: store.commission_pct });
  return { road_km: roadKm, delivery_fee: fees.total_delivery_fee, service_fee: fees.service_fee };
}

const signQuote = (env: AppEnv['Bindings'], storeId: number, at: LatLng, quote: Quote) =>
  sign({ ...quote, store_id: storeId, lat: at.lat, lng: at.lng, exp: Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS } satisfies QuoteClaims, quoteSecret(env), 'HS256');

/** The quote signed for this store and pin, or null (missing, expired, tampered, or for another pin). */
async function verifiedQuote(env: AppEnv['Bindings'], token: string | undefined, storeId: number, at: LatLng): Promise<Quote | null> {
  if (!token) return null;
  try {
    const q = (await verify(token, quoteSecret(env), 'HS256')) as unknown as QuoteClaims;
    if (q.store_id !== storeId || q.lat !== at.lat || q.lng !== at.lng) return null;
    return { road_km: q.road_km, delivery_fee: q.delivery_fee, service_fee: q.service_fee };
  } catch {
    return null;
  }
}

const findStore = (db: D1Database, id: number) =>
  db
    .prepare(
      `SELECT s.id, s.type, s.lat, s.lng, s.owner_id, r.base_fee, r.rate_per_km, r.commission_pct
       FROM stores s LEFT JOIN rates r ON r.group_id = s.group_id WHERE s.id = ?`,
    )
    .bind(id)
    .first<Store>();

type Line = { menuItemId: number; name: string; price: number; qty: number };

async function priceItems(db: D1Database, storeId: number, items: { menu_item_id: number; qty: number }[]): Promise<Line[]> {
  const ids = [...new Set(items.map((i) => i.menu_item_id))];
  const { results } = await db
    .prepare(`SELECT id, name, price, discount_percent FROM store_menu_items WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(storeId, ...ids)
    .all<{ id: number; name: string; price: number; discount_percent: number }>();
  const menu = new Map(results.map((m) => [m.id, m]));

  return items.map((i) => {
    const item = menu.get(i.menu_item_id);
    if (!item) fail(400, `Item ${i.menu_item_id} is not on this store's menu`);
    return { menuItemId: item.id, name: item.name, price: discountedPrice(item.price, item.discount_percent), qty: i.qty };
  });
}

const orders = new Hono<AppEnv>();
orders.use('*', requireAuth);

orders.post('/quote', requireRole('customer'), async (c) => {
  const input = await parseBody(c, quoteSchema);
  const store = await findStore(c.env.DB, input.store_id);
  if (!store) fail(404, 'Store not found');
  // The customer sees one delivery fee; the split is for drivers.
  const at = { lat: input.lat, lng: input.lng };
  const quote = await quoteFor(c.env, store, at);
  return c.json({ quote: { road_km: quote.road_km, delivery_fee: quote.delivery_fee, token: await signQuote(c.env, store.id, at, quote) } });
});

/** Proof of payment photo, uploaded before the order exists; the order then references the returned key. */
orders.post('/payment-photo', requireRole('customer'), async (c) => {
  const { body, type, ext } = await readPhoto(c);
  const key = `payments/${c.get('user').id}/${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(key, body, { httpMetadata: { contentType: type } });
  return c.json({ key }, 201);
});

orders.post('/', requireRole('customer'), async (c) => {
  const input = await parseBody(c, createSchema);
  const db = c.env.DB;
  const customerId = c.get('user').id;

  const store = await findStore(db, input.store_id);
  if (!store) fail(404, 'Store not found');

  const at = input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : null;
  if (!at && input.customer_address.length < 5) fail(400, 'customer_address: Address is required');
  const address = input.customer_address || `Pinned location ${at!.lat.toFixed(5)}, ${at!.lng.toFixed(5)}`;

  if (store.type === 'food') {
    if (input.items.length === 0) fail(400, 'Add at least one item');
    if (!input.payment_ref && !input.payment_photo_key) fail(400, 'Add a reference number or a photo of your payment');
    if (input.payment_photo_key && !input.payment_photo_key.startsWith(`payments/${customerId}/`)) fail(400, 'payment_photo_key: upload the photo first');
  } else if (input.items.length > 0) {
    fail(400, 'Laundry orders do not take menu items');
  }
  // Fees, payment photo and item prices don't depend on each other: look them up together.
  const [fees, photo, lines] = await Promise.all([
    !at
      ? { delivery_fee: Number(c.env.DELIVERY_FEE), service_fee: 0 }
      : verifiedQuote(c.env, input.quote_token, store.id, at).then((q) => q ?? quoteFor(c.env, store, at)),
    store.type === 'food' && input.payment_photo_key ? c.env.PROOFS.head(input.payment_photo_key) : true,
    store.type === 'food' ? priceItems(db, store.id, input.items) : ([] as Line[]),
  ]);
  if (!photo) fail(400, 'payment_photo_key: upload the photo first');

  const itemsTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  // Food waits for the owner to confirm the payment; laundry goes straight to drivers (cash on delivery).
  const status = store.type === 'food' ? 'awaiting_payment' : 'pending';
  // D1 batches run in one transaction, so MAX(id) for this customer is the order just inserted.
  const [created] = await db.batch([
    db
      .prepare(
        `INSERT INTO orders (type, customer_id, store_id, status, customer_address, customer_lat, customer_lng, notes, items_total, delivery_fee,
           service_fee, payment_ref, payment_photo_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.type,
        customerId,
        store.id,
        status,
        address,
        at?.lat ?? null,
        at?.lng ?? null,
        input.notes,
        itemsTotal,
        fees.delivery_fee,
        fees.service_fee,
        input.payment_ref,
        input.payment_photo_key ?? null,
      ),
    ...lines.map((l) =>
      db
        .prepare(
          'INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES ((SELECT MAX(id) FROM orders WHERE customer_id = ?), ?, ?, ?, ?)',
        )
        .bind(customerId, l.menuItemId, l.name, l.price, l.qty),
    ),
  ]);

  const id = created.meta.last_row_id;
  // Laundry pickups go straight to drivers.
  if (status === 'pending') pickupChanged(c, id, { room: false });
  if (status === 'awaiting_payment') {
    // The room reminds the owner and accepts the payment if they never tap Done Pay; the customer waits on its socket.
    c.executionCtx.waitUntil(orderRoom(c.env, id).awaitPayment(id).catch((err) => console.error('pickup payment timers failed', err)));
    if (store.owner_id !== null) {
      c.executionCtx.waitUntil(pushToUsers(c.env, [store.owner_id], 'New order', 'A customer sent a proof of payment. Check Orders.', { order_id: id }, 'ownerOrder'));
    }
  }
  return c.json({ order: await getOrder(db, id) }, 201);
});

/** After the owner confirms the payment, the customer releases the order to drivers. */
orders.post('/:id/place', requireRole('customer'), async (c) => {
  const id = parseId(c);
  const db = c.env.DB;
  const order = await db.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<{ customer_id: number }>();
  if (!order || order.customer_id !== c.get('user').id) fail(404, 'Order not found');

  const { meta } = await db
    .prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'payment_confirmed'")
    .bind(id)
    .run();
  if (meta.changes === 0) fail(409, 'The store has not confirmed your payment yet');
  pickupChanged(c, id);
  return c.json({ order: await getOrder(db, id) });
});

orders.get('/', requireRole('customer'), async (c) => {
  return c.json({ orders: await listOrders(c.env.DB, 'o.customer_id = ? ORDER BY o.id DESC', c.get('user').id) });
});

orders.get('/:id', async (c) => {
  const order = await getOrder(c.env.DB, parseId(c));
  if (!order) fail(404, 'Order not found');

  const user = c.get('user');
  const allowed =
    user.role === 'customer' ? order.customer_id === user.id : order.driver_id === user.id || order.status === 'pending';
  if (!allowed) fail(403, 'You cannot view this order');

  return c.json({ order: user.role === 'driver' && order.driver_id !== user.id ? hidePhone(order) : order });
});

/** The customer sees the driver's face and license while the driver is on the way with their order. */
orders.get('/:id/driver-photo/:kind', requireRole('customer'), async (c) => {
  const id = parseId(c);
  const kind = c.req.param('kind');
  if (kind !== 'face' && kind !== 'id') fail(404, 'Not found');
  const row = await c.env.DB.prepare(
    `SELECT o.customer_id, o.status, dd.photo_face, dd.photo_id FROM orders o LEFT JOIN driver_data dd ON dd.user_id = o.driver_id WHERE o.id = ?`,
  )
    .bind(id)
    .first<{ customer_id: number; status: string; photo_face: string | null; photo_id: string | null }>();
  if (!row || row.customer_id !== c.get('user').id) fail(404, 'Order not found');
  if (row.status !== 'accepted' && row.status !== 'picked_up') fail(404, 'No photo');
  return photoResponse(c.env.PROOFS, kind === 'face' ? row.photo_face : row.photo_id);
});

orders.post('/:id/cancel', requireRole('customer'), async (c) => {
  const id = parseId(c);
  const db = c.env.DB;

  const order = await db.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<{ customer_id: number }>();
  if (!order) fail(404, 'Order not found');
  if (order.customer_id !== c.get('user').id) fail(403, 'You cannot cancel this order');

  const { meta } = await db
    .prepare(
      "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('awaiting_payment', 'payment_confirmed', 'pending')",
    )
    .bind(id)
    .run();
  if (meta.changes === 0) fail(409, 'Order can no longer be cancelled');
  pickupChanged(c, id);

  return c.json({ order: await getOrder(db, id) });
});

export default orders;
