import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api, placeOrder, registerUser } from './helpers';

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
  it('creates a food pickup with server-computed prices, waiting for the store to confirm payment', async () => {
    const res = await api('/orders', { token: customer, body: { ...foodOrder, payment_ref: 'GCASH-123' } });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      type: 'pickup',
      status: 'awaiting_payment',
      payment_ref: 'GCASH-123',
      payment_photo_key: null,
      store_id: 1,
      store_name: 'Tea Haven',
      store_type: 'food',
      items_total: 2 * 12000 + 12500,
      delivery_fee: 5000,
      service_fee: 0,
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
    const id = (await placeOrder({ token: customer, body: foodOrder })).body.order.id;
    expect((await api(`/orders/${id}`, { token: customer })).body.order.items.map((i: { image_url: string | null }) => i.image_url)).toEqual([
      'https://img.test/tea.jpg',
      null,
    ]);

    await env.DB.prepare('DELETE FROM store_menu_items WHERE id = 1').run();
    expect((await api(`/orders/${id}`, { token: customer })).body.order.items[0]).toMatchObject({ name: 'Wintermelon Milk Tea', image_url: null });
  });

  it('prices delivery by road distance when the customer pins a location, like a drop off', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 1').run();
    const pinned = { ...foodOrder, customer_address: undefined, notes: undefined, lat: 14.56, lng: 121.03 };

    const quote = await api('/orders/quote', { token: customer, body: { store_id: 1, lat: 14.56, lng: 121.03 } });
    expect(quote).toEqual({ status: 200, body: { quote: { road_km: 3.2, delivery_fee: 7920 } } });

    const res = await placeOrder({ token: customer, body: pinned });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ delivery_fee: 7920, service_fee: 720, customer_address: 'Pinned location 14.56000, 121.03000', notes: '' });
  });

  it("can't quote a store without a map location", async () => {
    const res = await api('/orders/quote', { token: customer, body: { store_id: 1, lat: 14.56, lng: 121.03 } });
    expect(res).toEqual({ status: 400, body: { error: 'store_id: this store has no map location yet' } });
  });

  it('requires at least one item for food', async () => {
    const res = await placeOrder({ token: customer, body: { ...foodOrder, items: [] } });
    expect(res).toEqual({ status: 400, body: { error: 'Add at least one item' } });
  });

  it("rejects an item from another store's menu", async () => {
    const res = await placeOrder({ token: customer, body: { ...foodOrder, items: [{ menu_item_id: 5, qty: 1 }] } });
    expect(res.status).toBe(400);
  });

  it('rejects zero or huge quantities', async () => {
    expect((await placeOrder({ token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 0 }] } })).status).toBe(400);
    expect((await placeOrder({ token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 51 }] } })).status).toBe(400);
  });

  it('creates a laundry pickup with no items', async () => {
    const res = await placeOrder({
      token: customer,
      body: { type: 'pickup', store_id: 4, customer_address: '1 Customer St', notes: 'ticket #42' },
    });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ store_type: 'laundry', items_total: 0, delivery_fee: 5000, items: [] });
  });

  it('rejects drop offs (they go through /dropoffs)', async () => {
    const res = await placeOrder({ token: customer, body: { type: 'dropoff', store_id: 5, customer_address: '1 Customer St' } });
    expect(res.status).toBe(400);
  });

  it('rejects menu items on laundry orders', async () => {
    const res = await placeOrder({
      token: customer,
      body: { type: 'pickup', store_id: 4, items: [{ menu_item_id: 1, qty: 1 }], customer_address: '1 Customer St' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing address and unknown store', async () => {
    expect((await placeOrder({ token: customer, body: { ...foodOrder, customer_address: '' } })).status).toBe(400);
    expect((await placeOrder({ token: customer, body: { ...foodOrder, store_id: 999 } })).status).toBe(404);
  });

  it('forbids drivers from ordering', async () => {
    const driver = (await registerUser('driver')).token;
    expect((await placeOrder({ token: driver, body: foodOrder })).status).toBe(403);
  });
});

describe('reading and cancelling orders', () => {
  it("lists only the customer's own orders, newest first", async () => {
    const first = await placeOrder({ token: customer, body: foodOrder });
    const second = await placeOrder({ token: customer, body: { type: 'pickup', store_id: 4, customer_address: '1 Customer St' } });
    await placeOrder({ token: other, body: foodOrder });

    const res = await api('/orders', { token: customer });
    expect(res.body.orders.map((o: { id: number }) => o.id)).toEqual([second.body.order.id, first.body.order.id]);
  });

  it("forbids reading another customer's order", async () => {
    const { body } = await placeOrder({ token: customer, body: foodOrder });
    expect((await api(`/orders/${body.order.id}`, { token: customer })).status).toBe(200);
    expect((await api(`/orders/${body.order.id}`, { token: other })).status).toBe(403);
  });

  it('lets a driver read a pending order', async () => {
    const { body } = await placeOrder({ token: customer, body: foodOrder });
    const driver = (await registerUser('driver')).token;
    expect((await api(`/orders/${body.order.id}`, { token: driver })).status).toBe(200);
  });

  it('404s for unknown or non-numeric ids', async () => {
    expect((await api('/orders/999', { token: customer })).status).toBe(404);
    expect((await api('/orders/abc', { token: customer })).status).toBe(404);
  });

  it('cancels a pending order once, only by its owner', async () => {
    const { body } = await placeOrder({ token: customer, body: foodOrder });
    const id = body.order.id;

    expect((await api(`/orders/${id}/cancel`, { token: other, method: 'POST' })).status).toBe(403);

    const res = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');

    const again = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(again).toEqual({ status: 409, body: { error: 'Order can no longer be cancelled' } });
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

const uploadPayment = async (token: string, body: Uint8Array = JPEG) => {
  const res = await SELF.fetch('https://api.test/orders/payment-photo', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
  return { status: res.status, body: (await res.json()) as { key?: string; error?: string } };
};

describe('paying for a food order', () => {
  let owner: string;

  beforeEach(async () => {
    const o = await registerUser('owner');
    owner = o.token;
    await env.DB.prepare('UPDATE stores SET owner_id = ? WHERE id = 1').bind(o.user.id).run();
  });

  it('needs a reference number or a payment photo', async () => {
    const res = await api('/orders', { token: customer, body: foodOrder });
    expect(res).toEqual({ status: 400, body: { error: 'Add a reference number or a photo of your payment' } });
  });

  it('takes a payment photo instead of a reference number', async () => {
    const upload = await uploadPayment(customer);
    expect(upload.status).toBe(201);
    const res = await api('/orders', { token: customer, body: { ...foodOrder, payment_photo_key: upload.body.key } });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'awaiting_payment', payment_ref: '' });

    const id = res.body.order.id;
    const photo = await SELF.fetch(`https://api.test/owner/orders/${id}/payment-photo`, { headers: { authorization: `Bearer ${owner}` } });
    expect(photo.status).toBe(200);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
  });

  it("rejects another customer's or a missing payment photo", async () => {
    const theirs = (await uploadPayment(other)).body.key;
    for (const key of [theirs, `payments/0/nope.jpg`]) {
      const res = await api('/orders', { token: customer, body: { ...foodOrder, payment_photo_key: key } });
      expect(res).toEqual({ status: 400, body: { error: 'payment_photo_key: upload the photo first' } });
    }
  });

  it('rejects a payment photo that is not an image', async () => {
    expect((await uploadPayment(customer, new Uint8Array([1, 2, 3]))).status).toBe(400);
  });

  it('can only be placed after the owner taps Done Pay', async () => {
    const id = (await api('/orders', { token: customer, body: { ...foodOrder, payment_ref: 'GCASH-123' } })).body.order.id;
    const driver = (await registerUser('driver')).token;
    const onBoard = async () => (await api('/jobs/available', { token: driver })).body.jobs.map((j: { id: number }) => j.id);

    expect(await onBoard()).not.toContain(id);
    expect(await api(`/orders/${id}/place`, { token: customer, method: 'POST' })).toEqual({
      status: 409,
      body: { error: 'The store has not confirmed your payment yet' },
    });

    const list = await api('/owner/orders', { token: owner });
    expect(list.body.orders[0]).toMatchObject({ id, status: 'awaiting_payment', payment_ref: 'GCASH-123', items: expect.any(Array) });

    const done = await api(`/owner/orders/${id}/confirm-payment`, { token: owner, method: 'POST' });
    expect(done.body.order.status).toBe('payment_confirmed');
    expect((await api(`/owner/orders/${id}/confirm-payment`, { token: owner, method: 'POST' })).status).toBe(409);

    expect((await api(`/orders/${id}/place`, { token: other, method: 'POST' })).status).toBe(404);
    const placed = await api(`/orders/${id}/place`, { token: customer, method: 'POST' });
    expect(placed.body.order.status).toBe('pending');
    expect(await onBoard()).toContain(id);
  });

  it("hides other shops' orders from the owner", async () => {
    const id = (await api('/orders', { token: customer, body: { ...foodOrder, payment_ref: 'GCASH-123' } })).body.order.id;
    const stranger = await registerUser('owner');
    await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('Other', 'food', 'x', ?)").bind(stranger.user.id).run();
    expect((await api('/owner/orders', { token: stranger.token })).body.orders).toEqual([]);
    expect((await api(`/owner/orders/${id}/confirm-payment`, { token: stranger.token, method: 'POST' })).status).toBe(404);
  });

  it('can be cancelled while waiting for payment', async () => {
    const id = (await api('/orders', { token: customer, body: { ...foodOrder, payment_ref: 'GCASH-123' } })).body.order.id;
    expect((await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' })).body.order.status).toBe('cancelled');
  });
});
