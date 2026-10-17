import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import type { Dispatch } from '../../src/do/dispatch';
import { api, registerUser } from '../helpers';
import { createDropoff, HOME, makeDriver, makeShop } from './helpers';
import { closeAll, openSocket } from './socket';

afterEach(closeAll);

const near = { lat: HOME.lat + 0.01, lng: HOME.lng }; // ~1.1 km
const mid = { lat: HOME.lat + 0.13, lng: HOME.lng }; // ~14.5 km
const far = { lat: HOME.lat + 0.25, lng: HOME.lng }; // ~28 km

async function searching() {
  const { storeId, group } = await makeShop();
  const customer = await registerUser('customer');
  const id = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id as number;
  return { storeId, group, customer, id, stub: env.DISPATCH.get(env.DISPATCH.idFromName(group)) };
}

async function onlineDriver(group: string, at: { lat: number; lng: number }) {
  const driver = await makeDriver(group);
  const sock = await openSocket(driver.token, 'dispatch');
  sock.send({ t: 'loc', ...at });
  return { driver, sock, requests: (await sock.next('requests')).items };
}

const status = async (id: number) =>
  (await env.DB.prepare('SELECT status, driver_id FROM transactions WHERE id = ?').bind(id).first()) as { status: string; driver_id: number | null };

