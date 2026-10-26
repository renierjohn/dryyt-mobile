import { env, fetchMock, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, registerUser } from './helpers';

let admin: string;
let adminEmail: string;
let customer: { token: string; user: { id: number } };

beforeEach(async () => {
  const a = await registerUser('owner');
  await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(a.user.id).run();
  admin = a.token;
  adminEmail = (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(a.user.id).first<{ email: string }>())!.email;
  customer = await registerUser('customer');
});

describe('admin', () => {
  it('requires auth and the admin flag', async () => {
    expect((await api('/admin/stats')).status).toBe(401);
    expect((await api('/admin/stats', { token: customer.token })).status).toBe(403);
    expect((await api('/admin/me', { token: admin })).status).toBe(200);
  });

  it('stops working as soon as the flag is removed', async () => {
    await env.DB.prepare('UPDATE users SET is_admin = 0').run();
    expect((await api('/admin/users', { token: admin })).status).toBe(403);
  });

  it('returns overview counts', async () => {
    const { body } = await api('/admin/stats', { token: admin });
    expect(body.users).toEqual({ owner: 1, customer: 1 });
    expect(body.stores).toEqual({ food: 3, laundry: 2 });
    expect(body.orders_gross).toBe(0);
  });

  it('lists users with filters and pages', async () => {
    const all = await api('/admin/users', { token: admin });
    expect(all.body).toMatchObject({ total: 2, page: 1, page_size: 25 });
    expect(all.body.rows[0].id).toBe(customer.user.id);

    const customers = await api('/admin/users?role=customer', { token: admin });
    expect(customers.body.rows.map((u: { id: number }) => u.id)).toEqual([customer.user.id]);

    expect((await api('/admin/users?q=nobody-matches', { token: admin })).body.total).toBe(0);
    expect((await api('/admin/users?page=2', { token: admin })).body.rows).toEqual([]);
  });

  it('lists stores, orders and drop offs', async () => {
    expect((await api('/admin/stores?type=laundry', { token: admin })).body.total).toBe(2);
    await env.DB.prepare(
      "INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee) VALUES ('pickup', ?, 1, 'delivered', 'Makati', 10000, 4500, 500, 5000)",
    )
      .bind(customer.user.id)
      .run();
    const orders = await api('/admin/orders?status=delivered', { token: admin });
    expect(orders.body.total).toBe(1);
    expect(orders.body.rows[0]).toMatchObject({ store_id: 1, items_total: 10000, driver_name: null });
    expect((await api('/admin/stats', { token: admin })).body).toMatchObject({ orders_gross: 15000, orders_service_fees: 500, dropoffs_service_fees: 0 });
    expect((await api('/admin/dropoffs', { token: admin })).body.total).toBe(0);
  });

  it('narrows the amounts, not the counts, to a Manila date range', async () => {
    // 2026-10-19 17:00 UTC is 2026-10-20 01:00 in Manila.
    await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee, updated_at)
       VALUES ('pickup', ?1, 1, 'delivered', 'Makati', 10000, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, 1, 'delivered', 'Makati', 20000, 9000, 1000, 10000, '2026-10-21 03:00:00')`,
    )
      .bind(customer.user.id)
      .run();
    const stats = async (q: string) => (await api(`/admin/stats${q}`, { token: admin })).body;

    expect(await stats('')).toMatchObject({ orders_gross: 45000, orders_service_fees: 1500 });
    expect(await stats('?from=2026-10-20&to=2026-10-20')).toMatchObject({ orders_gross: 15000, orders_service_fees: 500, orders: { delivered: 2 } });
    // Store 1 takes 10% of sales: ₱100 + ₱200 delivered in all, ₱100 on Oct 20.
    await api('/admin/stores/1/fee', { token: admin, body: { fee_type: 2, fee_flat: 0, fee_percentage: 10 } });
    expect((await stats('')).app_fee).toBe(3000);
    expect((await stats('?from=2026-10-20&to=2026-10-20')).app_fee).toBe(1000);
    expect(await stats('?from=2026-10-21')).toMatchObject({ orders_service_fees: 1000 });
    expect(await stats('?to=2026-10-19')).toMatchObject({ orders_gross: 0, orders_service_fees: 0 });
    expect((await api('/admin/stats?from=20-10-2026', { token: admin })).status).toBe(400);
    expect((await api('/admin/stats?from=2026-10-21&to=2026-10-20', { token: admin })).status).toBe(400);
  });
});

describe('admin rates', () => {
  it('lists the default motorcycle rates for both services with the store count', async () => {
    const { body } = await api('/admin/rates', { token: admin });
    const rate = { group_id: 'default', category: 2, base_fee: 4000, rate_per_km: 1000, commission_pct: 10, store_count: 5 };
    expect(body.rates).toEqual([expect.objectContaining({ ...rate, type: 'dropoff' }), expect.objectContaining({ ...rate, type: 'pickup' })]);
  });

  it('updates a rate, adds a vehicle and a new area', async () => {
    const update = await api('/admin/rates', { token: admin, body: { group_id: 'default', type: 'pickup', base_fee: 5000, rate_per_km: 1200, commission_pct: 12.5 } });
    expect(update.body.rate).toMatchObject({ group_id: 'default', type: 'pickup', category: 2, base_fee: 5000, rate_per_km: 1200, commission_pct: 12.5 });
    await api('/admin/rates', { token: admin, body: { group_id: 'default', type: 'dropoff', category: 4, base_fee: 9000, rate_per_km: 2000, commission_pct: 10 } });
    await api('/admin/rates', { token: admin, body: { group_id: 'cebu', type: 'dropoff', base_fee: 3000, rate_per_km: 800, commission_pct: 10 } });
    const { body } = await api('/admin/rates', { token: admin });
    const key = (r: { group_id: string; type: string; category: number; base_fee: number }) => `${r.group_id}/${r.type}/${r.category}/${r.base_fee}`;
    expect(body.rates.map(key)).toEqual(['default/dropoff/2/4000', 'default/dropoff/4/9000', 'default/pickup/2/5000', 'cebu/dropoff/2/3000']);
  });

  it('prices pickups and drop offs from their own rate', async () => {
    await env.DB.prepare('UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 1').run();
    await api('/admin/rates', { token: admin, body: { group_id: 'default', type: 'dropoff', base_fee: 9000, rate_per_km: 1000, commission_pct: 10 } });
    const quote = await api('/orders/quote', { token: customer.token, body: { store_id: 1, lat: 14.56, lng: 121.03 } });
    expect(quote.body.quote.options[0].total_delivery_fee).toBe(8000); // pickup rate unchanged: 40 + 3.2 km × 10, + 10%
  });

  it('rejects bad input and non-admins', async () => {
    const bad = { group_id: 'Bad Area!', type: 'dropoff', base_fee: 5000, rate_per_km: 1000, commission_pct: 10 };
    expect((await api('/admin/rates', { token: admin, body: bad })).status).toBe(400);
    expect((await api('/admin/rates', { token: admin, body: { ...bad, group_id: 'x', commission_pct: 150 } })).status).toBe(400);
    expect((await api('/admin/rates', { token: admin, body: { ...bad, group_id: 'x', type: undefined } })).status).toBe(400);
    expect((await api('/admin/rates', { token: admin, body: { ...bad, group_id: 'x', category: 9 } })).status).toBe(400);
    expect((await api('/admin/rates', { token: customer.token, body: { ...bad, group_id: 'x' } })).status).toBe(403);
  });
});

describe('admin drivers and blocking', () => {
  const emailOf = async (id: number) => (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string }>())!.email;
  const login = async (id: number) => api('/auth/login', { body: { email: await emailOf(id), password: 'password123' } });

  it('lists drivers with their driver data, filtered', async () => {
    const verified = await registerUser('driver');
    const plain = await registerUser('driver');
    await env.DB.prepare("INSERT INTO driver_data (user_id, photo_face, notes, status, earnings) VALUES (?, 'faces/x.jpg', 'ABC 123', 1, 15000)")
      .bind(verified.user.id)
      .run();

    const all = await api('/admin/drivers', { token: admin });
    expect(all.body.rows.every((r: { id: number }) => r.id !== customer.user.id)).toBe(true);
    expect(all.body.rows.slice(0, 2).map((r: { id: number }) => r.id)).toEqual([plain.user.id, verified.user.id]); // newest first
    expect(all.body.rows[1]).toMatchObject({ has_face: 1, has_id: 0, notes: 'ABC 123', verified: 1, earnings: 15000, blocked: 0 });
    expect(all.body.rows[1]).not.toHaveProperty('photo_face');
    expect(all.body.rows[0]).toMatchObject({ has_face: 0, verified: 0, earnings: 0 });

    const mine = [verified.user.id, plain.user.id];
    const only = async (status: string) =>
      (await api(`/admin/drivers?status=${status}`, { token: admin })).body.rows.map((r: { id: number }) => r.id).filter((id: number) => mine.includes(id));
    expect(await only('verified')).toEqual([verified.user.id]);
    expect(await only('unverified')).toEqual([plain.user.id]);
    expect(await only('blocked')).toEqual([]);
  });

  it("blocks sign in until unblocked, but not the admin's own account", async () => {
    const driver = await registerUser('driver');
    expect((await login(driver.user.id)).status).toBe(200);

    const blocked = await api(`/admin/users/${driver.user.id}/blocked`, { token: admin, body: { blocked: true } });
    expect(blocked.body.user).toEqual({ id: driver.user.id, blocked: 1 });
    const denied = await login(driver.user.id);
    expect(denied.status).toBe(403);
    expect(denied.body).not.toHaveProperty('token');
    // A wrong password still gets the usual answer, so blocking doesn't reveal the account.
    expect((await api('/auth/login', { body: { email: await emailOf(driver.user.id), password: 'wrong-password' } })).status).toBe(401);
    expect((await api('/admin/drivers?status=blocked', { token: admin })).body.rows.map((r: { id: number }) => r.id)).toEqual([driver.user.id]);

    await api(`/admin/users/${driver.user.id}/blocked`, { token: admin, body: { blocked: false } });
    expect((await login(driver.user.id)).status).toBe(200);

    const adminId = (await api('/admin/me', { token: admin })).body.user.id;
    expect((await api(`/admin/users/${adminId}/blocked`, { token: admin, body: { blocked: true } })).status).toBe(400);
    expect((await api('/admin/users/999999/blocked', { token: admin, body: { blocked: true } })).status).toBe(404);
    expect((await api(`/admin/users/${driver.user.id}/blocked`, { token: customer.token, body: { blocked: true } })).status).toBe(403);
  });

  it('keeps blocked admins out of the cpanel sign in', async () => {
    await env.DB.prepare('UPDATE users SET blocked = 1 WHERE email = ?').bind(adminEmail).run();
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock
      .get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, { success: true, hostname: 'dryyt.com', action: 'cpanel_login' });
    const res = await api('/admin/login', { body: { email: adminEmail, password: 'password123', turnstile_token: 't' } });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
    fetchMock.deactivate();
  });
});

describe('admin customers and owners', () => {
  it('lists only customers, and only owners with their stores, filtered by access', async () => {
    const owner = await registerUser('owner');
    await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('Suds', 'laundry', '1 St', ?)").bind(owner.user.id).run();
    const driver = await registerUser('driver');
    const ids = async (path: string) => (await api(path, { token: admin })).body.rows.map((r: { id: number }) => r.id);

    const customers = await ids('/admin/customers');
    expect(customers).toContain(customer.user.id);
    expect(customers).not.toContain(owner.user.id);
    expect(customers).not.toContain(driver.user.id);

    const owners = (await api('/admin/owners', { token: admin })).body.rows;
    expect(owners.map((r: { id: number }) => r.id)).not.toContain(customer.user.id);
    expect(owners.find((r: { id: number }) => r.id === owner.user.id)).toMatchObject({ store_count: 1, store_names: 'Suds', blocked: 0 });

    await api(`/admin/users/${customer.user.id}/blocked`, { token: admin, body: { blocked: true } });
    expect(await ids('/admin/customers?status=blocked')).toEqual([customer.user.id]);
    expect(await ids('/admin/customers?status=active')).not.toContain(customer.user.id);
  });
});

describe('admin app fees', () => {
  it("records an owner's payments and shows the latest on the Owners list", async () => {
    const owner = await registerUser('owner');
    const fees = `/admin/owners/${owner.user.id}/fees`;
    expect((await api(fees, { token: admin })).body).toEqual({ fees: [] });
    const row = async () => (await api('/admin/owners', { token: admin })).body.rows.find((r: { id: number }) => r.id === owner.user.id);
    expect(await row()).toMatchObject({ last_fee_amount: null, last_fee_paid: null });

    const pay = (body: Record<string, unknown>) => api(fees, { token: admin, body });
    const first = await pay({ amount: 50000, type: 'both', payment_type: 'gcash', date_paid: '2026-09-20', next_due_date: '2026-10-20' });
    expect(first.status).toBe(201);
    expect(first.body.fee).toMatchObject({ user_id: owner.user.id, amount: 50000, type: 'both', payment_type: 'gcash', date_paid: '2026-09-20' });
    await pay({ amount: 30000, type: 'subscription', payment_type: 'cash', date_paid: '2026-10-20' });

    const list = (await api(fees, { token: admin })).body.fees;
    expect(list.map((f: { amount: number }) => f.amount)).toEqual([30000, 50000]); // newest paid first
    expect(list[0]).toMatchObject({ type: 'subscription', payment_type: 'cash', next_due_date: null });
    expect(await row()).toMatchObject({ last_fee_amount: 30000, last_fee_type: 'subscription', last_fee_paid: '2026-10-20', next_due_date: null });
  });

  it('rejects bad payments, non-owners and non-admins', async () => {
    const owner = await registerUser('owner');
    const fees = `/admin/owners/${owner.user.id}/fees`;
    const good = { amount: 50000, type: 'service_fee', payment_type: 'cash', date_paid: '2026-10-20' };
    for (const bad of [
      { ...good, amount: 0 },
      { ...good, type: 'monthly' },
      { ...good, type: 'pickup' }, // the old types are gone
      { ...good, payment_type: ' ' },
      { ...good, date_paid: '10/20/2026' },
      { ...good, next_due_date: '2026-10-19' },
    ]) {
      expect((await api(fees, { token: admin, body: bad })).status).toBe(400);
    }
    expect((await api(`/admin/owners/${customer.user.id}/fees`, { token: admin, body: good })).status).toBe(404);
    expect((await api(`/admin/owners/${customer.user.id}/fees`, { token: admin })).status).toBe(404);
    expect((await api(fees, { token: customer.token, body: good })).status).toBe(403);
  });
});

describe('app fee proofs from the owner app', () => {
  it('owner sends a proof (photo and/or reference) dated today; the cpanel shows it and fills in the payment', async () => {
    const owner = await registerUser('owner');
    await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('Suds', 'laundry', '1 St', ?)").bind(owner.user.id).run();
    const send = (body: object) => api('/owner/app-fee', { token: owner.token, body });
    expect((await send({})).status).toBe(400);
    expect((await send({ photo: 'app-fee/0/nope.jpg' })).body).toEqual({ error: 'photo: upload the photo first' });

    const upload = await SELF.fetch('https://api.test/owner/app-fee/photo', {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]),
    });
    const { key } = (await upload.json()) as { key: string };
    expect(key).toMatch(new RegExp(`^app-fee/${owner.user.id}/`));
    const sent = await send({ ref_number: 'GC-777', photo: key });
    expect(sent.status).toBe(201);
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    expect(sent.body.payment).toMatchObject({ amount: 0, type: null, ref_number: 'GC-777', has_photo: true, date_paid: today });
    const id = sent.body.payment.id;

    // The owner sees it among this month's payments; it isn't their "last payment" until reviewed.
    const mine = (await api('/owner/app-fee', { token: owner.token })).body;
    expect(mine.payments.map((p: { id: number }) => p.id)).toEqual([id]);
    expect(mine.last_payment).toBeNull();
    const photo = async (path: string, token: string) => {
      const res = await SELF.fetch(`https://api.test${path}`, { headers: { authorization: `Bearer ${token}` } });
      await res.arrayBuffer(); // drain it, or isolated storage can't pop
      return res.status;
    };
    expect(await photo(`/owner/app-fee/${id}/photo`, owner.token)).toBe(200);

    // The cpanel: listed for review, not yet the Owners list's last payment.
    const fees = (await api(`/admin/owners/${owner.user.id}/fees`, { token: admin })).body.fees;
    expect(fees[0]).toMatchObject({ id, type: null, has_photo: true, ref_number: 'GC-777' });
    const row = async () => (await api('/admin/owners', { token: admin })).body.rows.find((r: { id: number }) => r.id === owner.user.id);
    expect(await row()).toMatchObject({ last_fee_amount: null, fees_to_review: 1 });
    expect(await photo(`/admin/app-fee/${id}/photo`, admin)).toBe(200);

    const review = await api(`/admin/app-fee/${id}`, {
      token: admin,
      body: { amount: 50000, type: 'subscription', payment_type: 'gcash', date_paid: today, next_due_date: null },
    });
    expect(review.body.fee).toMatchObject({ id, amount: 50000, type: 'subscription', payment_type: 'gcash', ref_number: 'GC-777' });
    expect(await row()).toMatchObject({ last_fee_amount: 50000, fees_to_review: 0 });
    expect((await api('/owner/app-fee', { token: owner.token })).body.last_payment).toMatchObject({ id, amount: 50000 });
    expect((await api('/admin/app-fee/999999', { token: admin, body: { amount: 1, type: 'both', payment_type: 'x', date_paid: today } })).status).toBe(404);
    expect((await api(`/admin/app-fee/${id}`, { token: owner.token, body: { amount: 1, type: 'both', payment_type: 'x', date_paid: today } })).status).toBe(403);
  });
});

