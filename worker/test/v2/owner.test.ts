import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api, registerUser } from '../helpers';
import { droppedOffDropoff, makeShop, tripKeys } from './helpers';
import { closeAll } from './socket';

afterEach(closeAll);

const post = (path: string, token: string, body?: unknown) => api(path, { token, method: 'POST', body });

async function withOwner() {
  const owner = await registerUser('owner');
  const flow = await droppedOffDropoff({ ownerId: owner.user.id });
  return { owner, ...flow };
}

describe('owner', () => {
  it('needs a linked shop', async () => {
    const owner = await registerUser('owner');
    expect(await api('/owner/transactions', { token: owner.token })).toEqual({
      status: 409,
      body: { error: 'No shop linked to your account yet' },
    });
  });

  it('lists pending drop offs with the full fee split', async () => {
    const { owner, id } = await withOwner();
    const res = await api('/owner/transactions?status=pending', { token: owner.token });
    expect(res.body.dropoffs).toEqual([
      expect.objectContaining({ id, status: 'dropped_off', delivery_fee: 7200, service_fee: 800, laundry_fee: 25000, weight_kg: 6.5 }),
    ]);
    expect(res.body.dropoffs[0]).not.toHaveProperty('room_id');
  });

  it('confirming twice does not duplicate payouts', async () => {
    const { owner, driver, id } = await withOwner();
    const res = await post(`/owner/transactions/${id}/confirm`, owner.token);
    expect(res.body.dropoff).toMatchObject({ status: 'owner_confirmed', owner_status: 'ok' });
    expect((await post(`/owner/transactions/${id}/confirm`, owner.token)).status).toBe(409);

    const { body } = await api('/owner/payouts', { token: owner.token });
    expect(body.payouts.filter((p: { transaction_id: number }) => p.transaction_id === id)).toEqual([
      expect.objectContaining({ payee_type: 'developer', payee_id: null, amount: 800, status: 'pending' }),
      expect.objectContaining({ payee_type: 'driver', payee_id: driver.user.id, amount: 7200, status: 'pending' }),
    ]);
  });

  it('wipes the trip room on confirm', async () => {
    const { owner, id, room } = await withOwner();
    expect(await tripKeys(room)).not.toEqual([]);
    await post(`/owner/transactions/${id}/confirm`, owner.token);
    expect(await tripKeys(room, true)).toEqual([]);
  });

  it("counts the driver's share of a dropped-off drop off in their earnings, once", async () => {
    const { owner, driver, customer, id } = await withOwner();
    const earnings = async () => (await api('/history', { token: driver.token })).body.earnings;
    expect(await earnings()).toBe(7200);
    await post(`/owner/transactions/${id}/confirm`, owner.token);
    expect(await earnings()).toBe(7200);
    await post(`/owner/transactions/${id}/confirm`, owner.token);
    expect(await earnings()).toBe(7200);
    expect((await api('/history', { token: customer.token })).body).not.toHaveProperty('earnings');
    expect((await api('/history?before=1|x|dropoff|1', { token: driver.token })).body).not.toHaveProperty('earnings');
  });

  it('keeps other owners out', async () => {
    const { id } = await withOwner();
    const other = await registerUser('owner');
    await makeShop({ ownerId: other.user.id });
    expect((await post(`/owner/transactions/${id}/confirm`, other.token)).status).toBe(404);
    expect((await api(`/dropoffs/${id}`, { token: other.token })).status).toBe(404);
  });

  it('tracks payment both ways', async () => {
    const { owner, customer, driver, id } = await withOwner();
    expect((await post(`/dropoffs/${id}/payment`, customer.token, { paid: true })).status).toBe(409); // not confirmed yet
    await post(`/owner/transactions/${id}/confirm`, owner.token);

    expect((await post(`/dropoffs/${id}/payment`, customer.token, { paid: false })).status).toBe(403);
    expect((await post(`/dropoffs/${id}/payment`, driver.token, { paid: true })).status).toBe(403);

    expect((await post(`/dropoffs/${id}/payment`, customer.token, { paid: true })).body.dropoff.status).toBe('completed');
    expect((await post(`/dropoffs/${id}/payment`, owner.token, { paid: false })).body.dropoff.status).toBe('payment_pending');
    expect((await post(`/dropoffs/${id}/payment`, owner.token, { paid: true })).body.dropoff.status).toBe('completed');
  });

  it('marks payouts paid', async () => {
    const { owner, id } = await withOwner();
    await post(`/owner/transactions/${id}/confirm`, owner.token);
    const payout = (await api('/owner/payouts', { token: owner.token })).body.payouts.find(
      (p: { transaction_id: number; payee_type: string }) => p.transaction_id === id && p.payee_type === 'driver',
    );

    const res = await post(`/owner/payouts/${payout.id}/paid`, owner.token);
    expect(res.body.payout).toMatchObject({ id: payout.id, status: 'paid', paid_at: expect.any(String) });
    expect((await post(`/owner/payouts/${payout.id}/paid`, owner.token)).status).toBe(409);
  });

  it('blocks and unblocks a driver', async () => {
    const { owner, storeId, driver } = await withOwner();
    expect((await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: true })).body).toEqual({ blocked: true });
    const count = () => env.DB.prepare('SELECT COUNT(*) AS n FROM driver_blocks WHERE store_id = ? AND driver_id = ?').bind(storeId, driver.user.id).first();
    expect(await count()).toEqual({ n: 1 });

    await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: false });
    expect(await count()).toEqual({ n: 0 });

    const customer = await registerUser('customer');
    expect((await post('/owner/blocks', owner.token, { driver_id: customer.user.id, blocked: true })).status).toBe(404);
  });

  it('runs several shops: lists, confirms and pays out across all of them', async () => {
    const owner = await registerUser('owner');
    const first = await droppedOffDropoff({ ownerId: owner.user.id });
    const second = await droppedOffDropoff({ ownerId: owner.user.id });
    expect(first.storeId).not.toBe(second.storeId);

    const pending = await api('/owner/transactions?status=pending', { token: owner.token });
    expect(pending.body.dropoffs.map((d: { id: number }) => d.id).sort()).toEqual([first.id, second.id].sort());

    await post(`/owner/transactions/${first.id}/confirm`, owner.token);
    await post(`/owner/transactions/${second.id}/confirm`, owner.token);
    const payouts = (await api('/owner/payouts', { token: owner.token })).body.payouts as { id: number; payer_store_id: number; store_name: string }[];
    expect(new Set(payouts.map((p) => p.payer_store_id))).toEqual(new Set([first.storeId, second.storeId]));
    expect(payouts[0].store_name).toBe('Test Laundry');
    expect((await post(`/owner/payouts/${payouts[payouts.length - 1].id}/paid`, owner.token)).status).toBe(200);
  });

  it('blocks a driver at one shop or at all of them', async () => {
    const owner = await registerUser('owner');
    const a = await makeShop({ ownerId: owner.user.id });
    const b = await makeShop({ ownerId: owner.user.id });
    const other = await makeShop();
    const driver = await registerUser('driver');
    const blockedAt = async () =>
      (await env.DB.prepare('SELECT store_id FROM driver_blocks WHERE driver_id = ? ORDER BY store_id').bind(driver.user.id).all()).results.map(
        (r) => r.store_id,
      );

    await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: true, store_id: a.storeId });
    expect(await blockedAt()).toEqual([a.storeId]);
    await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: true });
    expect(await blockedAt()).toEqual([a.storeId, b.storeId]);
    expect((await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: true, store_id: other.storeId })).status).toBe(404);
    await post('/owner/blocks', owner.token, { driver_id: driver.user.id, blocked: false });
    expect(await blockedAt()).toEqual([]);
  });

  it('pages drop offs and payouts 10 at a time, not yet paid/pending first, without repeats', async () => {
    const owner = await registerUser('owner');
    const customer = await registerUser('customer');
    const { storeId } = await makeShop({ ownerId: owner.user.id });
    // Oldest first; the two waiting ones share a timestamp.
    const statuses = [...Array(5).fill('completed'), ...Array(3).fill('owner_confirmed'), 'payment_pending', 'payment_pending', 'dropped_off', 'dropped_off'];
    const times = statuses.map((_, i) => `2026-02-${String(i + 1).padStart(2, '0')} 09:00:00`);
    times[11] = times[10];
    const ids: number[] = [];
    for (const [i, status] of statuses.entries()) {
      const row = await env.DB.prepare(
        `INSERT INTO transactions (room_id, customer_id, store_id, status, customer_lat, customer_lng, customer_address,
           shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee, created_at, updated_at)
         VALUES (?, ?, ?, ?, 14.56, 121.03, 'Home', 14.55, 121.02, 1, 5000, 500, 5500, ?, ?) RETURNING id`,
      )
        .bind(crypto.randomUUID(), customer.user.id, storeId, status, times[i], times[i])
        .first<{ id: number }>();
      ids.push(row!.id);
      await env.DB.prepare("INSERT INTO payouts (transaction_id, payer_store_id, payee_type, amount, status) VALUES (?, ?, 'developer', 500, ?)")
        .bind(row!.id, storeId, i < 2 ? 'pending' : 'paid')
        .run();
    }

    type Page = { next: string | null; dropoffs?: { id: number; status: string }[]; payouts?: { id: number; status: string }[] };
    const pages = async (path: string, key: 'dropoffs' | 'payouts') => {
      const out: { id: number; status: string }[][] = [];
      let next: string | null = null;
      do {
        const res: { status: number; body: Page } = await api<Page>(`${path}${next ? `?before=${encodeURIComponent(next)}` : ''}`, { token: owner.token });
        expect(res.status).toBe(200);
        out.push(res.body[key]!);
        next = res.body.next;
      } while (next && out.length < 5);
      return out;
    };

    const dropoffs = await pages('/owner/transactions', 'dropoffs');
    expect(dropoffs.map((p) => p.length)).toEqual([10, 2]);
    const flat = dropoffs.flat();
    expect(new Set(flat.map((d) => d.id)).size).toBe(12);
    expect(flat.map((d) => d.id)).toEqual([9, 8, 11, 10, 7, 6, 5, 4, 3, 2, 1, 0].map((i) => ids[i]));

    const payouts = await pages('/owner/payouts', 'payouts');
    expect(payouts.map((p) => p.length)).toEqual([10, 2]);
    expect(payouts.flat().map((p) => p.status).slice(0, 3)).toEqual(['pending', 'pending', 'paid']);
    expect(new Set(payouts.flat().map((p) => p.id)).size).toBe(12);

    expect((await api('/owner/payouts?before=junk', { token: owner.token })).status).toBe(400);
  });

  it("lists delivered pickups' driver share and marks it paid once", async () => {
    const owner = await registerUser('owner');
    const { storeId } = await makeShop({ ownerId: owner.user.id });
    const driver = await registerUser('driver');
    const customer = await registerUser('customer');
    const insert = (status: string) =>
      env.DB.prepare(
        `INSERT INTO orders (type, customer_id, driver_id, store_id, status, customer_address, items_total, delivery_fee, service_fee)
         VALUES ('pickup', ?, ?, ?, ?, '1 Customer St', 0, 8800, 800) RETURNING id`,
      )
        .bind(customer.user.id, driver.user.id, storeId, status)
        .first<{ id: number }>();
    const delivered = (await insert('delivered'))!.id;
    const onTheWay = (await insert('picked_up'))!.id;

    const list = await api('/owner/pickup-payouts', { token: owner.token });
    expect(list.body.payouts).toEqual([
      expect.objectContaining({ id: delivered, driver_id: driver.user.id, driver_name: driver.user.name, amount: 8000, paid_at: null }),
    ]);

    const res = await post(`/owner/orders/${delivered}/driver-paid`, owner.token);
    expect(res.body.payout).toMatchObject({ id: delivered, paid_at: expect.any(String) });
    expect((await post(`/owner/orders/${delivered}/driver-paid`, owner.token)).status).toBe(409);
    expect((await post(`/owner/orders/${onTheWay}/driver-paid`, owner.token)).status).toBe(409);
    const other = await registerUser('owner');
    await makeShop({ ownerId: other.user.id });
    expect((await post(`/owner/orders/${delivered}/driver-paid`, other.token)).status).toBe(404);
    expect((await api('/owner/pickup-payouts?before=junk', { token: owner.token })).status).toBe(400);
  });

  it('a failed confirm leaves the drop off confirmable', async () => {
    const { owner, id } = await withOwner();
    await env.DB.prepare("INSERT INTO payouts (transaction_id, payer_store_id, payee_type, payee_id, amount) SELECT id, store_id, 'driver', driver_id, 1 FROM transactions WHERE id = ?").bind(id).run();

    expect((await post(`/owner/transactions/${id}/confirm`, owner.token)).status).toBeGreaterThanOrEqual(500);
    expect((await api(`/dropoffs/${id}`, { token: owner.token })).body.dropoff.status).toBe('dropped_off');

    await env.DB.prepare('DELETE FROM payouts WHERE transaction_id = ?').bind(id).run();
    const res = await post(`/owner/transactions/${id}/confirm`, owner.token);
    expect(res.status).toBe(200);
    expect(res.body.dropoff.status).toBe('owner_confirmed');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM payouts WHERE transaction_id = ?').bind(id).first()).toEqual({ n: 2 });
  });
});
