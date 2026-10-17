import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api, registerUser } from '../helpers';
import { closeAll, openSocket } from './socket';

afterEach(closeAll);

const order = { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' };

async function pickupDriver() {
  const driver = await registerUser('driver');
  await api('/drivers/me/pickup-online', { token: driver.token, body: { online: true } });
  return driver;
}

/** Placed by the customer: awaiting payment → confirmed → placed (pending), like the app does. */
async function placed(customerToken: string) {
  const id = (await api('/orders', { token: customerToken, body: { ...order, payment_ref: 'GC-1' } })).body.order.id as number;
  await env.DB.prepare("UPDATE orders SET status = 'payment_confirmed' WHERE id = ?").bind(id).run();
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
  it('opens for the customer at Place order and for the driver once they accept', async () => {
    const customer = await registerUser('customer');
    const driver = await pickupDriver();
    const id = await placed(customer.token);
    const ticket = (token: string) => api('/ws/ticket', { token, body: { room: `order-${id}` } });

    expect((await ticket(customer.token)).status).toBe(403);
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
