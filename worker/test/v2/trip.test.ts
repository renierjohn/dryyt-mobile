import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import type { Dispatch } from '../../src/do/dispatch';
import type { Trip } from '../../src/do/trip';
import { api, registerUser } from '../helpers';
import { acceptedDropoff, HOME, tripKeys } from './helpers';
import { closeAll, openSocket } from './socket';

afterEach(closeAll);

const post = (path: string, token: string) => api(path, { token, method: 'POST' });
const busyOf = async (userId: number) => (await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(userId).first())?.busy;

describe('trip', () => {
  it('confirms the driver and hands both sides a room', async () => {
    const { customer, id, driverSock } = await acceptedDropoff();
    const res = await post(`/dropoffs/${id}/confirm-driver`, customer.token);

    expect(res.body.dropoff).toMatchObject({ status: 'en_route_pickup', room_id: expect.any(String) });
    expect(await driverSock.next('confirmed')).toEqual({ t: 'confirmed', transaction_id: id, room_id: res.body.dropoff.room_id });
    expect((await post(`/dropoffs/${id}/confirm-driver`, customer.token)).status).toBe(409);
  });

  it('relays driver location to the customer and replays it on reconnect', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;

    const customerSock = await openSocket(customer.token, room);
    const driverTrip = await openSocket(driver.token, room);
    driverTrip.send({ t: 'loc', lat: HOME.lat + 0.005, lng: HOME.lng });
    expect(await customerSock.next('loc')).toEqual({ t: 'loc', lat: HOME.lat + 0.005, lng: HOME.lng });

    customerSock.close();
    const again = await openSocket(customer.token, room);
    expect(await again.next('loc')).toEqual({ t: 'loc', lat: HOME.lat + 0.005, lng: HOME.lng });
  });

  it('tells the driver whether the customer is online, and lets the driver cancel only while they are not', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;

    const driverTrip = await openSocket(driver.token, room);
    expect(await driverTrip.next('customer')).toEqual({ t: 'customer', online: false });

    const customerSock = await openSocket(customer.token, room);
    expect(await driverTrip.next('customer')).toEqual({ t: 'customer', online: true });
    expect(await post(`/dropoffs/${id}/driver-cancel`, driver.token)).toEqual({
      status: 409,
      body: { error: 'The customer is online; ask them to cancel' },
    });

    // A dropped connection still counts as online for 5 min, so the customer has time to reconnect.
    customerSock.close();
    await expect(driverTrip.next('customer', 30)).rejects.toThrow();
    expect((await post(`/dropoffs/${id}/driver-cancel`, driver.token)).status).toBe(409);

    // Age the last sighting past the grace period instead of waiting 5 min.
    const stub = env.TRIP.get(env.TRIP.idFromName(room));
    await runInDurableObject(stub, async (instance: Trip, state) => {
      await state.storage.put('customerSeenAt', Date.now() - 5 * 60_000 - 1000);
      await instance.checkPresence();
    });
    expect(await driverTrip.next('customer')).toEqual({ t: 'customer', online: false });
    expect((await post(`/dropoffs/${id}/driver-cancel`, customer.token)).status).toBe(403);
    const res = await post(`/dropoffs/${id}/driver-cancel`, driver.token);
    expect(res.body.dropoff.status).toBe('cancelled');
    expect(await driverTrip.next('status')).toEqual({ t: 'status', status: 'cancelled' });
    expect(await busyOf(driver.user.id)).toBe(0);
    expect(await tripKeys(room)).toEqual([]);
    expect((await post(`/dropoffs/${id}/driver-cancel`, driver.token)).status).toBe(409);
  });

  it('counts a customer whose heartbeat stopped as offline', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;
    const driverTrip = await openSocket(driver.token, room);
    await driverTrip.next('customer');
    const customerSock = await openSocket(customer.token, room);
    expect(await driverTrip.next('customer')).toEqual({ t: 'customer', online: true });

    customerSock.send({ t: 'ping' });
    expect(await customerSock.next('pong')).toEqual({ t: 'pong' });

    // 4 min with no heartbeat (signal lost, no close frame): still within the grace period.
    const stub = env.TRIP.get(env.TRIP.idFromName(room));
    await runInDurableObject(stub, (instance: Trip) => instance.checkPresence(Date.now() + 4 * 60_000));
    await expect(driverTrip.next('customer', 30)).rejects.toThrow();

    // Past 5 min: the customer is gone and their dead socket is closed.
    const later = Date.now() + 5 * 60_000 + 1000;
    await runInDurableObject(stub, (instance: Trip) => instance.checkPresence(later));
    expect(await driverTrip.next('customer')).toEqual({ t: 'customer', online: false });
    await runInDurableObject(stub, async (instance: Trip) => expect(await instance.customerOnline(later)).toBe(false));
  });

  it('only the customer and assigned driver can join a trip', async () => {
    const { customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;
    const stranger = await registerUser('customer');
    const otherDriver = await registerUser('driver');

    expect((await api('/ws/ticket', { token: stranger.token, body: { room } })).status).toBe(403);
    expect((await api('/ws/ticket', { token: otherDriver.token, body: { room } })).status).toBe(403);
    expect((await api(`/dropoffs/${id}`, { token: stranger.token })).status).toBe(404);
  });

  it('marks picked up and tells the room', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;
    const customerSock = await openSocket(customer.token, room);

    expect((await post(`/dropoffs/${id}/picked-up`, customer.token)).status).toBe(403);
    const res = await post(`/dropoffs/${id}/picked-up`, driver.token);
    expect(res.body.dropoff.status).toBe('en_route_shop');
    expect(await customerSock.next('status')).toEqual({ t: 'status', status: 'en_route_shop' });
    expect((await post(`/dropoffs/${id}/picked-up`, driver.token)).status).toBe(409);
  });

  it('warns the customer when the driver location goes quiet', async () => {
    const { customer, id } = await acceptedDropoff();
    const room = (await post(`/dropoffs/${id}/confirm-driver`, customer.token)).body.dropoff.room_id;
    const customerSock = await openSocket(customer.token, room);

    const stub = env.TRIP.get(env.TRIP.idFromName(room));
    await runInDurableObject(stub, async (_instance: Trip, state) => {
      await state.storage.put('timers', { staleAt: 0 });
    });
    await runDurableObjectAlarm(stub);
    await customerSock.next('stale');
  });

  it('lets the customer turn the driver down', async () => {
    const { driver, customer, id, driverSock } = await acceptedDropoff();
    const res = await post(`/dropoffs/${id}/reject-driver`, customer.token);

    expect(res.body.dropoff).toMatchObject({ status: 'searching', driver_id: null });
    await driverSock.next('released');
    expect(await busyOf(driver.user.id)).toBe(0);
  });

  it('keeps a turned down driver off the customer for a while', async () => {
    const { group, customer, id, driverSock } = await acceptedDropoff();
    await post(`/dropoffs/${id}/reject-driver`, customer.token);
    await driverSock.next('released');

    driverSock.send({ t: 'accept', transaction_id: id });
    expect(await driverSock.next(['taken', 'accepted'])).toEqual({ t: 'taken', transaction_id: id });

    await runInDurableObject(env.DISPATCH.get(env.DISPATCH.idFromName(group)), (instance: Dispatch) => {
      for (const key of Object.keys(instance['cooldowns'])) instance['cooldowns'][key] = 0;
    });
    driverSock.send({ t: 'accept', transaction_id: id });
    expect(await driverSock.next(['taken', 'accepted'])).toEqual({ t: 'accepted', transaction_id: id });
  });

  it('cancels on the way to pickup but not after', async () => {
    const first = await acceptedDropoff();
    const room = (await post(`/dropoffs/${first.id}/confirm-driver`, first.customer.token)).body.dropoff.room_id;
    const driverTrip = await openSocket(first.driver.token, room);

    const res = await post(`/dropoffs/${first.id}/cancel`, first.customer.token);
    expect(res.body.dropoff.status).toBe('cancelled');
    expect(await driverTrip.next('status')).toEqual({ t: 'status', status: 'cancelled' });
    expect(await busyOf(first.driver.user.id)).toBe(0);

    const second = await acceptedDropoff();
    await post(`/dropoffs/${second.id}/confirm-driver`, second.customer.token);
    await post(`/dropoffs/${second.id}/picked-up`, second.driver.token);
    expect((await post(`/dropoffs/${second.id}/cancel`, second.customer.token)).status).toBe(409);
  });

  describe('races with the dispatch timeout', () => {
    const dispatchOf = (group: string) => env.DISPATCH.get(env.DISPATCH.idFromName(group));
    const dropEntry = (group: string, id: number) =>
      runInDurableObject(dispatchOf(group), (instance: Dispatch) => {
        instance['requests'].delete(id);
      });

    it('confirm reaches the driver even when the request entry is gone', async () => {
      const { group, customer, id, driverSock } = await acceptedDropoff();
      await dropEntry(group, id);
      const res = await post(`/dropoffs/${id}/confirm-driver`, customer.token);
      expect(await driverSock.next('confirmed')).toEqual({ t: 'confirmed', transaction_id: id, room_id: res.body.dropoff.room_id });
    });

    it('reject keeps the drop off searching in dispatch when the entry is gone', async () => {
      const { group, customer, id, driverSock } = await acceptedDropoff();
      await dropEntry(group, id);
      const res = await post(`/dropoffs/${id}/reject-driver`, customer.token);
      expect(res.body.dropoff.status).toBe('searching');
      await driverSock.next('released');
      await runInDurableObject(dispatchOf(group), (instance: Dispatch) => {
        expect(instance['requests'].get(id)?.status).toBe('searching');
      });
    });

    it('cancel reaches the driver even when the request entry is gone', async () => {
      const { group, customer, id, driverSock } = await acceptedDropoff();
      await dropEntry(group, id);
      expect((await post(`/dropoffs/${id}/cancel`, customer.token)).body.dropoff.status).toBe('cancelled');
      expect(await driverSock.next('cancelled')).toEqual({ t: 'cancelled', transaction_id: id });
    });

    it('alarm keeps a drop off searching when a reject already reset it', async () => {
      const { group, id } = await acceptedDropoff();
      await env.DB.prepare("UPDATE transactions_dropoff SET status = 'searching', driver_id = NULL WHERE id = ?").bind(id).run();
      const stub = dispatchOf(group);
      await runInDurableObject(stub, (instance: Dispatch) => {
        instance['requests'].get(id)!.deadline = 0;
      });
      await runDurableObjectAlarm(stub);
      await runInDurableObject(stub, (instance: Dispatch) => {
        const r = instance['requests'].get(id);
        expect(r).toMatchObject({ status: 'searching', driverId: undefined });
        expect(r!.deadline).toBeGreaterThan(Date.now());
      });
    });
  });
});
