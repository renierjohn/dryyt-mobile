import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api, registerUser } from '../helpers';
import { createDropoff, droppedOffDropoff, makeShop } from './helpers';
import { closeAll } from './socket';

afterEach(closeAll);

type Page = { items: { kind: string; order?: { id: number }; dropoff?: { id: number } }[]; next: string | null };
const itemId = (i: Page['items'][number]) => `${i.kind}-${i.order?.id ?? i.dropoff?.id}`;

/** Orders straight into D1 with fixed times, so ties and ordering are deterministic. */
async function insertOrders(customerId: number, times: string[], driverId: number | null = null, status = 'pending') {
  const ids: number[] = [];
  for (const at of times) {
    const row = await env.DB.prepare(
      `INSERT INTO orders (type, customer_id, driver_id, store_id, status, customer_address, items_total, delivery_fee, created_at, updated_at)
       VALUES ('pickup', ?, ?, 1, ?, '1 Home St', 10000, 5000, ?, ?) RETURNING id`,
    )
      .bind(customerId, driverId, status, at, at)
      .first<{ id: number }>();
    ids.push(row!.id);
  }
  return ids;
}

async function allPages(token: string) {
  const pages: Page[] = [];
  let next: string | null = null;
  do {
    const res: { status: number; body: Page } = await api<Page>(`/history${next ? `?before=${encodeURIComponent(next)}` : ''}`, { token });
    expect(res.status).toBe(200);
    pages.push(res.body);
    next = res.body.next;
  } while (next && pages.length < 10);
  return pages;
}

describe('history', () => {
  it('pages a customer through orders and drop offs, 10 at a time, newest first, no repeats', async () => {
    const customer = await registerUser('customer');
    // 11 orders, two sharing a timestamp, all older than the drop off made just now.
    const times = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 10).padStart(2, '0')} 08:00:00`);
    const orderIds = await insertOrders(customer.user.id, [...times, times[9]]);
    const { storeId } = await makeShop();
    const dropoffId = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id;

    const pages = await allPages(customer.token);
    expect(pages.map((p) => p.items.length)).toEqual([10, 2]);
    expect(pages[1].next).toBeNull();
    const seen = pages.flatMap((p) => p.items.map(itemId));
    expect(seen[0]).toBe(`dropoff-${dropoffId}`);
    expect(new Set(seen).size).toBe(12);
    expect(seen.slice(1, 3).sort()).toEqual([`order-${orderIds[9]}`, `order-${orderIds[10]}`].sort());
    expect(seen[11]).toBe(`order-${orderIds[0]}`);
  });

  it('puts shop-confirmed drop offs first, across pages', async () => {
    const customer = await registerUser('customer');
    const orderIds = await insertOrders(
      customer.user.id,
      Array.from({ length: 11 }, (_, i) => `2026-03-${String(i + 10).padStart(2, '0')} 08:00:00`),
    );
    const { storeId } = await makeShop();
    const confirmed: number[] = [];
    for (const at of ['2026-01-01 08:00:00', '2026-01-02 08:00:00']) {
      const row = await env.DB.prepare(
        `INSERT INTO transactions (room_id, customer_id, store_id, status, customer_lat, customer_lng, customer_address,
           shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee, created_at, updated_at)
         VALUES (?, ?, ?, 'owner_confirmed', 14.56, 121.03, 'Home', 14.55, 121.02, 1, 5000, 500, 5500, ?, ?) RETURNING id`,
      )
        .bind(crypto.randomUUID(), customer.user.id, storeId, at, at)
        .first<{ id: number }>();
      confirmed.push(row!.id);
    }

    const seen = (await allPages(customer.token)).flatMap((p) => p.items.map(itemId));
    expect(seen.slice(0, 2)).toEqual([`dropoff-${confirmed[1]}`, `dropoff-${confirmed[0]}`]);
    expect(seen.slice(2)).toEqual([...orderIds].reverse().map((id) => `order-${id}`));
  });

  it('records a driver’s finished drop offs and delivered orders, not other people’s', async () => {
    const flow = await droppedOffDropoff();
    const [delivered] = await insertOrders(flow.customer.user.id, ['2026-01-01 08:00:00'], flow.driver.user.id, 'delivered');
    await insertOrders(flow.customer.user.id, ['2026-01-02 08:00:00'], flow.driver.user.id, 'accepted');

    const [page] = await allPages(flow.driver.token);
    expect(page.items.map(itemId)).toEqual([`dropoff-${flow.id}`, `order-${delivered}`]);
    expect(page.items[0].dropoff).toMatchObject({ status: 'dropped_off', delivery_fee: expect.any(Number) });

    // Earnings: the drop off's delivery fee plus the delivered order's fee minus its service fee; not the accepted one.
    await env.DB.prepare('UPDATE orders SET service_fee = 500 WHERE driver_id = ?').bind(flow.driver.user.id).run();
    const fee = (await env.DB.prepare('SELECT delivery_fee FROM transactions WHERE id = ?').bind(flow.id).first<{ delivery_fee: number }>())!;
    const { body } = await api<{ earnings: number }>('/history', { token: flow.driver.token });
    expect(body.earnings).toBe(fee.delivery_fee + 5000 - 500);

    const stranger = await registerUser('driver');
    expect((await allPages(stranger.token))[0].items).toEqual([]);
  });

  it('rejects owners and bad cursors', async () => {
    const owner = await registerUser('owner');
    expect((await api('/history', { token: owner.token })).status).toBe(403);
    const customer = await registerUser('customer');
    expect((await api('/history?before=nonsense', { token: customer.token })).status).toBe(400);
  });
});
