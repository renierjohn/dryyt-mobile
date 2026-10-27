import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrderRoom } from '../../src/do/pickups';
import { api, registerUser, registerVerifiedDriver } from '../helpers';
import { closeAll, openSocket } from './socket';

afterEach(closeAll);

const order = { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' };

async function pickupDriver() {
  const driver = await registerVerifiedDriver();
  await api('/drivers/me/pickup-online', { token: driver.token, body: { online: true } });
  return driver;
}

/** Placed by the customer: awaiting payment → confirmed → placed (pending), like the app does. */
async function placed(customerToken: string) {
  const id = (await api('/orders', { token: customerToken, body: { ...order, payment_ref: 'GC-1' } })).body.order.id as number;
  await env.DB.prepare("UPDATE transactions_pickup SET status = 'payment_confirmed' WHERE id = ?").bind(id).run();
  return id;
}

const jobIds = (msg: { jobs: { id: number }[] }) => msg.jobs.map((j) => j.id);

describe('pickup job board', () => {
  it('lets only drivers online for pickup join', async () => {
    const offline = await registerUser('driver');
    expect((await api('/ws/ticket', { token: offline.token, body: { room: 'pickups' } })).status).toBe(403);
    expect((await api('/drivers/me', { token: offline.token })).body.driver.pickup_online).toBe(false);

    const online = await pickupDriver();
    expect((await api('/drivers/me', { token: online.token })).body.driver.pickup_online).toBe(true);
    expect((await api('/ws/ticket', { token: online.token, body: { room: 'pickups' } })).status).toBe(200);
  });

  it('pushes the job list when an order is placed, taken and released', async () => {
    const driver = await pickupDriver();
    const customer = await registerUser('customer');
    const board = await openSocket(driver.token, 'pickups');
    await board.next('jobs');

    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    expect(jobIds(await board.next('jobs'))).toContain(id);

    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    expect(jobIds(await board.next('jobs'))).not.toContain(id);
    expect((await api('/drivers/me', { token: driver.token })).body.driver.pickup_job_id).toBe(id);

    await api(`/jobs/${id}/release`, { token: driver.token, method: 'POST' });
    expect(jobIds(await board.next('jobs'))).toContain(id);
  });
});

describe('order room', () => {
  it('opens for the customer once the proof is sent and for the driver once they accept', async () => {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    const ticket = (token: string) => api('/ws/ticket', { token, body: { room: `order-${id}` } });

    expect((await ticket(customer.token)).status).toBe(200);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    expect((await ticket(customer.token)).status).toBe(200);
    expect((await ticket(driver.token)).status).toBe(403);
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    expect((await ticket(driver.token)).status).toBe(200);
    expect((await ticket((await registerUser('customer')).token)).status).toBe(403);
  });

  it('sends status changes, relays the driver location once picked up, and closes at delivery', async () => {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });

    const customerSock = await openSocket(customer.token, `order-${id}`);
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    expect((await customerSock.next('order')).order).toMatchObject({ id, status: 'accepted', driver_name: driver.user.name });

    const driverSock = await openSocket(driver.token, `order-${id}`);
    await api(`/jobs/${id}/status`, { token: driver.token, body: { status: 'picked_up' } });
    expect((await customerSock.next('order')).order.status).toBe('picked_up');

    driverSock.send({ t: 'loc', lat: 14.55, lng: 121.02 });
    expect(await customerSock.next('loc')).toEqual({ t: 'loc', lat: 14.55, lng: 121.02 });
    expect((await api(`/orders/${id}`, { token: customer.token })).body.order).toMatchObject({ driver_lat: 14.55, driver_lng: 121.02 });

    await api(`/jobs/${id}/status`, { token: driver.token, body: { status: 'delivered' } });
    expect((await customerSock.next('order')).order.status).toBe('delivered');
    expect((await api('/ws/ticket', { token: customer.token, body: { room: `order-${id}` } })).status).toBe(403);
  });

  it('relays every driver location but saves it on the order at most every 30 s', async () => {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    await api(`/jobs/${id}/status`, { token: driver.token, body: { status: 'picked_up' } });

    const customerSock = await openSocket(customer.token, `order-${id}`);
    const driverSock = await openSocket(driver.token, `order-${id}`);
    driverSock.send({ t: 'loc', lat: 14.55, lng: 121.02 });
    await customerSock.next('loc');
    await new Promise((r) => setTimeout(r, 2_100));
    driverSock.send({ t: 'loc', lat: 14.56, lng: 121.03 });
    expect(await customerSock.next('loc')).toEqual({ t: 'loc', lat: 14.56, lng: 121.03 });
    expect((await api(`/orders/${id}`, { token: customer.token })).body.order).toMatchObject({ driver_lat: 14.55, driver_lng: 121.02 });
  });

  it('ignores driver locations before pickup', async () => {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });

    const driverSock = await openSocket(driver.token, `order-${id}`);
    driverSock.send({ t: 'loc', lat: 14.55, lng: 121.02 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await api(`/orders/${id}`, { token: customer.token })).body.order.driver_lat).toBeNull();
  });
});

