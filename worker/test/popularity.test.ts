import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api, placeOrder, registerUser, registerVerifiedDriver } from './helpers';

const popularity = async (id: number) =>
  (await env.DB.prepare('SELECT popularity FROM store_menu_items WHERE id = ?').bind(id).first<{ popularity: number }>())!.popularity;

/** The migration's UPDATE statements, re-run against the current data (orders is transactions_pickup since 0021). */
async function rerunBackfill() {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0013_'))!;
  for (const sql of migration.queries.filter((q) => q.trim().toUpperCase().startsWith('UPDATE'))) await env.DB.prepare(sql.replace(/\bJOIN orders\b/g, 'JOIN transactions_pickup')).run();
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
      placeOrder({ token, body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 6, qty }], customer_address: '1 Customer St, Makati' } });
    const delivered = (await place(3)).body.order.id;
    const cancelled = (await place(5)).body.order.id;
    // Old data: lines without menu_item_id.
    await env.DB.batch([
      env.DB.prepare('UPDATE order_items SET menu_item_id = NULL'),
      env.DB.prepare("UPDATE transactions_pickup SET status = 'delivered' WHERE id = ?").bind(delivered),
      env.DB.prepare("UPDATE transactions_pickup SET status = 'cancelled' WHERE id = ?").bind(cancelled),
    ]);

    await rerunBackfill();

    expect(await popularity(6)).toBe(3);
    expect(await popularity(5)).toBe(0);
  });

  it('lets an owner delete an item that has order history, unlinking its order lines', async () => {
    const owner = (await registerUser('owner')).token;
    const { token } = await registerUser('customer');
    const storeId = (
      await api('/owner/stores', { token: owner, body: { name: 'Bites', type: 'food', address: '1 Main St', lat: 14.55, lng: 121.02 } })
    ).body.store.id;
    const itemId = (await api(`/owner/stores/${storeId}/menu`, { token: owner, body: { name: 'Fries', price: 5000 } })).body.item.id;
    const orderId = (
      await placeOrder({
        token,
        body: { type: 'pickup', store_id: storeId, items: [{ menu_item_id: itemId, qty: 1 }], customer_address: '1 Customer St, Makati' },
      })
    ).body.order.id;
    // Task 2 will write this on insert; link it by hand for now.
    await env.DB.prepare('UPDATE order_items SET menu_item_id = ? WHERE order_id = ?').bind(itemId, orderId).run();

    const res = await api(`/owner/stores/${storeId}/menu/${itemId}`, { token: owner, method: 'DELETE' });

    expect(res.status).toBe(200);
    const line = await env.DB.prepare('SELECT menu_item_id FROM order_items WHERE order_id = ?').bind(orderId).first<{ menu_item_id: number | null }>();
    expect(line!.menu_item_id).toBeNull();
  });

  async function deliveredOrder(items: { menu_item_id: number; qty: number }[]) {
    const customer = (await registerUser('customer')).token;
    const driver = (await registerVerifiedDriver()).token;
    const id = (await placeOrder({ token: customer, body: { type: 'pickup', store_id: 2, items, customer_address: '1 Customer St, Makati' } })).body.order.id;
    await api(`/jobs/${id}/accept`, { token: driver, method: 'POST' });
    await api(`/jobs/${id}/status`, { token: driver, body: { status: 'picked_up' } });
    return { id, driver, deliver: () => api(`/jobs/${id}/status`, { token: driver, body: { status: 'delivered' } }) };
  }

  it('links new order lines to their menu item', async () => {
    const { token } = await registerUser('customer');
    const id = (await placeOrder({ token, body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 7, qty: 2 }], customer_address: '1 Customer St, Makati' } })).body.order.id;
    const line = await env.DB.prepare('SELECT menu_item_id FROM order_items WHERE order_id = ?').bind(id).first();
    expect(line).toEqual({ menu_item_id: 7 });
  });

  it('adds delivered quantities once', async () => {
    const order = await deliveredOrder([{ menu_item_id: 5, qty: 2 }, { menu_item_id: 7, qty: 1 }, { menu_item_id: 5, qty: 1 }]);
    expect(await popularity(5)).toBe(0);

    expect((await order.deliver()).status).toBe(200);
    expect(await popularity(5)).toBe(3);
    expect(await popularity(7)).toBe(1);

    expect((await order.deliver()).status).toBe(409);
    expect(await popularity(5)).toBe(3);
  });

  it('delivers even if an ordered item was deleted', async () => {
    const order = await deliveredOrder([{ menu_item_id: 8, qty: 1 }]);
    await env.DB.prepare('DELETE FROM store_menu_items WHERE id = 8').run();
    expect((await order.deliver()).status).toBe(200);
  });
});
