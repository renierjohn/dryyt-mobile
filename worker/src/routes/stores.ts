import { Hono } from 'hono';

import { requireAuth } from '../lib/auth';
import { fail, parseId } from '../lib/http';
import { listMenu } from '../lib/menu';
import { toStore, type StoreRow } from '../lib/stores';
import type { AppEnv } from '../types';

const stores = new Hono<AppEnv>();
stores.use('*', requireAuth);

stores.get('/', async (c) => {
  const type = c.req.query('type');
  if (type !== undefined && type !== 'food' && type !== 'laundry') fail(400, 'type must be food or laundry');

  const query = type
    ? c.env.DB.prepare('SELECT * FROM stores WHERE type = ? ORDER BY name').bind(type)
    : c.env.DB.prepare('SELECT * FROM stores ORDER BY name');
  const { results } = await query.all<StoreRow>();
  return c.json({ stores: results.map(toStore) });
});

stores.get('/:id', async (c) => {
  const id = parseId(c);
  const store = await c.env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first<StoreRow>();
  if (!store) fail(404, 'Store not found');

  return c.json({ store: { ...toStore(store), menu: await listMenu(c.env.DB, id) } });
});

export default stores;