describe('admin order details', () => {
  it("shows an order's items with menu photos, the note and the proof of payment", async () => {
    await env.DB.prepare("UPDATE store_menu_items SET image_url = 'https://img.test/tea.jpg' WHERE id = 1").run();
    const key = `payments/${customer.user.id}/proof-test.jpg`;
    await env.PROOFS.put(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { httpMetadata: { contentType: 'image/jpeg' } });
    const order = await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, notes, items_total, delivery_fee, payment_ref, payment_photo_key)
       VALUES ('pickup', ?, 1, 'awaiting_payment', 'x', 'less ice', 36500, 5000, 'GC-1', ?) RETURNING id`,
    )
      .bind(customer.user.id, key)
      .first<{ id: number }>();
    await env.DB.prepare("INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES (?, 1, 'Wintermelon Milk Tea', 12000, 2)").bind(order!.id).run();

    const { body } = await api(`/admin/orders/${order!.id}`, { token: admin });
    expect(body.order).toMatchObject({ notes: 'less ice', payment_ref: 'GC-1', has_payment_photo: true });
    expect(body.order.payment_photo_key).toBeUndefined();
    expect(body.order.items).toEqual([{ id: expect.any(Number), name: 'Wintermelon Milk Tea', price: 12000, qty: 2, image_url: 'https://img.test/tea.jpg' }]);

    const photo = await SELF.fetch(`https://api.test/admin/orders/${order!.id}/payment-photo`, { headers: { authorization: `Bearer ${admin}` } });
    expect(photo.status).toBe(200);
    await photo.arrayBuffer();
    expect((await api('/admin/orders/999999', { token: admin })).status).toBe(404);
    expect((await api(`/admin/orders/${order!.id}`, { token: customer.token })).status).toBe(403);
  });
});

