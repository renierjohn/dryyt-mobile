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

describe('order chat', () => {
  async function acceptedOrder() {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    return { customer, driver, id };
  }

  it('relays messages both ways once the driver accepts, and replays them on reconnect', async () => {
    const { customer, driver, id } = await acceptedOrder();
    const customerSock = await openSocket(customer.token, `order-${id}`);
    const driverSock = await openSocket(driver.token, `order-${id}`);
    expect(await customerSock.next('chat')).toEqual({ t: 'chat', messages: [] });
    await driverSock.next('chat');

    customerSock.send({ t: 'chat', text: '  Gate is blue  ' });
    expect((await driverSock.next('chat')).messages).toEqual([{ from: 'customer', text: 'Gate is blue', at: expect.any(Number) }]);
    await customerSock.next('chat');
    driverSock.send({ t: 'chat', text: 'On my way' });
    const both = (await customerSock.next('chat')).messages.map((m: { from: string; text: string }) => [m.from, m.text]);
    expect(both).toEqual([['customer', 'Gate is blue'], ['driver', 'On my way']]);

    customerSock.close();
    expect((await (await openSocket(customer.token, `order-${id}`)).next('chat')).messages).toHaveLength(2);
  });

  it('takes up to 10 messages each, of up to 100 characters', async () => {
    const { customer, driver, id } = await acceptedOrder();
    const customerSock = await openSocket(customer.token, `order-${id}`);
    const driverSock = await openSocket(driver.token, `order-${id}`);
    await customerSock.next('chat');
    await driverSock.next('chat');

    customerSock.send({ t: 'chat', text: 'x'.repeat(101) });
    expect(await customerSock.next('chat_error')).toEqual({ t: 'chat_error', error: 'Messages can be up to 100 characters' });
    customerSock.send({ t: 'chat', text: '   ' });
    expect(await customerSock.next('chat_error')).toEqual({ t: 'chat_error', error: 'Type a message first' });

    for (let i = 1; i <= 10; i++) {
      customerSock.send({ t: 'chat', text: 'x'.repeat(100) });
      expect((await customerSock.next('chat')).messages).toHaveLength(i);
    }
    customerSock.send({ t: 'chat', text: 'one more' });
    expect(await customerSock.next('chat_error')).toEqual({ t: 'chat_error', error: 'You can send up to 10 messages' });
    // The driver still has their own 10.
    driverSock.send({ t: 'chat', text: 'ok' });
    for (let i = 0; i < 11; i++) await driverSock.next('chat');
    expect((await customerSock.next('chat')).messages).toHaveLength(11);
  });

  it('ends once the driver picks the order up', async () => {
    const { customer, driver, id } = await acceptedOrder();
    const customerSock = await openSocket(customer.token, `order-${id}`);
    await customerSock.next('chat');
    customerSock.send({ t: 'chat', text: 'Hello' });
    expect((await customerSock.next('chat')).messages).toHaveLength(1);

    await api(`/jobs/${id}/status`, { token: driver.token, body: { status: 'picked_up' } });
    expect((await customerSock.next('order')).order.status).toBe('picked_up');
    customerSock.send({ t: 'chat', text: 'Still there?' });
    await expect(customerSock.next(['chat', 'chat_error'], 30)).rejects.toThrow();
    // Not replayed on reconnect either: the messages are gone.
    const again = await openSocket(customer.token, `order-${id}`);
    await expect(again.next('chat', 30)).rejects.toThrow();
  });

  it('starts fresh for the next driver after a release, and ignores chat before a driver has the job', async () => {
    const { customer, driver, id } = await acceptedOrder();
    const customerSock = await openSocket(customer.token, `order-${id}`);
    await customerSock.next('chat');
    customerSock.send({ t: 'chat', text: 'Hello' });
    expect((await customerSock.next('chat')).messages).toHaveLength(1);

    await api(`/jobs/${id}/release`, { token: driver.token, method: 'POST' });
    expect((await customerSock.next('order')).order.status).toBe('pending');
    customerSock.send({ t: 'chat', text: 'Anyone?' });
    await expect(customerSock.next(['chat', 'chat_error'], 30)).rejects.toThrow();

    const next = await pickupDriver();
    await api(`/jobs/${id}/accept`, { token: next.token, method: 'POST' });
    expect((await (await openSocket(next.token, `order-${id}`)).next('chat')).messages).toEqual([]);
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

  it('lets the owner turn down a payment: back to to_pay, timers stopped, and the customer pays again', async () => {
    const customer = await registerUser('customer');
    const owner = await registerUser('owner');
    await env.DB.prepare('UPDATE stores SET owner_id = ? WHERE id = 2').bind(owner.user.id).run();
    const id = await awaiting(customer.token);
    const reject = (reason: string, token = owner.token) => api(`/owner/orders/${id}/reject-payment`, { token, body: { reason } });

    expect((await reject('')).status).toBe(400);
    // Another shop's owner can't touch it.
    const other = await registerUser('owner');
    await env.DB.prepare('UPDATE stores SET owner_id = ? WHERE id = 1').bind(other.user.id).run();
    expect((await reject('Not received', other.token)).status).toBe(404);
    const res = await reject('No GCash payment with that reference');
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ status: 'to_pay', payment_ref: '', payment_photo_key: null, payment_rejected_reason: 'No GCash payment with that reference' });
    for (let i = 0; i < 50 && (await paymentTimers(id)); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await paymentTimers(id)).toBeUndefined();
    expect((await reject('Again')).status).toBe(409);

    // Auto-accept can't fire on it any more.
    await dueNow(id, { confirmAt: 0 });
    await runDurableObjectAlarm(roomOf(id));
    expect(await statusOf(id)).toBe('to_pay');

    const paid = await api(`/orders/${id}/payment`, { token: customer.token, body: { payment_ref: 'GC-2' } });
    expect(paid.body.order).toMatchObject({ status: 'awaiting_payment', payment_ref: 'GC-2', payment_rejected_reason: null });
    for (let i = 0; i < 50 && !(await paymentTimers(id)); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await paymentTimers(id)).toMatchObject({ reminded: 0 });
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

describe('driver who goes silent', () => {
  const roomOf = (id: number) => env.ORDER_ROOM.get(env.ORDER_ROOM.idFromName(`order-${id}`));
  type Watch = { id: number; seenAt: number; warned?: boolean; reported?: boolean };
  const watchOf = (id: number) => runInDurableObject(roomOf(id), (_r: OrderRoom, state) => state.storage.get<Watch>('driver'));
  const row = (id: number) =>
    env.DB.prepare('SELECT o.status, o.driver_id, d.busy FROM transactions_pickup o LEFT JOIN drivers d ON d.user_id = ? WHERE o.id = ?');
  /** Pretends the driver was last heard from `ago` ms ago, then fires the alarm. */
  const silentFor = async (id: number, ago: number, extra: Partial<Watch> = {}) => {
    await runInDurableObject(roomOf(id), async (_r: OrderRoom, state) => {
      const watch = (await state.storage.get<Watch>('driver'))!;
      await state.storage.put('driver', { ...watch, ...extra, seenAt: Date.now() - ago });
      // Later than now, so it runs only when the test fires it.
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await runDurableObjectAlarm(roomOf(id));
  };

  async function accepted() {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    await api(`/orders/${id}/place`, { token: customer.token, method: 'POST' });
    await api(`/jobs/${id}/accept`, { token: driver.token, method: 'POST' });
    for (let i = 0; i < 50 && !(await watchOf(id)); i++) await new Promise((r) => setTimeout(r, 10));
    return { customer, driver, id };
  }

  const silentAt = async (id: number) =>
    (await env.DB.prepare('SELECT driver_silent_at FROM transactions_pickup WHERE id = ?').bind(id).first<{ driver_silent_at: string | null }>())!.driver_silent_at;

  it('watches the driver from accept, warns at 5 min, and flags them silent at 10 without taking the job', async () => {
    const { customer, driver, id } = await accepted();
    expect(await watchOf(id)).toMatchObject({ id: driver.user.id });
    // Before the flag, an accepted order can't be cancelled or handed on.
    expect((await api(`/orders/${id}/cancel`, { token: customer.token, method: 'POST' })).status).toBe(409);
    expect((await api(`/orders/${id}/new-driver`, { token: customer.token, method: 'POST' })).status).toBe(409);

    await silentFor(id, 5 * 60_000 + 1);
    expect(await watchOf(id)).toMatchObject({ warned: true });
    expect(await silentAt(id)).toBeNull();

    const customerSock = await openSocket(customer.token, `order-${id}`);
    await silentFor(id, 10 * 60_000 + 1);
    expect((await customerSock.next('order')).order.driver_silent_at).toEqual(expect.any(String));
    expect(await row(id).bind(driver.user.id, id).first()).toEqual({ status: 'accepted', driver_id: driver.user.id, busy: 1 });
    expect(await watchOf(id)).toMatchObject({ reported: true });
  });

  it('lets the customer send a silent driver\'s order back to the board', async () => {
    const { customer, driver, id } = await accepted();
    await silentFor(id, 10 * 60_000 + 1);
    const other = await registerUser('customer');
    expect((await api(`/orders/${id}/new-driver`, { token: other.token, method: 'POST' })).status).toBe(403);

    const res = await api(`/orders/${id}/new-driver`, { token: customer.token, method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ status: 'pending', driver_id: null, driver_silent_at: null });
    expect(await row(id).bind(driver.user.id, id).first()).toMatchObject({ busy: 0 });
    for (let i = 0; i < 50 && (await watchOf(id)); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await watchOf(id)).toBeUndefined();
  });

  it('lets the customer cancel once the driver is flagged silent, freeing the driver', async () => {
    const { customer, driver, id } = await accepted();
    await silentFor(id, 10 * 60_000 + 1);
    const res = await api(`/orders/${id}/cancel`, { token: customer.token, method: 'POST' });
    expect(res.status).toBe(200);
    expect(await row(id).bind(driver.user.id, id).first()).toEqual({ status: 'cancelled', driver_id: driver.user.id, busy: 0 });
  });

  it('clears the flag when the driver comes back', async () => {
    const { customer, driver, id } = await accepted();
    await silentFor(id, 10 * 60_000 + 1);
    expect(await silentAt(id)).not.toBeNull();
    await openSocket(driver.token, `order-${id}`);
    for (let i = 0; i < 50 && (await silentAt(id)); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await silentAt(id)).toBeNull();
    expect((await api(`/orders/${id}/new-driver`, { token: customer.token, method: 'POST' })).status).toBe(409);
  });

  it('keeps the job while the driver socket sends heartbeats', async () => {
    const { driver, id } = await accepted();
    const sock = await openSocket(driver.token, `order-${id}`);
    sock.send({ t: 'ping' });
    await sock.next('pong');
    // The stored seenAt is stale, but the heartbeat (answered without waking the room) counts as seen.
    await runInDurableObject(roomOf(id), async (_r: OrderRoom, state) => {
      await state.storage.put('driver', { ...(await state.storage.get<Watch>('driver'))!, seenAt: Date.now() - 10 * 60_000 - 1 });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await runDurableObjectAlarm(roomOf(id));
    expect(await row(id).bind(driver.user.id, id).first()).toMatchObject({ status: 'accepted', driver_id: driver.user.id });
  });

  it('reports a silent driver who picked the order up once, without taking it off them', async () => {
    const { customer, driver, id } = await accepted();
    await api(`/jobs/${id}/status`, { token: driver.token, body: { status: 'picked_up' } });
    for (let i = 0; i < 50 && (await statusAt(id)) !== 'picked_up'; i++) await new Promise((r) => setTimeout(r, 10));

    await silentFor(id, 10 * 60_000 + 1, { warned: true });
    expect(await watchOf(id)).toMatchObject({ reported: true });
    expect(await row(id).bind(driver.user.id, id).first()).toEqual({ status: 'picked_up', driver_id: driver.user.id, busy: 1 });
    expect(await silentAt(id)).not.toBeNull();
    // Food is with the driver: the customer can't cancel or hand it on.
    expect((await api(`/orders/${id}/cancel`, { token: customer.token, method: 'POST' })).status).toBe(409);
    expect((await api(`/orders/${id}/new-driver`, { token: customer.token, method: 'POST' })).status).toBe(409);
  });

  it('stops watching once the order ends', async () => {
    const { driver, id } = await accepted();
    await env.DB.prepare("UPDATE transactions_pickup SET status = 'cancelled' WHERE id = ?").bind(id).run();
    await runInDurableObject(roomOf(id), (r: OrderRoom) => r.update(id));
    expect(await watchOf(id)).toBeUndefined();
    expect(await row(id).bind(driver.user.id, id).first()).toMatchObject({ status: 'cancelled' });
  });

  const statusAt = async (id: number) => (await env.DB.prepare('SELECT status FROM transactions_pickup WHERE id = ?').bind(id).first<{ status: string }>())!.status;
});
