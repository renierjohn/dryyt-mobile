import { Hono } from 'hono';

import { requireAuth } from '../lib/auth';
import { fail } from '../lib/http';
import { toItem, type MenuRow } from '../lib/menu';
import type { AppEnv, PopularItem } from '../types';

const menu = new Hono<AppEnv>();
menu.use('*', requireAuth);

/** Food items customers order most, across all stores; best sellers then newest break ties (and fill in before any orders). */
menu.get('/popular', async (c) => {
  const limit = Number(c.req.query('limit') ?? 4);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit must be a whole number from 1 to 50');

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.price, m.image_url, m.discount_percent, m.category, m.best_seller, m.popularity,
            s.id AS store_id, s.name AS store_name, s.store_logo
     FROM store_menu_items m JOIN stores s ON s.id = m.store_id
     WHERE s.type = 'food'
     ORDER BY m.popularity DESC, m.best_seller DESC, m.id DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<MenuRow & Pick<PopularItem, 'store_id' | 'store_name' | 'store_logo'>>();
  return c.json({ items: results.map(toItem) });
});

export default menu;