describe('admin stores owner filter', () => {
  it('lists the owners who have stores and filters the Stores tab by one, or by none', async () => {
    const owner = await registerUser('owner');
    const mine = await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('Mine', 'laundry', '1 St', ?) RETURNING id")
      .bind(owner.user.id)
      .first<{ id: number }>();
    const owners = (await api('/admin/store-owners', { token: admin })).body.owners;
    expect(owners).toContainEqual(expect.objectContaining({ id: owner.user.id, store_count: 1 }));

    const ids = async (q: string) => (await api(`/admin/stores${q}`, { token: admin })).body.rows.map((r: { id: number }) => r.id);
    expect(await ids(`?owner=${owner.user.id}`)).toEqual([mine!.id]);
    const unowned = await ids('?owner=none');
    expect(unowned).not.toContain(mine!.id);
    const all = (await api('/admin/stores', { token: admin })).body.rows as { id: number; owner_id: number | null }[];
    expect(unowned.sort()).toEqual(all.filter((r) => r.owner_id === null).map((r) => r.id).sort());
    expect((await api('/admin/store-owners', { token: owner.token })).status).toBe(403);
  });
});

describe('admin stores service fees', () => {
  it("shows each store's service fees and the total, narrowed to a Manila date range", async () => {
    await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee, updated_at)
       VALUES ('pickup', ?1, 1, 'delivered', 'x', 0, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, 1, 'cancelled', 'x', 0, 4500, 700, 5200, '2026-10-19 17:00:00'),
              ('pickup', ?1, 2, 'delivered', 'x', 0, 9000, 1000, 10000, '2026-10-21 03:00:00')`,
    )
      .bind(customer.user.id)
      .run();
    const stores = async (q = '') => (await api(`/admin/stores${q}`, { token: admin })).body;
    const fee = (body: { rows: { id: number; service_fee: number }[] }, id: number) => body.rows.find((r) => r.id === id)?.service_fee;

    const all = await stores();
    expect(all.total_service_fee).toBe(1500); // the cancelled one doesn't count
    expect([fee(all, 1), fee(all, 2)]).toEqual([500, 1000]);

    const oct20 = await stores('?from=2026-10-20&to=2026-10-20'); // 17:00 UTC Oct 19 is Oct 20 in Manila
    expect(oct20.total_service_fee).toBe(500);
    expect([fee(oct20, 1), fee(oct20, 2)]).toEqual([500, 0]);
    expect(oct20.total).toBe(all.total); // the range narrows amounts, not which stores show

    const store2 = (await env.DB.prepare('SELECT name FROM stores WHERE id = 2').first<{ name: string }>())!.name;
    expect((await stores(`?q=${encodeURIComponent(store2)}`)).total_service_fee).toBe(1000);
    expect((await api('/admin/stores?from=2026-10-21&to=2026-10-20', { token: admin })).status).toBe(400);
  });
});

describe('admin owner stores', () => {
  it("lists an owner's stores with service fees in a range, and sets maxstore", async () => {
    const owner = await registerUser('owner');
    const other = await registerUser('owner');
    const add = (name: string, ownerId: number) =>
      env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES (?, 'laundry', '1 St', ?) RETURNING id").bind(name, ownerId).first<{ id: number }>();
    const a = (await add('A', owner.user.id))!.id;
    const b = (await add('B', owner.user.id))!.id;
    await add('Not mine', other.user.id);
    await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee, updated_at)
       VALUES ('pickup', ?1, ?2, 'delivered', 'x', 0, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, ?3, 'delivered', 'x', 0, 9000, 1000, 10000, '2026-10-21 03:00:00')`,
    )
      .bind(customer.user.id, a, b)
      .run();
    const stores = async (q = '') => (await api(`/admin/owners/${owner.user.id}/stores${q}`, { token: admin })).body;

    const all = await stores();
    expect(all.stores.map((s: { name: string; service_fee: number }) => [s.name, s.service_fee])).toEqual([['A', 500], ['B', 1000]]);
    expect(all).toMatchObject({ total_service_fee: 1500, maxstore: 1 });
    expect((await stores('?from=2026-10-21')).total_service_fee).toBe(1000);

    expect((await api(`/admin/owners/${owner.user.id}/maxstore`, { token: admin, body: { maxstore: 5 } })).body).toEqual({ maxstore: 5 });
    expect((await stores()).maxstore).toBe(5);
    expect((await api('/admin/owners', { token: admin })).body.rows.find((r: { id: number }) => r.id === owner.user.id)).toMatchObject({ maxstore: 5, store_count: 2 });

    expect((await api(`/admin/owners/${owner.user.id}/maxstore`, { token: admin, body: { maxstore: -1 } })).status).toBe(400);
    expect((await api(`/admin/owners/${owner.user.id}/maxstore`, { token: admin, body: { maxstore: 1.5 } })).status).toBe(400);
    expect((await api(`/admin/owners/${customer.user.id}/maxstore`, { token: admin, body: { maxstore: 2 } })).status).toBe(404);
    expect((await api(`/admin/owners/${customer.user.id}/stores`, { token: admin })).status).toBe(404);
    expect((await api(`/admin/owners/${owner.user.id}/maxstore`, { token: customer.token, body: { maxstore: 9 } })).status).toBe(403);
  });
});

