import type { OrderDetail, OrderItem, OrderRow } from '../types';

/** Drivers only get the customer's phone once the job is theirs. */
export const hidePhone = <T extends OrderRow>(order: T): T => ({ ...order, customer_phone: null });

const ORDER_SELECT = `
  SELECT o.*,
    s.name AS store_name, s.address AS store_address, s.type AS store_type,
    cu.name AS customer_name, cu.phone AS customer_phone,
    d.name AS driver_name, d.phone AS driver_phone
  FROM orders o
  JOIN stores s ON s.id = o.store_id
  JOIN users cu ON cu.id = o.customer_id
  LEFT JOIN users d ON d.id = o.driver_id`;

/** `clause` is trusted SQL written in this codebase (WHERE ... ORDER BY ...); values go in `binds`. */
export async function listOrders(db: D1Database, clause: string, ...binds: unknown[]) {
  const { results } = await db.prepare(`${ORDER_SELECT} WHERE ${clause}`).bind(...binds).all<OrderRow>();
  return results;
}

export async function getOrder(db: D1Database, id: number): Promise<OrderDetail | null> {
  const order = await db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first<OrderRow>();
  if (!order) return null;
  const { results: items } = await db
    // The photo comes from the menu item as it is now (none once it's deleted); name and price stay as ordered.
    .prepare(
      `SELECT oi.id, oi.name, oi.price, oi.qty, m.image_url
       FROM order_items oi LEFT JOIN store_menu_items m ON m.id = oi.menu_item_id
       WHERE oi.order_id = ? ORDER BY oi.id`,
    )
    .bind(id)
    .all<OrderItem>();
  return { ...order, items };
}
