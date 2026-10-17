import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { getDropoff, listDropoffs, viewFor } from '../lib/dropoffs';
import { getMenuItem, listMenu, menuImageKey, menuImageUrl } from '../lib/menu';
import { getOrder, listOrders } from '../lib/orders';
import { photoResponse, readPhoto } from '../lib/photos';
import { storeImageKeys, storeImageUrl, toStore, type StoreRow } from '../lib/stores';
import { fail, parseBody, parseId } from '../lib/http';
import { pushToUsers } from '../lib/push';
import type { AppEnv } from '../types';

const storeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['food', 'laundry']),
  address: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  store_logo: z.string().trim().url().max(500).nullable().default(null),
  store_payment_gateway: z
    .array(z.object({ label: z.string().trim().min(1).max(100), image_url: z.string().trim().url().max(500) }))
    .max(3)
    .default([]),
});

/** `price` in centavos. */
const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  price: z.number().int().min(0).max(10_000_000),
  image_url: z.string().trim().url().max(500).nullable().default(null),
  discount_percent: z.number().int().min(0).max(100).default(0),
  category: z.string().trim().max(50).default(''),
  best_seller: z.boolean().default(false),
});

/** Every item id on the menu, in the new order. */
const menuOrderSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) });

/** The owner's food shop for menu edits, or 404/409. */
async function myFoodStore(c: Context<AppEnv>) {
  const id = parseId(c);
  const store = await c.env.DB.prepare('SELECT type FROM stores WHERE id = ? AND owner_id = ?').bind(id, c.get('user').id).first<{ type: string }>();
  if (!store) fail(404, 'Shop not found');
  if (store.type !== 'food') fail(409, 'Only food shops have a menu');
  return id;
}

/** Without store_id the block applies to every shop the owner runs. */
const blockSchema = z.object({ driver_id: z.number().int().positive(), blocked: z.boolean(), store_id: z.number().int().positive().optional() });

const PAYOUT_SELECT = `SELECT p.*, u.name AS payee_name, s.name AS store_name FROM payouts p LEFT JOIN users u ON u.id = p.payee_id LEFT JOIN stores s ON s.id = p.payer_store_id`;

/** Every shop this owner runs (an owner may run several). */
async function myStoreIds(c: Context<AppEnv>) {
  const { results } = await c.env.DB.prepare('SELECT id FROM stores WHERE owner_id = ? ORDER BY id').bind(c.get('user').id).all<{ id: number }>();
  if (results.length === 0) fail(409, 'No shop linked to your account yet');
  return results.map((s) => s.id);
}