describe('admin store app fee', () => {
  it('charges each store flat by default, or a percentage of its sales', async () => {
    const owner = await registerUser('owner');
    const add = (name: string) =>
      env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES (?, 'food', '1 St', ?) RETURNING id").bind(name, owner.user.id).first<{ id: number }>();
    const a = (await add('A'))!.id;
    const b = (await add('B'))!.id;
    // A sold ₱333.33 (delivered) on Oct 20 Manila and ₱1,000 that was cancelled; B sold nothing.
    await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee, updated_at)
       VALUES ('pickup', ?1, ?2, 'delivered', 'x', 33333, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, ?2, 'cancelled', 'x', 100000, 4500, 500, 5000, '2026-10-19 17:00:00')`,
    )
      .bind(customer.user.id, a)
      .run();
    const stores = async (q = '') => (await api(`/admin/owners/${owner.user.id}/stores${q}`, { token: admin })).body;
    const fees = async (q = '') =>
      (await stores(q)).stores.map((s: { id: number; fee_type: number; sales: number; app_fee: number }) => [s.id, s.fee_type, s.sales, s.app_fee]);
    const setFee = (id: number, body: Record<string, unknown>) => api(`/admin/stores/${id}/fee`, { token: admin, body });

    expect(await fees()).toEqual([[a, 1, 33333, 0], [b, 1, 0, 0]]);

    // Each store keeps its own: A takes 10% of sales (₱33.33, rounded up to ₱34), B a flat ₱500.
    expect((await setFee(a, { fee_type: 2, fee_flat: 0, fee_percentage: 10 })).body.fee).toEqual({ id: a, fee_type: 2, fee_flat: 0, fee_percentage: 10 });
    await setFee(b, { fee_type: 1, fee_flat: 50000, fee_percentage: 0 });
    expect(await fees()).toEqual([[a, 2, 33333, 3400], [b, 1, 0, 50000]]);
    expect((await stores()).total_app_fee).toBe(53400);
    expect((await stores('?from=2026-10-21')).total_app_fee).toBe(50000);

    // The Stores tab shows the same.
    const tab = (await api('/admin/stores', { token: admin })).body;
    expect(tab.rows.find((r: { id: number }) => r.id === a)).toMatchObject({ sales: 33333, app_fee: 3400, service_fee: 500, fee_percentage: 10 });

    for (const bad of [{ fee_type: 3, fee_flat: 0, fee_percentage: 0 }, { fee_type: 2, fee_flat: -1, fee_percentage: 0 }, { fee_type: 2, fee_flat: 0, fee_percentage: 101 }]) {
      expect((await setFee(a, bad)).status).toBe(400);
    }
    expect((await setFee(999999, { fee_type: 1, fee_flat: 0, fee_percentage: 0 })).status).toBe(404);
    expect((await api(`/admin/stores/${a}/fee`, { token: customer.token, body: { fee_type: 1, fee_flat: 0, fee_percentage: 0 } })).status).toBe(403);
  });
});

describe('admin order and drop off totals', () => {
  it('filters pickup orders by Manila created date and totals their fees, leaving out cancelled ones', async () => {
    await env.DB.prepare(
      `INSERT INTO transactions_pickup (type, customer_id, store_id, status, customer_address, items_total, delivery_fee, service_fee, total_delivery_fee, created_at)
       VALUES ('pickup', ?1, 1, 'delivered', 'x', 0, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, 1, 'cancelled', 'x', 0, 4500, 500, 5000, '2026-10-19 17:00:00'),
              ('pickup', ?1, 1, 'pending', 'x', 0, 9000, 1000, 10000, '2026-10-21 03:00:00')`,
    )
      .bind(customer.user.id)
      .run();
    const orders = async (q = '') => (await api(`/admin/orders${q}`, { token: admin })).body;

    expect(await orders()).toMatchObject({ total: 3, total_delivery_fee: 15000, total_service_fee: 1500 });
    expect(await orders('?from=2026-10-20&to=2026-10-20')).toMatchObject({ total: 2, total_delivery_fee: 5000, total_service_fee: 500 });
    expect(await orders('?from=2026-10-21')).toMatchObject({ total: 1, total_service_fee: 1000 });
    expect(await orders('?to=2026-10-19')).toMatchObject({ total: 0, total_delivery_fee: 0 });
    expect(await orders('?status=pending&from=2026-10-20')).toMatchObject({ total: 1, total_delivery_fee: 10000 });
    expect((await api('/admin/orders?from=bad', { token: admin })).status).toBe(400);
  });

  it('totals drop off fees the same way, leaving out cancelled and expired ones', async () => {
    const insert = (status: string, created: string, fee: number) =>
      env.DB.prepare(
        `INSERT INTO transactions_dropoff (room_id, customer_id, store_id, status, customer_lat, customer_lng, customer_address,
           shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee, created_at)
         VALUES (?, ?, 4, ?, 14.56, 121.03, 'x', 14.55, 121.02, 3.2, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), customer.user.id, status, fee - 800, 800, fee, created)
        .run();
    await insert('completed', '2026-10-19 17:00:00', 8000);
    await insert('expired', '2026-10-19 18:00:00', 9000);
    await insert('cancelled', '2026-10-21 03:00:00', 7000);
    const dropoffs = async (q = '') => (await api(`/admin/dropoffs${q}`, { token: admin })).body;

    expect(await dropoffs()).toMatchObject({ total: 3, total_delivery_fee: 8000, total_service_fee: 800 });
    expect(await dropoffs('?from=2026-10-21&to=2026-10-21')).toMatchObject({ total: 1, total_delivery_fee: 0 });
  });
});