describe('dispatch', () => {
  it('rejects an upgrade without a valid ticket', async () => {
    const res = await SELF.fetch('https://api.test/ws/dispatch?ticket=nope', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(401);
  });

  it('matches drivers within 20 km, coloured by distance, without identities', async () => {
    const { group, customer, id } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    expect((await customerSock.next('drivers')).items).toEqual([]);

    const a = await onlineDriver(group, near);
    expect(a.requests).toEqual([
      expect.objectContaining({
        transaction_id: id,
        colour: 'green',
        delivery_fee: 7200,
        total_delivery_fee: 8000,
        customer_name: customer.user.name.split(' ')[0],
        customer_phone: `${customer.user.phone.slice(0, 4)}•••${customer.user.phone.slice(-4)}`,
      }),
    ]);
    expect((await customerSock.next('drivers')).items).toEqual([{ ...near, colour: 'green' }]);

    await onlineDriver(group, mid);
    expect((await customerSock.next('drivers')).items).toEqual([
      { ...near, colour: 'green' },
      { ...mid, colour: 'amber' },
    ]);

    const c = await onlineDriver(group, far);
    expect(c.requests).toEqual([]);
  });

  it('hides the request from drivers blocked by the shop', async () => {
    const { storeId, group } = await makeShop();
    const blocked = await makeDriver(group);
    await env.DB.prepare('INSERT INTO driver_blocks (store_id, driver_id) VALUES (?, ?)').bind(storeId, blocked.user.id).run();
    const customer = await registerUser('customer');
    await createDropoff(customer.token, { store_id: storeId });

    const sock = await openSocket(blocked.token, 'dispatch');
    sock.send({ t: 'loc', ...near });
    expect((await sock.next('requests')).items).toEqual([]);
  });

  it('lets only one of two drivers accept', async () => {
    const { group, customer, id } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    const a = await onlineDriver(group, near);
    const b = await onlineDriver(group, near);

    a.sock.send({ t: 'accept', transaction_id: id });
    b.sock.send({ t: 'accept', transaction_id: id });
    const results = [(await a.sock.next(['accepted', 'taken'])).t, (await b.sock.next(['accepted', 'taken'])).t].sort();
    expect(results).toEqual(['accepted', 'taken']);

    const msg = await customerSock.next('driver_accepted');
    expect(msg).toMatchObject({ transaction_id: id, total_delivery_fee: 8000, driver: { name: expect.any(String), phone: expect.any(String) } });
    expect((await status(id)).status).toBe('driver_accepted');
    const { results: busy } = await env.DB.prepare('SELECT busy FROM drivers WHERE user_id IN (?, ?) ORDER BY busy').bind(a.driver.user.id, b.driver.user.id).all();
    expect(busy.map((r) => r.busy)).toEqual([0, 1]);
  });

  it('cancel racing an accept leaves the driver free', async () => {
    const { group, customer, id } = await searching();
    const a = await onlineDriver(group, near);

    a.sock.send({ t: 'accept', transaction_id: id });
    await api(`/dropoffs/${id}/cancel`, { token: customer.token, method: 'POST' });
    await a.sock.next(['accepted', 'taken', 'cancelled']);

    // Whichever won, the drop off ends cancelled (cancel is allowed from driver_accepted) and the driver is free.
    await new Promise((r) => setTimeout(r, 50));
    expect((await status(id)).status).toBe('cancelled');
    expect(await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(a.driver.user.id).first()).toEqual({ busy: 0 });
  });

  it('expires a search nobody accepts', async () => {
    const { customer, id, stub } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    await runInDurableObject(stub, (instance: Dispatch) => {
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await customerSock.next('expired');
    expect((await status(id)).status).toBe('expired');
  });

  it('returns an unconfirmed driver to the pool after the confirm timeout', async () => {
    const { group, customer, id, stub } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    const a = await onlineDriver(group, near);
    a.sock.send({ t: 'accept', transaction_id: id });
    await a.sock.next('accepted');

    await runInDurableObject(stub, (instance: Dispatch) => {
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await a.sock.next('released');
    await customerSock.next('searching');
    expect(await status(id)).toEqual({ status: 'searching', driver_id: null });
    expect(await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(a.driver.user.id).first()).toEqual({ busy: 0 });
  });

  it('search expiry does not undo an accept that won in D1', async () => {
    const { group, customer, id, stub } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    const a = await onlineDriver(group, near);
    await env.DB.prepare("UPDATE transactions SET status = 'driver_accepted', driver_id = ? WHERE id = ?").bind(a.driver.user.id, id).run();
    await env.DB.prepare('UPDATE drivers SET busy = 1 WHERE user_id = ?').bind(a.driver.user.id).run();
    await runInDurableObject(stub, (instance: Dispatch) => {
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await expect(customerSock.next('expired', 20)).rejects.toThrow();
    expect((await status(id)).status).toBe('driver_accepted');
    await runInDurableObject(stub, (instance: Dispatch) => {
      expect(instance['requests'].has(id)).toBe(true);
      expect(instance['requests'].get(id)!.deadline).toBeGreaterThan(Date.now());
    });
  });

  it('search expiry turns an accept that won in D1 but never reached memory into a hold that can time out', async () => {
    const { group, customer, id, stub } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    const a = await onlineDriver(group, near);
    // Accept won in D1, then the DO lost it before storing the hold: memory still says searching.
    await env.DB.prepare("UPDATE transactions SET status = 'driver_accepted', driver_id = ? WHERE id = ?").bind(a.driver.user.id, id).run();
    await env.DB.prepare('UPDATE drivers SET busy = 1 WHERE user_id = ?').bind(a.driver.user.id).run();
    await runInDurableObject(stub, (instance: Dispatch) => {
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await customerSock.next('driver_accepted');
    await runInDurableObject(stub, (instance: Dispatch) => {
      expect(instance['requests'].get(id)).toMatchObject({ status: 'driver_accepted', driverId: a.driver.user.id });
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await a.sock.next('released');
    expect(await status(id)).toEqual({ status: 'searching', driver_id: null });
    expect(await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(a.driver.user.id).first()).toEqual({ busy: 0 });
  });

  it('tells a driver with no location yet to wait instead of taken', async () => {
    const { group, id } = await searching();
    const driver = await makeDriver(group);
    const sock = await openSocket(driver.token, 'dispatch');
    sock.send({ t: 'accept', transaction_id: id });
    expect(await sock.next(['error', 'taken'])).toEqual({ t: 'error', message: 'Waiting for your location, try again in a moment' });
  });

  it('expiry drops a request that was cancelled elsewhere', async () => {
    const { customer, id, stub } = await searching();
    const customerSock = await openSocket(customer.token, 'dispatch');
    await env.DB.prepare("UPDATE transactions SET status = 'cancelled' WHERE id = ?").bind(id).run();
    await runInDurableObject(stub, (instance: Dispatch) => {
      for (const r of instance['requests'].values()) r.deadline = 0;
    });
    await runDurableObjectAlarm(stub);

    await expect(customerSock.next('expired', 20)).rejects.toThrow();
    await runInDurableObject(stub, (instance: Dispatch) => {
      expect(instance['requests'].has(id)).toBe(false);
    });
  });

  it('rebuilds the driver index after hibernation', async () => {
    const { storeId, group } = await makeShop();
    const a = await onlineDriver(group, near);
    const stub = env.DISPATCH.get(env.DISPATCH.idFromName(group));
    await runInDurableObject(stub, (instance: Dispatch) => {
      instance['cells'] = null; // what a wake-up from hibernation looks like
    });

    const customer = await registerUser('customer');
    const id = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id;
    expect((await a.sock.next('requests')).items).toEqual([expect.objectContaining({ transaction_id: id })]);
  });
});