const pageSchema = z.object({
  /** `next` from the previous page. */
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function pageQuery(c: Context<AppEnv>) {
  const parsed = pageSchema.safeParse({ before: c.req.query('before'), limit: c.req.query('limit') });
  if (!parsed.success) fail(400, 'Invalid page query');
  return parsed.data;
}

/** Splits a `next` cursor into its parts, or 400s. */
function cursorParts(before: string, count: number) {
  const parts = before.split('|');
  if (parts.length !== count || parts.some((p) => p === '')) fail(400, 'Invalid page cursor');
  return parts;
}

/** `IN (?, ?, …)` for a list of ids. */
const inList = (ids: number[]) => `(${ids.map(() => '?').join(', ')})`;

/** Owner list order: not yet paid, waiting for confirmation, confirmed, complete. */
const OWNER_RANKS = ['payment_pending', 'dropped_off', 'owner_confirmed', 'completed'];
const OWNER_RANK = `CASE t.status ${OWNER_RANKS.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} END`;

const owner = new Hono<AppEnv>();
owner.use('*', requireAuth, requireRole('owner'));

/** How many shops this owner may run (`users.maxstore`). */
async function maxStores(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare('SELECT maxstore FROM users WHERE id = ?').bind(c.get('user').id).first<{ maxstore: number }>();
  return row?.maxstore ?? 0;
}

owner.get('/stores', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM stores WHERE owner_id = ? ORDER BY name').bind(c.get('user').id).all<StoreRow>();
  return c.json({ stores: results.map(toStore), maxstore: await maxStores(c) });
});

owner.post('/stores', async (c) => {
  const s = await parseBody(c, storeSchema);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM stores WHERE owner_id = ?').bind(c.get('user').id).first<{ n: number }>();
  if ((count?.n ?? 0) >= (await maxStores(c))) fail(409, 'Shop limit reached');
  const store = await c.env.DB.prepare(
    'INSERT INTO stores (name, type, address, lat, lng, store_logo, store_payment_gateway, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(s.name, s.type, s.address, s.lat, s.lng, s.store_logo, JSON.stringify(s.store_payment_gateway), c.get('user').id)
    .first<StoreRow>();
  return c.json({ store: toStore(store!) }, 201);
});

/** The app shrinks logos and QRs to fit before uploading. */
const MAX_STORE_IMAGE_BYTES = 1024 * 1024;

/** Raw JPEG/PNG body for a logo or payment QR; works before the shop exists. Returns the public URL to save on the shop. */
owner.post('/stores/image', async (c) => {
  const ownerId = c.get('user').id;
  const { body, type, ext } = await readPhoto(c, MAX_STORE_IMAGE_BYTES);
  const file = `${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(`stores/${ownerId}/${file}`, body, { httpMetadata: { contentType: type } });
  return c.json({ image_url: storeImageUrl(new URL(c.req.url).origin, ownerId, file) }, 201);
});

/** Removes uploaded logos and QRs the shop no longer shows. */
function dropStoreImages(c: Context<AppEnv>, before: string[], after: string[] = []) {
  const gone = before.filter((key) => !after.includes(key));
  if (gone.length > 0) c.executionCtx.waitUntil(c.env.PROOFS.delete(gone));
}

owner.post('/stores/:id', async (c) => {
  const id = parseId(c);
  const s = await parseBody(c, storeSchema);
  const db = c.env.DB;
  const ownerId = c.get('user').id;
  const before = await db.prepare('SELECT * FROM stores WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<StoreRow>();
  if (!before) fail(404, 'Shop not found');
  const row = await db
    .prepare(
      `UPDATE stores SET name = ?, type = ?, address = ?, lat = ?, lng = ?, store_logo = ?, store_payment_gateway = ?
       WHERE id = ? AND owner_id = ? RETURNING *`,
    )
    .bind(s.name, s.type, s.address, s.lat, s.lng, s.store_logo, JSON.stringify(s.store_payment_gateway), id, ownerId)
    .first<StoreRow>();
  if (!row) fail(404, 'Shop not found');
  const store = toStore(row);
  dropStoreImages(c, storeImageKeys(toStore(before)), storeImageKeys(store));
  return c.json({ store });
});

/** Only shops with no orders, drop offs or payouts: their history must stay intact. */
owner.delete('/stores/:id', async (c) => {
  const id = parseId(c);
  const db = c.env.DB;
  const store = await db.prepare('SELECT * FROM stores WHERE id = ? AND owner_id = ?').bind(id, c.get('user').id).first<StoreRow>();
  if (!store) fail(404, 'Shop not found');
  const used = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM transactions WHERE store_id = ?1) OR EXISTS (SELECT 1 FROM orders WHERE store_id = ?1)
         OR EXISTS (SELECT 1 FROM payouts WHERE payer_store_id = ?1) AS used`,
    )
    .bind(id)
    .first<{ used: number }>();
  if (used?.used) fail(409, 'This shop has order history and cannot be deleted');
  await db.batch([
    db.prepare('DELETE FROM store_menu_items WHERE store_id = ?').bind(id),
    db.prepare('DELETE FROM driver_blocks WHERE store_id = ?').bind(id),
    db.prepare('DELETE FROM stores WHERE id = ?').bind(id),
  ]);
  dropStoreImages(c, storeImageKeys(toStore(store)));
  return c.json({ deleted: true });
});

owner.post('/stores/:id/menu', async (c) => {
  const storeId = await myFoodStore(c);
  const m = await parseBody(c, menuItemSchema);
  const row = await c.env.DB.prepare(
    `INSERT INTO store_menu_items (store_id, name, price, image_url, discount_percent, category, best_seller, sort_order)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM store_menu_items WHERE store_id = ?1)) RETURNING id`,
  )
    .bind(storeId, m.name, m.price, m.image_url, m.discount_percent, m.category, m.best_seller ? 1 : 0)
    .first<{ id: number }>();
  return c.json({ item: await getMenuItem(c.env.DB, storeId, row!.id) }, 201);
});

/** The app shrinks menu photos to fit before uploading. */
const MAX_MENU_IMAGE_BYTES = 1024 * 1024;

/** Raw JPEG/PNG body. Returns the public URL to save as an item's `image_url`. */
owner.post('/stores/:id/menu/image', async (c) => {
  const storeId = await myFoodStore(c);
  const { body, type, ext } = await readPhoto(c, MAX_MENU_IMAGE_BYTES);
  const file = `${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(`menu/${storeId}/${file}`, body, { httpMetadata: { contentType: type } });
  return c.json({ image_url: menuImageUrl(new URL(c.req.url).origin, storeId, file) }, 201);
});

/** Removes an uploaded photo the menu no longer uses. */
function dropImage(c: Context<AppEnv>, before: string | null | undefined, after: string | null = null) {
  const key = menuImageKey(before);
  if (key && before !== after) c.executionCtx.waitUntil(c.env.PROOFS.delete(key));
}

/** Must list every item exactly once, so a stale list can't scramble the menu. */
owner.post('/stores/:id/menu/order', async (c) => {
  const storeId = await myFoodStore(c);
  const { ids } = await parseBody(c, menuOrderSchema);
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT id FROM store_menu_items WHERE store_id = ?').bind(storeId).all<{ id: number }>();
  const current = new Set(results.map((r) => r.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) {
    fail(409, 'The menu changed. Pull to refresh and try again.');
  }
  if (ids.length > 0) {
    await db.batch(ids.map((id, i) => db.prepare('UPDATE store_menu_items SET sort_order = ? WHERE id = ? AND store_id = ?').bind(i + 1, id, storeId)));
  }
  return c.json({ menu: await listMenu(db, storeId) });
});

owner.post('/stores/:id/menu/:itemId', async (c) => {
  const storeId = await myFoodStore(c);
  const itemId = parseId(c, 'itemId');
  const m = await parseBody(c, menuItemSchema);
  const before = await getMenuItem(c.env.DB, storeId, itemId);
  const { meta } = await c.env.DB.prepare(
    'UPDATE store_menu_items SET name = ?, price = ?, image_url = ?, discount_percent = ?, category = ?, best_seller = ? WHERE id = ? AND store_id = ?',
  )
    .bind(m.name, m.price, m.image_url, m.discount_percent, m.category, m.best_seller ? 1 : 0, itemId, storeId)
    .run();
  if (meta.changes === 0) fail(404, 'Menu item not found');
  dropImage(c, before?.image_url, m.image_url);
  return c.json({ item: await getMenuItem(c.env.DB, storeId, itemId) });
});

/** Past orders keep their own copy of each item's name and price, so this is safe. */
owner.delete('/stores/:id/menu/:itemId', async (c) => {
  const storeId = await myFoodStore(c);
  const itemId = parseId(c, 'itemId');
  const before = await getMenuItem(c.env.DB, storeId, itemId);
  const { meta } = await c.env.DB.prepare('DELETE FROM store_menu_items WHERE id = ? AND store_id = ?').bind(itemId, storeId).run();
  if (meta.changes === 0) fail(404, 'Menu item not found');
  dropImage(c, before?.image_url);
  return c.json({ deleted: true });
});

/** Sorted by OWNER_RANKS, then newest; 10 per page, `next` fetches older ones. */
owner.get('/transactions', async (c) => {
  const storeIds = await myStoreIds(c);
  const { before, limit } = pageQuery(c);
  const statuses = c.req.query('status') === 'pending' ? "('dropped_off')" : "('dropped_off', 'owner_confirmed', 'completed', 'payment_pending')";
  let cursor = '';
  const binds: unknown[] = [...storeIds];
  if (before) {
    const [rank, at, id] = cursorParts(before, 3);
    cursor = `AND (${OWNER_RANK} > ? OR (${OWNER_RANK} = ? AND (t.updated_at < ? OR (t.updated_at = ? AND t.id < ?))))`;
    binds.push(Number(rank), Number(rank), at, at, Number(id));
  }
  const rows = await listDropoffs(
    c.env.DB,
    `t.store_id IN ${inList(storeIds)} AND t.status IN ${statuses} ${cursor}
     ORDER BY ${OWNER_RANK}, t.updated_at DESC, t.id DESC LIMIT ${limit + 1}`,
    ...binds,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({
    dropoffs: page.map((r) => viewFor(r, c.get('user'))),
    next: rows.length > limit && last ? `${OWNER_RANKS.indexOf(last.status)}|${last.updated_at}|${last.id}` : null,
  });
});

/** Pickup orders at the owner's shops with their lines, newest first; 10 per page, `next` fetches older ones. */
owner.get('/orders', async (c) => {
  const storeIds = await myStoreIds(c);
  const { before, limit } = pageQuery(c);
  const binds: unknown[] = [...storeIds];
  if (before) binds.push(Number(cursorParts(before, 1)[0]));
  const rows = await listOrders(
    c.env.DB,
    `o.store_id IN ${inList(storeIds)} ${before ? 'AND o.id < ?' : ''} ORDER BY o.id DESC LIMIT ${limit + 1}`,
    ...binds,
  );
  const page = await Promise.all(rows.slice(0, limit).map((o) => getOrder(c.env.DB, o.id)));
  const last = page[page.length - 1];
  return c.json({ orders: page, next: rows.length > limit && last ? String(last.id) : null });
});

/** One of the owner's orders, or 404. */
async function myOrder(c: Context<AppEnv>) {
  const storeIds = await myStoreIds(c);
  const order = await getOrder(c.env.DB, parseId(c));
  if (!order || !storeIds.includes(order.store_id)) fail(404, 'Order not found');
  return order;
}

owner.get('/orders/:id/payment-photo', async (c) => {
  const order = await myOrder(c);
  return photoResponse(c.env.PROOFS, order.payment_photo_key);
});

/** Done Pay: the owner saw the payment; the customer can now place the order. */
owner.post('/orders/:id/confirm-payment', async (c) => {
  const order = await myOrder(c);
  const db = c.env.DB;
  const { meta } = await db
    .prepare("UPDATE orders SET status = 'payment_confirmed', updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_payment'")
    .bind(order.id)
    .run();
  if (meta.changes === 0) fail(409, 'This order is not waiting for payment');
  c.executionCtx.waitUntil(
    pushToUsers(db, [order.customer_id], 'Payment confirmed', `${order.store_name} confirmed your payment. Place your order now.`, { order_id: order.id }),
  );
  return c.json({ order: await getOrder(db, order.id) });
});

owner.post('/transactions/:id/confirm', async (c) => {
  const storeIds = await myStoreIds(c);
  const id = parseId(c);
  const db = c.env.DB;
  const row = await getDropoff(db, id);
  if (!row || !storeIds.includes(row.store_id)) fail(404, 'Drop off not found');
  const storeId = row.store_id;

  const stillDroppedOff = "EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'dropped_off')";
  const results = await db.batch([
    db
      .prepare(`UPDATE owner_transactions SET status = 'ok', updated_at = datetime('now') WHERE transaction_id = ? AND ${stillDroppedOff}`)
      .bind(id, id),
    db
      .prepare(`INSERT INTO payouts (transaction_id, payer_store_id, payee_type, payee_id, amount) SELECT ?, ?, 'driver', ?, ? WHERE ${stillDroppedOff}`)
      .bind(id, storeId, row.driver_id, row.delivery_fee, id),
    db
      .prepare(`INSERT INTO payouts (transaction_id, payer_store_id, payee_type, payee_id, amount) SELECT ?, ?, 'developer', NULL, ? WHERE ${stillDroppedOff}`)
      .bind(id, storeId, row.service_fee, id),
    db
      .prepare(
        `INSERT INTO driver_data (user_id, earnings) SELECT ?, ? WHERE ${stillDroppedOff}
         ON CONFLICT (user_id) DO UPDATE SET earnings = earnings + excluded.earnings, updated_at = datetime('now')`,
      )
      .bind(row.driver_id, row.delivery_fee, id),
    db
      .prepare("UPDATE transactions SET status = 'owner_confirmed', updated_at = datetime('now') WHERE id = ? AND status = 'dropped_off'")
      .bind(id),
  ]);
  if (results[4].meta.changes === 0) fail(409, 'Only a dropped-off laundry can be confirmed');
  c.executionCtx.waitUntil(
    pushToUsers(db, [row.customer_id], 'Laundry received', 'The shop confirmed your drop off. Check your summary.', { transaction_id: id }),
  );
  return c.json({ dropoff: viewFor((await getDropoff(db, id))!, c.get('user')) });
});

/** Pending first, then newest; 10 per page, `next` fetches older ones. */
owner.get('/payouts', async (c) => {
  const storeIds = await myStoreIds(c);
  const { before, limit } = pageQuery(c);
  let cursor = '';
  const binds: unknown[] = [...storeIds];
  if (before) {
    const [status, id] = cursorParts(before, 2);
    cursor = 'AND (p.status < ? OR (p.status = ? AND p.id < ?))';
    binds.push(status, status, Number(id));
  }
  const { results } = await c.env.DB.prepare(
    `${PAYOUT_SELECT} WHERE p.payer_store_id IN ${inList(storeIds)} ${cursor} ORDER BY p.status DESC, p.id DESC LIMIT ${limit + 1}`,
  )
    .bind(...binds)
    .all<{ id: number; status: string }>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({ payouts: page, next: results.length > limit && last ? `${last.status}|${last.id}` : null });
});

owner.post('/payouts/:id/paid', async (c) => {
  const storeIds = await myStoreIds(c);
  const id = parseId(c);
  const db = c.env.DB;
  const { meta } = await db
    .prepare(`UPDATE payouts SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND payer_store_id IN ${inList(storeIds)} AND status = 'pending'`)
    .bind(id, ...storeIds)
    .run();
  if (meta.changes === 0) {
    const exists = await db.prepare(`SELECT id FROM payouts WHERE id = ? AND payer_store_id IN ${inList(storeIds)}`).bind(id, ...storeIds).first();
    if (!exists) fail(404, 'Payout not found');
    fail(409, 'Payout is already marked paid');
  }
  return c.json({ payout: await db.prepare(`${PAYOUT_SELECT} WHERE p.id = ?`).bind(id).first() });
});

owner.post('/blocks', async (c) => {
  const storeIds = await myStoreIds(c);
  const { driver_id, blocked, store_id } = await parseBody(c, blockSchema);
  if (store_id !== undefined && !storeIds.includes(store_id)) fail(404, 'Shop not found');
  const db = c.env.DB;
  const driver = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'driver'").bind(driver_id).first();
  if (!driver) fail(404, 'Driver not found');

  await db.batch(
    (store_id !== undefined ? [store_id] : storeIds).map((storeId) =>
      blocked
        ? db.prepare('INSERT OR IGNORE INTO driver_blocks (store_id, driver_id) VALUES (?, ?)').bind(storeId, driver_id)
        : db.prepare('DELETE FROM driver_blocks WHERE store_id = ? AND driver_id = ?').bind(storeId, driver_id),
    ),
  );
  return c.json({ blocked });
});

export default owner;