describe('admin driver photos and verification', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const EDITED = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
  const raw = (path: string, token: string, body?: Uint8Array) =>
    SELF.fetch(`https://api.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}` }, body });

  it('serves and replaces a driver’s license photo, deleting the original', async () => {
    const driver = await registerUser('driver');
    expect((await raw(`/admin/drivers/${driver.user.id}/photo/id`, admin)).status).toBe(404);
    await raw('/drivers/me/verification/photo/id', driver.token, JPEG);
    const oldKey = (await env.DB.prepare('SELECT photo_id FROM driver_data WHERE user_id = ?').bind(driver.user.id).first<{ photo_id: string }>())!.photo_id;

    const photo = await raw(`/admin/drivers/${driver.user.id}/photo/id`, admin);
    expect(photo.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);

    // Verified first: admins can still replace it.
    await api(`/admin/drivers/${driver.user.id}/verified`, { token: admin, body: { verified: true } });
    expect((await raw(`/admin/drivers/${driver.user.id}/photo/id`, admin, EDITED)).status).toBe(200);
    expect(new Uint8Array(await (await raw(`/admin/drivers/${driver.user.id}/photo/id`, admin)).arrayBuffer())).toEqual(EDITED);
    expect(new Uint8Array(await (await raw('/drivers/me/verification/photo/id', driver.token)).arrayBuffer())).toEqual(EDITED);
    await vi.waitFor(async () => expect(await env.PROOFS.head(oldKey)).toBeNull());

    expect((await raw(`/admin/drivers/${driver.user.id}/photo/id`, admin, new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await raw(`/admin/drivers/${driver.user.id}/photo/selfie`, admin)).status).toBe(404);
    expect((await raw(`/admin/drivers/${customer.user.id}/photo/id`, admin)).status).toBe(404);
    expect((await raw(`/admin/drivers/${driver.user.id}/photo/id`, customer.token)).status).toBe(403);
  });

  it('turns verification on and off', async () => {
    const driver = await registerUser('driver');
    const verified = async () => (await api('/drivers/me/verification', { token: driver.token })).body.verification.verified;
    expect((await api(`/admin/drivers/${driver.user.id}/verified`, { token: admin, body: { verified: true } })).body).toEqual({ verified: true });
    expect(await verified()).toBe(true);
    expect((await api('/drivers/me/verification', { token: driver.token, body: { notes: 'X' } })).status).toBe(409);
    await api(`/admin/drivers/${driver.user.id}/verified`, { token: admin, body: { verified: false } });
    expect(await verified()).toBe(false);
    expect((await api(`/admin/drivers/${customer.user.id}/verified`, { token: admin, body: { verified: true } })).status).toBe(404);
    expect((await api(`/admin/drivers/${driver.user.id}/verified`, { token: customer.token, body: { verified: true } })).status).toBe(403);
  });
});

