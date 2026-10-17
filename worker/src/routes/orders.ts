import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { discountedPrice } from '../lib/fees';
import { fail, parseBody, parseId } from '../lib/http';
import { getOrder, hidePhone, listOrders } from '../lib/orders';
import type { AppEnv, StoreType } from '../types';

const createSchema = z.object({
  // Drop offs are v2 (/dropoffs); orders are pickups only.
  type: z.literal('pickup'),
  store_id: z.number().int().positive(),
  items: z
    .array(z.object({ menu_item_id: z.number().int().positive(), qty: z.number().int().min(1).max(50) }))
    .max(50)
    .default([]),
  customer_address: z.string().trim().min(5, 'Address is required'),
  notes: z.string().trim().max(500).default(''),
});

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

orders.post('/', requireRole('customer'), async (c) => {
  const input = await parseBody(c, createSchema);
  const db = c.env.DB;
  const customerId = c.get('user').id;

  const store = await db.prepare('SELECT id, type FROM stores WHERE id = ?').bind(input.store_id).first<{ id: number; type: StoreType }>();
  if (!store) fail(404, 'Store not found');

  let lines: Line[] = [];
  if (store.type === 'food') {
    if (input.items.length === 0) fail(400, 'Add at least one item');
    lines = await priceItems(db, store.id, input.items);
  } else if (input.items.length > 0) {
    fail(400, 'Laundry orders do not take menu items');
  }

  const itemsTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  // D1 batches run in one transaction, so MAX(id) for this customer is the order just inserted.
  const [created] = await db.batch([
    db
      .prepare('INSERT INTO orders (type, customer_id, store_id, customer_address, notes, items_total, delivery_fee) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(input.type, customerId, store.id, input.customer_address, input.notes, itemsTotal, Number(c.env.DELIVERY_FEE)),
    ...lines.map((l) =>
      db
        .prepare(
          'INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES ((SELECT MAX(id) FROM orders WHERE customer_id = ?), ?, ?, ?, ?)',
        )
        .bind(customerId, l.menuItemId, l.name, l.price, l.qty),
    ),
  ]);

  return c.json({ order: await getOrder(db, created.meta.last_row_id) }, 201);
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

orders.post('/:id/cancel', requireRole('customer'), async (c) => {
  const id = parseId(c);
  const db = c.env.DB;

  const order = await db.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<{ customer_id: number }>();
  if (!order) fail(404, 'Order not found');
  if (order.customer_id !== c.get('user').id) fail(403, 'You cannot cancel this order');

  const { meta } = await db
    .prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
  if (meta.changes === 0) fail(409, 'Order can no longer be cancelled');

  return c.json({ order: await getOrder(db, id) });
});

export default orders;
