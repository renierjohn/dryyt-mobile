import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let customer: string;
let other: string;

beforeEach(async () => {
  customer = (await registerUser('customer')).token;
  other = (await registerUser('customer')).token;
});

const foodOrder = {
  type: 'pickup',
  store_id: 1,
  items: [
    { menu_item_id: 1, qty: 2, price: 1 }, // client price must be ignored
    { menu_item_id: 3, qty: 1 },
  ],
  customer_address: '1 Customer St, Makati',
  notes: 'less ice',
};

describe('POST /orders', () => {
  it('creates a food pickup with server-computed prices', async () => {
    const res = await api('/orders', { token: customer, body: foodOrder });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      type: 'pickup',
      status: 'pending',
      store_id: 1,
      store_name: 'Tea Haven',
      store_type: 'food',
      items_total: 2 * 12000 + 12500,
      delivery_fee: 5000,
      driver_id: null,
      notes: 'less ice',
    });
    expect(res.body.order.items).toEqual([
      { id: expect.any(Number), name: 'Wintermelon Milk Tea', price: 12000, qty: 2, image_url: null },
      { id: expect.any(Number), name: 'Taro Milk Tea', price: 12500, qty: 1, image_url: null },
    ]);
  });

  it("shows each line's current menu photo, or none once the item is deleted", async () => {
    await env.DB.prepare("UPDATE store_menu_items SET image_url = 'https://img.test/tea.jpg' WHERE id = 1").run();
    const id = (await api('/orders', { token: customer, body: foodOrder })).body.order.id;
    expect((await api(`/orders/${id}`, { token: customer })).body.order.items.map((i: { image_url: string | null }) => i.image_url)).toEqual([
      'https://img.test/tea.jpg',
      null,
    ]);

    await env.DB.prepare('DELETE FROM store_menu_items WHERE id = 1').run();
    expect((await api(`/orders/${id}`, { token: customer })).body.order.items[0]).toMatchObject({ name: 'Wintermelon Milk Tea', image_url: null });
  });

  it('requires at least one item for food', async () => {
    const res = await api('/orders', { token: customer, body: { ...foodOrder, items: [] } });
    expect(res).toEqual({ status: 400, body: { error: 'Add at least one item' } });
  });

  it("rejects an item from another store's menu", async () => {
    const res = await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 5, qty: 1 }] } });
    expect(res.status).toBe(400);
  });

  it('rejects zero or huge quantities', async () => {
    expect((await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 0 }] } })).status).toBe(400);
    expect((await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 51 }] } })).status).toBe(400);
  });

  it('creates a laundry pickup with no items', async () => {
    const res = await api('/orders', {
      token: customer,
      body: { type: 'pickup', store_id: 4, customer_address: '1 Customer St', notes: 'ticket #42' },
    });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ store_type: 'laundry', items_total: 0, delivery_fee: 5000, items: [] });
  });

  it('rejects drop offs (they go through /dropoffs)', async () => {
    const res = await api('/orders', { token: customer, body: { type: 'dropoff', store_id: 5, customer_address: '1 Customer St' } });
    expect(res.status).toBe(400);
  });

  it('rejects menu items on laundry orders', async () => {
    const res = await api('/orders', {
      token: customer,
      body: { type: 'pickup', store_id: 4, items: [{ menu_item_id: 1, qty: 1 }], customer_address: '1 Customer St' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing address and unknown store', async () => {
    expect((await api('/orders', { token: customer, body: { ...foodOrder, customer_address: '' } })).status).toBe(400);
    expect((await api('/orders', { token: customer, body: { ...foodOrder, store_id: 999 } })).status).toBe(404);
  });

  it('forbids drivers from ordering', async () => {
    const driver = (await registerUser('driver')).token;
    expect((await api('/orders', { token: driver, body: foodOrder })).status).toBe(403);
  });
});

describe('reading and cancelling orders', () => {
  it("lists only the customer's own orders, newest first", async () => {
    const first = await api('/orders', { token: customer, body: foodOrder });
    const second = await api('/orders', { token: customer, body: { type: 'pickup', store_id: 4, customer_address: '1 Customer St' } });
    await api('/orders', { token: other, body: foodOrder });

    const res = await api('/orders', { token: customer });
    expect(res.body.orders.map((o: { id: number }) => o.id)).toEqual([second.body.order.id, first.body.order.id]);
  });

  it("forbids reading another customer's order", async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    expect((await api(`/orders/${body.order.id}`, { token: customer })).status).toBe(200);
    expect((await api(`/orders/${body.order.id}`, { token: other })).status).toBe(403);
  });

  it('lets a driver read a pending order', async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    const driver = (await registerUser('driver')).token;
    expect((await api(`/orders/${body.order.id}`, { token: driver })).status).toBe(200);
  });

  it('404s for unknown or non-numeric ids', async () => {
    expect((await api('/orders/999', { token: customer })).status).toBe(404);
    expect((await api('/orders/abc', { token: customer })).status).toBe(404);
  });

  it('cancels a pending order once, only by its owner', async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    const id = body.order.id;

    expect((await api(`/orders/${id}/cancel`, { token: other, method: 'POST' })).status).toBe(403);

    const res = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');

    const again = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(again).toEqual({ status: 409, body: { error: 'Order can no longer be cancelled' } });
  });
});