describe('admin rate edit', () => {
  it("changes a rate's service and vehicle, but not into a taken slot or away from the booking motorcycle rate", async () => {
    const add = async (body: Record<string, unknown>) =>
      (await api('/admin/rates', { token: admin, body: { group_id: 'cebu', base_fee: 3000, rate_per_km: 800, commission_pct: 10, ...body } })).body.rate;
    const moto = await add({ type: 'dropoff' });
    const bike = await add({ type: 'dropoff', category: 1 });
    await add({ type: 'pickup', category: 3 });
    const edit = (id: number, body: Record<string, unknown>) =>
      api(`/admin/rates/${id}`, { token: admin, body: { base_fee: 3500, rate_per_km: 900, commission_pct: 12, ...body } });

    const res = await edit(bike.id, { type: 'pickup', category: 4 });
    expect(res.body.rate).toEqual({ id: bike.id, group_id: 'cebu', type: 'pickup', category: 4, base_fee: 3500, rate_per_km: 900, commission_pct: 12 });

    expect((await edit(bike.id, { type: 'pickup', category: 3 })).status).toBe(409); // taken
    expect((await edit(moto.id, { type: 'dropoff', category: 4 })).status).toBe(409); // bookings use it
    expect((await edit(moto.id, { type: 'dropoff', category: 2, base_fee: 5000 })).body.rate).toMatchObject({ base_fee: 5000 }); // fees still editable
    expect((await edit(bike.id, { type: 'monthly', category: 4 })).status).toBe(400);
    expect((await edit(999999, { type: 'pickup', category: 1 })).status).toBe(404);
    expect((await api(`/admin/rates/${bike.id}`, { token: customer.token, body: { type: 'pickup', category: 1, base_fee: 1, rate_per_km: 1, commission_pct: 1 } })).status).toBe(403);
  });
});

