import { env, fetchMock, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, placeOrder, registerUser, registerVerifiedDriver } from './helpers';

let customer: string;
let other: string;

beforeEach(async () => {
  customer = (await registerUser('customer')).token;
  other = (await registerUser('customer')).token;
});

const laundryOrder = { type: 'pickup', store_id: 4, lat: 14.56, lng: 121.03 };

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
      road_km: null,
      delivery_fee: 5000,
      service_fee: 0,
      total_delivery_fee: 5000,
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
    expect(quote).toEqual({
      status: 200,
      body: { quote: { road_km: 3.2, options: [{ vehicle_type: 2, base_fee: 4000, rate_per_km: 1000, total_delivery_fee: 8000, available: false }], token: expect.any(String) } },
    });

    // A verified driver online for pickup and free makes their vehicle available; offline, it isn't.
    const driver = await registerVerifiedDriver();
    const availability = async () => (await api('/orders/quote', { token: customer, body: { store_id: 1, lat: 14.56, lng: 121.03 } })).body.quote.options[0].available;
    await api('/drivers/me/pickup-online', { token: driver.token, body: { online: true } });
    expect(await availability()).toBe(true);
    await api('/drivers/me/pickup-online', { token: driver.token, body: { online: false } });
    expect(await availability()).toBe(false);

    const res = await placeOrder({ token: customer, body: pinned });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      road_km: 3.2,
      delivery_fee: 7200,
      service_fee: 800,
      total_delivery_fee: 8000,
      customer_address: 'Pinned location 14.56000, 121.03000',
      customer_lat: 14.56,
      customer_lng: 121.03,
      store_lat: 14.5547,
      store_lng: 121.0244,
      notes: '',
      vehicle_type: 2,
    });
  });

  it('prices with the vehicle the customer chose, and only drivers with that vehicle see the job', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 1').run();
    await env.DB.prepare(
      "INSERT INTO rates (group_id, type, category, base_fee, rate_per_km, commission_pct) VALUES ('default', 'pickup', 4, 10000, 2000, 10)",
    ).run();
    const pin = { lat: 14.56, lng: 121.03 };
    const quote = (await api('/orders/quote', { token: customer, body: { store_id: 1, ...pin } })).body.quote;
    // Car: 100 + 3.2 km × 20 = 164, + 10% = 180.40, rounded up to 181.
    expect(quote.options.map((o: { vehicle_type: number; total_delivery_fee: number }) => [o.vehicle_type, o.total_delivery_fee])).toEqual([
      [2, 8000],
      [4, 18100],
    ]);

    const pinned = { ...foodOrder, customer_address: undefined, ...pin, quote_token: quote.token };
    const car = await placeOrder({ token: customer, body: { ...pinned, vehicle_type: 4 } });
    expect(car.body.order).toMatchObject({ vehicle_type: 4, total_delivery_fee: 18100 });
    expect((await placeOrder({ token: customer, body: { ...pinned, vehicle_type: 3 } })).status).toBe(400); // no tricycle rate

    const moto = await registerVerifiedDriver();
    const carDriver = await registerVerifiedDriver();
    await env.DB.prepare('UPDATE driver_data SET vehicle_type = 4 WHERE user_id = ?').bind(carDriver.user.id).run();
    const ids = async (token: string) => (await api('/jobs/available', { token })).body.jobs.map((j: { id: number }) => j.id);
    expect(await ids(moto.token)).not.toContain(car.body.order.id);
    expect(await ids(carDriver.token)).toContain(car.body.order.id);
    expect((await api(`/jobs/${car.body.order.id}/accept`, { token: moto.token, method: 'POST' })).status).toBe(409);
    expect((await api(`/jobs/${car.body.order.id}/accept`, { token: carDriver.token, method: 'POST' })).status).toBe(200);
  });

  it('reuses the quote for the same store and pin instead of pricing the road again', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id IN (1, 2)').run();
    const pin = { lat: 14.56, lng: 121.03 };
    const pinned = { ...foodOrder, customer_address: undefined, ...pin };
    const token = (await api('/orders/quote', { token: customer, body: { store_id: 1, ...pin } })).body.quote.token as string;
    // A new rate after the quote: only an order priced again picks it up.
    await env.DB.prepare("UPDATE rates SET base_fee = 9000 WHERE group_id = 'default'").run();
    const repriced = (await api('/orders/quote', { token: customer, body: { store_id: 1, ...pin } })).body.quote.options[0].total_delivery_fee as number;
    expect(repriced).not.toBe(8000);

    const fee = async (body: Record<string, unknown>) => (await placeOrder({ token: customer, body })).body.order.total_delivery_fee;
    expect(await fee({ ...pinned, quote_token: token })).toBe(8000);
    expect(await fee({ ...pinned, quote_token: token, lat: 14.561 })).not.toBe(8000); // another pin
    expect(await fee({ ...pinned, quote_token: token, store_id: 2, items: [{ menu_item_id: 5, qty: 1 }] })).toBe(repriced); // another store
    expect(await fee({ ...pinned, quote_token: `${token}x` })).toBe(repriced); // tampered
    expect(await fee({ ...pinned, quote_token: customer })).toBe(repriced); // a session token is no quote
  });

  it('ignores an expired quote', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 1').run();
    const pin = { lat: 14.56, lng: 121.03 };
    const token = (await api('/orders/quote', { token: customer, body: { store_id: 1, ...pin } })).body.quote.token as string;
    await env.DB.prepare("UPDATE rates SET base_fee = 9000 WHERE group_id = 'default'").run();
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000, toFake: ['Date'] });
    try {
      const res = await placeOrder({ token: customer, body: { ...foodOrder, customer_address: undefined, ...pin, quote_token: token } });
      expect(res.body.order.total_delivery_fee).not.toBe(8000);
    } finally {
      vi.useRealTimers();
    }
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

  it('creates a laundry pickup with no items, waiting for the shop to set the laundry fee', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 4').run();
    const res = await api('/orders', { token: customer, body: { ...laundryOrder, notes: 'ticket #42' } });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ store_type: 'laundry', status: 'awaiting_fee', items_total: 0, notes: 'ticket #42', items: [] });
    expect(res.body.order.total_delivery_fee).toBeGreaterThan(0);
  });

  it('needs a pin and no payment for a laundry pickup', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 4').run();
    const typed = { type: 'pickup', store_id: 4, customer_address: '1 Customer St' };
    expect((await api('/orders', { token: customer, body: typed })).body).toEqual({ error: 'Pin your location on the map' });
    expect((await api('/orders', { token: customer, body: { ...laundryOrder, payment_ref: 'X' } })).status).toBe(400);
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
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 4').run();
    const second = await api('/orders', { token: customer, body: laundryOrder });
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

    const mine = await SELF.fetch(`https://api.test/orders/${id}/payment-photo`, { headers: { authorization: `Bearer ${customer}` } });
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(JPEG);
    const theirs = await SELF.fetch(`https://api.test/orders/${id}/payment-photo`, { headers: { authorization: `Bearer ${other}` } });
    expect(theirs.status).toBe(404);
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

describe('paying for a laundry pickup', () => {
  let owner: string;

  beforeEach(async () => {
    const o = await registerUser('owner');
    owner = o.token;
    await env.DB.prepare('UPDATE stores SET owner_id = ?, lat = 14.5547, lng = 121.0244 WHERE id = 4').bind(o.user.id).run();
  });

  it('goes: shop sets the laundry fee, customer pays, shop taps Done Pay, customer places it', async () => {
    const id = (await api('/orders', { token: customer, body: { ...laundryOrder, notes: '2 bags, ticket #42' } })).body.order.id;
    const pay = (token: string, body: object) => api(`/orders/${id}/payment`, { token, body });
    const fee = (token: string, laundry_fee: number) => api(`/owner/orders/${id}/laundry-fee`, { token, body: { laundry_fee } });

    // Nothing to pay until the shop sets the fee.
    expect((await pay(customer, { payment_ref: 'GCASH-1' })).status).toBe(409);
    expect((await fee(owner, -100)).status).toBe(400);
    const stranger = await registerUser('owner');
    await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('Other', 'laundry', 'x', ?)").bind(stranger.user.id).run();
    expect((await fee(stranger.token, 25000)).status).toBe(404);

    const set = await fee(owner, 25000);
    expect(set.body.order).toMatchObject({ status: 'to_pay', items_total: 25000, notes: '2 bags, ticket #42' });
    expect((await fee(owner, 30000)).status).toBe(409);

    expect((await pay(customer, {})).status).toBe(400);
    expect((await pay(other, { payment_ref: 'GCASH-1' })).status).toBe(404);
    const theirs = (await uploadPayment(other)).body.key;
    expect((await pay(customer, { payment_photo_key: theirs })).body).toEqual({ error: 'payment_photo_key: upload the photo first' });
    const photo = (await uploadPayment(customer)).body.key;
    const paid = await pay(customer, { payment_ref: 'GCASH-1', payment_photo_key: photo });
    expect(paid.body.order).toMatchObject({ status: 'awaiting_payment', payment_ref: 'GCASH-1', payment_photo_key: photo });
    expect((await pay(customer, { payment_ref: 'GCASH-2' })).status).toBe(409);

    expect((await api(`/owner/orders/${id}/confirm-payment`, { token: owner, method: 'POST' })).body.order.status).toBe('payment_confirmed');
    expect((await api(`/orders/${id}/place`, { token: customer, method: 'POST' })).body.order.status).toBe('pending');
  });

  it('pushes the owner for a new laundry pickup and for a payment to review', async () => {
    const pushToken = `ExponentPushToken[laundry-owner-${crypto.randomUUID()}]`;
    await env.DB.prepare('UPDATE users SET push_token = ? WHERE id = (SELECT owner_id FROM stores WHERE id = 4)').bind(pushToken).run();
    const pushes = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_tickets WHERE token = ?').bind(pushToken).first<{ n: number }>())!.n;

    const id = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
    await vi.waitFor(async () => expect(await pushes()).toBe(1));

    await api(`/owner/orders/${id}/laundry-fee`, { token: owner, body: { laundry_fee: 25000 } });
    await api(`/orders/${id}/payment`, { token: customer, body: { payment_ref: 'GCASH-1' } });
    await vi.waitFor(async () => expect(await pushes()).toBe(2));
  });

  it("lists laundry pickups and food orders apart on the owner's tabs", async () => {
    await env.DB.prepare('UPDATE stores SET owner_id = (SELECT owner_id FROM stores WHERE id = 4) WHERE id = 1').run();
    const laundry = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
    const food = (await api('/orders', { token: customer, body: { ...foodOrder, payment_ref: 'GCASH-123' } })).body.order.id;
    const ids = async (q: string) => (await api(`/owner/orders${q}`, { token: owner })).body.orders.map((o: { id: number }) => o.id);
    expect(await ids('?type=laundry')).toEqual([laundry]);
    expect(await ids('?type=food')).toEqual([food]);
    expect(await ids('')).toEqual([food, laundry]);
    expect((await api('/owner/orders?type=drinks', { token: owner })).status).toBe(400);
  });

  it('takes a laundry fee of 0 when the laundry is already paid: only the delivery is left', async () => {
    const id = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
    const set = await api(`/owner/orders/${id}/laundry-fee`, { token: owner, body: { laundry_fee: 0 } });
    expect(set.body.order).toMatchObject({ status: 'to_pay', items_total: 0 });
  });

  it("tells the shop when a paid pickup is cancelled, but not one that wasn't paid yet", async () => {
    await env.DB.prepare('UPDATE users SET push_token = ? WHERE id = (SELECT owner_id FROM stores WHERE id = 4)').bind('ExponentPushToken[laundry-owner]').run();
    const sent: { title: string; body: string; data: { order_id: number } }[] = [];
    fetchMock.activate();
    fetchMock
      .get('https://exp.host')
      .intercept({ path: '/--/api/v2/push/send', method: 'POST' })
      .reply(200, (req) => {
        sent.push(...JSON.parse(String(req.body)));
        return { data: [] };
      })
      .persist();
    const cancelled = () => sent.filter((m) => m.title === 'Order cancelled');
    try {
      const unpaid = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
      await api(`/orders/${unpaid}/cancel`, { token: customer, method: 'POST' });

      const paid = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
      await api(`/owner/orders/${paid}/laundry-fee`, { token: owner, body: { laundry_fee: 25000 } });
      await api(`/orders/${paid}/payment`, { token: customer, body: { payment_ref: 'GCASH-1' } });
      expect((await api(`/orders/${paid}/cancel`, { token: customer, method: 'POST' })).body.order.status).toBe('cancelled');

      await vi.waitFor(() => expect(cancelled()).toHaveLength(1));
      const total = (await api(`/orders/${paid}`, { token: customer })).body.order;
      const amount = ((total.items_total + total.total_delivery_fee) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      expect(cancelled()[0]).toMatchObject({ body: `Order #${paid} was cancelled by the customer. They already paid ₱${amount}.`, data: { order_id: paid } });
    } finally {
      fetchMock.deactivate();
    }
  });

  it('can be cancelled before the fee is set or paid', async () => {
    const first = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
    expect((await api(`/orders/${first}/cancel`, { token: customer, method: 'POST' })).body.order.status).toBe('cancelled');
    const second = (await api('/orders', { token: customer, body: laundryOrder })).body.order.id;
    await api(`/owner/orders/${second}/laundry-fee`, { token: owner, body: { laundry_fee: 25000 } });
    expect((await api(`/orders/${second}/cancel`, { token: customer, method: 'POST' })).body.order.status).toBe('cancelled');
  });
});