describe('waiting for Done Pay', () => {
  const statusOf = async (id: number) => (await env.DB.prepare('SELECT status FROM transactions_pickup WHERE id = ?').bind(id).first<{ status: string }>())!.status;
  const roomOf = (id: number) => env.ORDER_ROOM.get(env.ORDER_ROOM.idFromName(`order-${id}`));
  type Timers = { remindAt?: number; reminded?: number; confirmAt?: number };
  const paymentTimers = (id: number) => runInDurableObject(roomOf(id), (_r: OrderRoom, state) => state.storage.get<Timers>('payment'));

  /** A food order just sent with its proof, once the room has started its timers. */
  async function awaiting(customerToken: string) {
    const id = (await api('/orders', { token: customerToken, body: { ...order, payment_ref: 'GC-1' } })).body.order.id as number;
    for (let i = 0; i < 50 && !(await paymentTimers(id)); i++) await new Promise((r) => setTimeout(r, 10));
    return id;
  }
  const dueNow = (id: number, timers: Timers) =>
    runInDurableObject(roomOf(id), async (_r: OrderRoom, state) => {
      await state.storage.put('payment', timers);
      await state.storage.setAlarm(Date.now());
    });

  it('reminds the owner every minute, 10 times, then accepts the payment a minute after the last', async () => {
    const customer = await registerUser('customer');
    const id = await awaiting(customer.token);
    const timers = (await paymentTimers(id))!;
    expect(timers).toMatchObject({ reminded: 0 });
    expect(timers.confirmAt! - timers.remindAt!).toBe(10 * 60_000);

    await dueNow(id, { ...timers, remindAt: 0 });
    await runDurableObjectAlarm(roomOf(id));
    expect(await statusOf(id)).toBe('awaiting_payment');
    expect(await paymentTimers(id)).toEqual({ remindAt: 60_000, reminded: 1, confirmAt: timers.confirmAt });

    // The 10th reminder is the last.
    await dueNow(id, { remindAt: 0, reminded: 9, confirmAt: timers.confirmAt });
    await runDurableObjectAlarm(roomOf(id));
    expect(await paymentTimers(id)).toEqual({ reminded: 10, confirmAt: timers.confirmAt });
    expect(await statusOf(id)).toBe('awaiting_payment');

    const customerSock = await openSocket(customer.token, `order-${id}`);
    await dueNow(id, { confirmAt: 0 });
    await runDurableObjectAlarm(roomOf(id));
    expect((await customerSock.next('order')).order.status).toBe('payment_confirmed');
    expect(await statusOf(id)).toBe('payment_confirmed');
    expect(await paymentTimers(id)).toBeUndefined();
  });

  it('stops the timers when the customer cancels, and never accepts a cancelled order', async () => {
    const customer = await registerUser('customer');
    const id = await awaiting(customer.token);
    await api(`/orders/${id}/cancel`, { token: customer.token, method: 'POST' });
    for (let i = 0; i < 50 && (await paymentTimers(id)); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await paymentTimers(id)).toBeUndefined();

    await dueNow(id, { confirmAt: 0 });
    await runDurableObjectAlarm(roomOf(id));
    expect(await statusOf(id)).toBe('cancelled');
  });

  it("sends the owner's Done Pay over the customer's socket", async () => {
    const customer = await registerUser('customer');
    const owner = await registerUser('owner');
    await env.DB.prepare('UPDATE stores SET owner_id = ? WHERE id = 2').bind(owner.user.id).run();
    const id = await awaiting(customer.token);
    const customerSock = await openSocket(customer.token, `order-${id}`);

    expect((await api(`/owner/orders/${id}/confirm-payment`, { token: owner.token, method: 'POST' })).status).toBe(200);
    expect((await customerSock.next('order')).order.status).toBe('payment_confirmed');
    expect(await paymentTimers(id)).toBeUndefined();
  });
});