describe('admin store group', () => {
  it('moves a store to an area with rates, not while a drop off is in progress', async () => {
    await api('/admin/rates', { token: admin, body: { group_id: 'cebu', type: 'dropoff', base_fee: 3000, rate_per_km: 800, commission_pct: 10 } });
    expect((await api('/admin/groups', { token: admin })).body.groups).toEqual(['default', 'cebu']);
    const move = (id: number, group_id: string, token = admin) => api(`/admin/stores/${id}/group`, { token, body: { group_id } });

    expect((await move(4, 'cebu')).body).toEqual({ group_id: 'cebu' });
    expect((await api('/admin/stores?q=', { token: admin })).body.rows.find((r: { id: number }) => r.id === 4)).toMatchObject({ group_id: 'cebu' });

    expect((await move(4, 'nowhere')).status).toBe(400);
    expect((await move(4, 'Bad Area!')).status).toBe(400);
    expect((await move(999999, 'cebu')).status).toBe(404);
    expect((await move(4, 'default', customer.token)).status).toBe(403);

    await env.DB.prepare(
      `INSERT INTO transactions_dropoff (room_id, customer_id, store_id, status, customer_lat, customer_lng, customer_address,
         shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee)
       VALUES (?, ?, 4, 'en_route_pickup', 14.56, 121.03, 'x', 14.55, 121.02, 3.2, 7200, 800, 8000)`,
    )
      .bind(crypto.randomUUID(), customer.user.id)
      .run();
    expect((await move(4, 'default')).status).toBe(409);
  });
});

