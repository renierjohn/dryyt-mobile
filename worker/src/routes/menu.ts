import { Hono } from 'hono';

import { fail } from '../lib/http';
import { toItem, type MenuRow } from '../lib/menu';
import type { AppEnv, PopularItem } from '../types';

// Public: guests see popular items on the home screen before signing in.
const menu = new Hono<AppEnv>();

/**
 * Food items customers order most, across all stores; best sellers then newest break ties (and fill in before any orders).
 * `q` narrows to names containing it (any case), `category` to one category. `categories` lists every food category,
 * whatever the filters, so the app's filter chips stay put while searching.
 */
menu.get('/popular', async (c) => {
  const limit = Number(c.req.query('limit') ?? 4);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit must be a whole number from 1 to 50');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length > 50) fail(400, 'Search is limited to 50 characters');
  const category = c.req.query('category') ?? '';

  const db = c.env.DB;
  const [items, categories] = await db.batch([
    db
      .prepare(
        `SELECT m.id, m.name, m.price, m.image_url, m.discount_percent, m.category, m.best_seller, m.sold_out, m.popularity,
                s.id AS store_id, s.name AS store_name, s.store_logo
         FROM store_menu_items m JOIN stores s ON s.id = m.store_id
         WHERE s.type = 'food' AND (?1 = '' OR instr(lower(m.name), lower(?1)) > 0) AND (?2 = '' OR m.category = ?2)
         ORDER BY m.popularity DESC, m.best_seller DESC, m.id DESC
         LIMIT ?3`,
      )
      .bind(q, category, limit),
    db.prepare(
      `SELECT DISTINCT m.category FROM store_menu_items m JOIN stores s ON s.id = m.store_id
       WHERE s.type = 'food' AND m.category != '' ORDER BY m.category`,
    ),
  ]);
  return c.json({
    items: (items.results as (MenuRow & Pick<PopularItem, 'store_id' | 'store_name' | 'store_logo'>)[]).map(toItem),
    categories: (categories.results as { category: string }[]).map((r) => r.category),
  });
});

export default menu;
