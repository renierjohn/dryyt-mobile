import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

const popularity = async (id: number) =>
  (await env.DB.prepare('SELECT popularity FROM store_menu_items WHERE id = ?').bind(id).first<{ popularity: number }>())!.popularity;

/** The migration's UPDATE statements, re-run against the current data. */
async function rerunBackfill() {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0013_'))!;
  for (const sql of migration.queries.filter((q) => q.trim().toUpperCase().startsWith('UPDATE'))) await env.DB.prepare(sql).run();
}

describe('menu popularity', () => {
  it('starts at 0 and is part of the menu', async () => {
    const { token } = await registerUser('customer');
    const menu = (await api('/stores/1', { token })).body.store.menu;
    expect(menu[0].popularity).toBe(0);
  });

  it('backfills from delivered order lines matched by store and name', async () => {
    const { token } = await registerUser('customer');
    const place = (qty: number) =>
      api('/orders', { token, body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 6, qty }], customer_address: '1 Customer St, Makati' } });
    const delivered = (await place(3)).body.order.id;
    const cancelled = (await place(5)).body.order.id;
    // Old data: lines without menu_item_id.
    await env.DB.batch([
      env.DB.prepare('UPDATE order_items SET menu_item_id = NULL'),
      env.DB.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").bind(delivered),
      env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(cancelled),
    ]);

    await rerunBackfill();

    expect(await popularity(6)).toBe(3);
    expect(await popularity(5)).toBe(0);
  });
});