describe('admin rate delete', () => {
  it('deletes rates nothing uses, not a motorcycle rate stores price with', async () => {
    const add = async (body: Record<string, unknown>) =>
      (await api('/admin/rates', { token: admin, body: { base_fee: 3000, rate_per_km: 800, commission_pct: 10, ...body } })).body.rate;
    const del = (id: number, token = admin) => api(`/admin/rates/${id}/delete`, { token, body: {} });
    const ids = async () => (await api('/admin/rates', { token: admin })).body.rates.map((r: { id: number }) => r.id);

    const car = await add({ group_id: 'default', type: 'pickup', category: 4 });
    const empty = await add({ group_id: 'cebu', type: 'dropoff' });
    const used = (await api('/admin/rates', { token: admin })).body.rates.find((r: { group_id: string; category: number }) => r.group_id === 'default' && r.category === 2);

    expect((await del(car.id)).body).toEqual({ deleted: car.id }); // not used by bookings
    expect((await del(empty.id)).status).toBe(200); // no stores in cebu
    const blocked = await del(used.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/5 stores use this rate/);
    expect(await ids()).toEqual(expect.not.arrayContaining([car.id, empty.id]));
    expect(await ids()).toContain(used.id);
    expect((await del(999999)).status).toBe(404);
    expect((await del(used.id, customer.token)).status).toBe(403);
  });
});

describe('admin store details', () => {
  it('returns a store with its payment QR codes parsed', async () => {
    const qr = [{ label: 'GCash', image_url: 'https://img.test/gcash.png' }];
    await env.DB.prepare('UPDATE stores SET store_payment_gateway = ?, lat = 14.5547, lng = 121.0244 WHERE id = 1').bind(JSON.stringify(qr)).run();
    const { body } = await api('/admin/stores/1', { token: admin });
    expect(body.store).toMatchObject({ id: 1, lat: 14.5547, lng: 121.0244, store_payment_gateway: qr });

    await env.DB.prepare("UPDATE stores SET store_payment_gateway = 'not json' WHERE id = 1").run();
    expect((await api('/admin/stores/1', { token: admin })).body.store.store_payment_gateway).toEqual([]);
    expect((await api('/admin/stores/999999', { token: admin })).status).toBe(404);
    expect((await api('/admin/stores/1', { token: customer.token })).status).toBe(403);
  });
});

describe('admin store owner', () => {
  it('hands a store to another owner within their store limit', async () => {
    const a = await registerUser('owner');
    const b = await registerUser('owner');
    const store = (await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('S', 'food', '1 St', ?) RETURNING id").bind(a.user.id).first<{ id: number }>())!.id;
    const give = (owner_id: number, token = admin) => api(`/admin/stores/${store}/owner`, { token, body: { owner_id } });
    const ownerOf = async () => (await env.DB.prepare('SELECT owner_id FROM stores WHERE id = ?').bind(store).first<{ owner_id: number }>())!.owner_id;

    expect((await give(b.user.id)).body).toEqual({ owner_id: b.user.id });
    expect(await ownerOf()).toBe(b.user.id);
    expect((await give(b.user.id)).status).toBe(200); // already theirs

    // a has no store left and a limit of 1; give a another store, then b's store can't go back.
    await env.DB.prepare("INSERT INTO stores (name, type, address, owner_id) VALUES ('T', 'food', '1 St', ?)").bind(a.user.id).run();
    const full = await give(a.user.id);
    expect(full.status).toBe(409);
    expect(full.body.error).toMatch(/1 of 1 stores/);
    await api(`/admin/owners/${a.user.id}/maxstore`, { token: admin, body: { maxstore: 2 } });
    expect((await give(a.user.id)).status).toBe(200);

    expect((await give(customer.user.id)).status).toBe(400);
    expect((await api('/admin/stores/999999/owner', { token: admin, body: { owner_id: a.user.id } })).status).toBe(404);
    expect((await give(b.user.id, customer.token)).status).toBe(403);
  });
});

describe('admin store location', () => {
  it('moves the map pin, within valid coordinates', async () => {
    const move = (body: Record<string, unknown>, id = 1, token = admin) => api(`/admin/stores/${id}/location`, { token, body });
    expect((await move({ lat: 14.5601, lng: 121.0302 })).body).toEqual({ lat: 14.5601, lng: 121.0302 });
    expect((await api('/admin/stores/1', { token: admin })).body.store).toMatchObject({ lat: 14.5601, lng: 121.0302 });
    expect((await move({ lat: 91, lng: 121 })).status).toBe(400);
    expect((await move({ lat: 14.5 })).status).toBe(400);
    expect((await move({ lat: 14.5, lng: 121 }, 999999)).status).toBe(404);
    expect((await move({ lat: 14.5, lng: 121 }, 1, customer.token)).status).toBe(403);
  });
});
