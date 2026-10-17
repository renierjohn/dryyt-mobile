import { beforeEach, describe, expect, it } from 'vitest';

import { api, placeOrder as postOrder, registerUser } from './helpers';

let customer: string;
let driver: string;
let driver2: string;

beforeEach(async () => {
  customer = (await registerUser('customer')).token;
  driver = (await registerUser('driver')).token;
  driver2 = (await registerUser('driver')).token;
});

async function placeOrder(): Promise<number> {
  const res = await postOrder({
    token: customer,
    body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' },
  });
  return res.body.order.id;
}

const accept = (id: number, token: string) => api(`/jobs/${id}/accept`, { token, method: 'POST' });
const advance = (id: number, token: string, status: string) => api(`/jobs/${id}/status`, { token, body: { status } });

describe('jobs', () => {
  it('lists pending orders for drivers only', async () => {
    const id = await placeOrder();
    const res = await api('/jobs/available', { token: driver });
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: number }) => j.id)).toEqual([id]);
    expect((await api('/jobs/available', { token: customer })).status).toBe(403);
  });

  it('hides customer phone until the job is accepted', async () => {
    const id = await placeOrder();
    const listed = await api('/jobs/available', { token: driver });
    expect(listed.body.jobs[0].customer_phone).toBeNull();
    expect((await api(`/orders/${id}`, { token: driver })).body.order.customer_phone).toBeNull();

    await accept(id, driver);
    const active = await api('/jobs/active', { token: driver });
    expect(active.body.job.customer_phone).toEqual(expect.any(String));
  });

  it('lets the driver release an accepted job back to the board', async () => {
    const id = await placeOrder();
    await accept(id, driver);

    expect((await api(`/jobs/${id}/release`, { token: driver2, method: 'POST' })).status).toBe(403);

    const res = await api(`/jobs/${id}/release`, { token: driver, method: 'POST' });
    expect(res.status).toBe(200);
    expect((await api('/jobs/active', { token: driver })).body.job).toBeNull();
    expect((await api(`/orders/${id}`, { token: customer })).body.order).toMatchObject({ status: 'pending', driver_id: null });

    // Released job can be taken by someone else; picked-up jobs cannot be released.
    expect((await accept(id, driver2)).status).toBe(200);
    await advance(id, driver2, 'picked_up');
    expect((await api(`/jobs/${id}/release`, { token: driver2, method: 'POST' })).status).toBe(409);
  });

  it('accepts a job and shows the driver to the customer', async () => {
    const id = await placeOrder();
    const res = await accept(id, driver);
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id, status: 'accepted', driver_name: expect.any(String) });

    const seen = await api(`/orders/${id}`, { token: customer });
    expect(seen.body.order.driver_phone).toEqual(expect.any(String));
    expect((await api('/jobs/available', { token: driver2 })).body.jobs).toEqual([]);
  });

  it('lets only one of two concurrent accepts win', async () => {
    const id = await placeOrder();
    const results = await Promise.all([accept(id, driver), accept(id, driver2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('blocks a driver from holding two active jobs', async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    await accept(first, driver);
    expect(await accept(second, driver)).toEqual({ status: 409, body: { error: 'Finish your active job first' } });
  });

  it('rejects accepting cancelled or unknown jobs', async () => {
    const id = await placeOrder();
    await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect((await accept(id, driver)).status).toBe(409);
    expect((await accept(999, driver)).status).toBe(404);
  });

  it('moves through statuses in order, by the assigned driver only', async () => {
    const id = await placeOrder();
    await accept(id, driver);

    expect((await advance(id, driver, 'delivered')).status).toBe(409);
    expect((await advance(id, driver2, 'picked_up')).status).toBe(403);
    expect((await advance(id, driver, 'cancelled')).status).toBe(400);

    expect((await advance(id, driver, 'picked_up')).body.job.status).toBe('picked_up');
    expect((await advance(id, driver, 'delivered')).body.job.status).toBe('delivered');
    expect((await advance(id, driver, 'delivered')).status).toBe(409);
  });

  it('tracks the active job and history', async () => {
    const id = await placeOrder();
    expect((await api('/jobs/active', { token: driver })).body.job).toBeNull();

    await accept(id, driver);
    const active = await api('/jobs/active', { token: driver });
    expect(active.body.job).toMatchObject({ id, items: [{ name: 'Classic Burger', qty: 1 }] });

    await advance(id, driver, 'picked_up');
    await advance(id, driver, 'delivered');
    expect((await api('/jobs/active', { token: driver })).body.job).toBeNull();
    expect((await api('/jobs/history', { token: driver })).body.jobs.map((j: { id: number }) => j.id)).toEqual([id]);

    // Free again after delivering.
    expect((await accept(await placeOrder(), driver)).status).toBe(200);
  });
});
