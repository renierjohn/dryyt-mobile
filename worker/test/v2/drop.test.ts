import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import type { Trip } from '../../src/do/trip';
import { api, registerUser } from '../helpers';
import { acceptedDropoff, droppedOffDropoff, JPEG, tripKeys, uploadProof } from './helpers';
import { closeAll, openSocket } from './socket';

afterEach(closeAll);

async function atShop() {
  const flow = await acceptedDropoff();
  const room = (await api(`/dropoffs/${flow.id}/confirm-driver`, { token: flow.customer.token, method: 'POST' })).body.dropoff.room_id;
  await api(`/dropoffs/${flow.id}/picked-up`, { token: flow.driver.token, method: 'POST' });
  return { ...flow, room };
}

describe('drop off at the shop', () => {
  it('accepts only a JPEG/PNG proof from the driver once picked up', async () => {
    const early = await acceptedDropoff();
    expect((await uploadProof(early.id, early.driver.token)).status).toBe(409);

    const flow = await atShop();
    expect((await uploadProof(flow.id, flow.customer.token)).status).toBe(403);
    expect((await uploadProof(flow.id, flow.driver.token, new TextEncoder().encode('not an image'), 'image/jpeg')).status).toBe(400);
    // The bytes decide the type, not the header (React Native may send the wrong one).
    expect((await uploadProof(flow.id, flow.driver.token, JPEG, 'application/octet-stream')).status).toBe(201);
    expect((await uploadProof(flow.id, flow.driver.token, new Uint8Array())).status).toBe(400);

    const ok = await uploadProof(flow.id, flow.driver.token);
    expect(ok.status).toBe(201);
    expect(ok.body.key).toMatch(new RegExp(`^proof/${flow.id}/.+\\.jpg$`));
  });

  it('requires an uploaded photo for this drop off', async () => {
    const flow = await atShop();
    const res = await api(`/dropoffs/${flow.id}/drop`, {
      token: flow.driver.token,
      body: { weight_kg: 5, laundry_fee: 20000, proof_photo_key: `proof/${flow.id}/missing.jpg` },
    });
    expect(res.status).toBe(400);
  });

  it('drops off, frees the driver, tells the customer and schedules the owner reminder', async () => {
    const flow = await atShop();
    const customerSock = await openSocket(flow.customer.token, flow.room);
    const { key } = (await uploadProof(flow.id, flow.driver.token)).body;

    const res = await api(`/dropoffs/${flow.id}/drop`, {
      token: flow.driver.token,
      body: { weight_kg: 6.5, laundry_fee: 25000, notes: 'Two bags', proof_photo_key: key },
    });
    expect(res.body.dropoff).toMatchObject({ status: 'dropped_off', laundry_fee: 25000, weight_kg: 6.5, owner_status: 'pending', has_proof: true });
    expect(await customerSock.next('status')).toEqual({ t: 'status', status: 'dropped_off' });
    expect(await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(flow.driver.user.id).first()).toEqual({ busy: 0 });

    const customerView = (await api(`/dropoffs/${flow.id}`, { token: flow.customer.token })).body.dropoff;
    expect(customerView).toMatchObject({ laundry_fee: 25000, drop_notes: 'Two bags' });

    const stub = env.TRIP.get(env.TRIP.idFromName(flow.room));
    const timers = await runInDurableObject(stub, async (_i: Trip, state) => state.storage.get<{ staleAt?: number; ownerAt?: number }>('timers'));
    expect(timers?.staleAt).toBeUndefined();
    expect(timers?.ownerAt).toEqual(expect.any(Number));

    expect((await api(`/dropoffs/${flow.id}/drop`, { token: flow.driver.token, body: { weight_kg: 1, laundry_fee: 1, proof_photo_key: key } })).status).toBe(409);
  });

  it('wipes the trip room once the owner reminder has fired', async () => {
    const { room } = await droppedOffDropoff();
    const stub = env.TRIP.get(env.TRIP.idFromName(room));
    expect(await tripKeys(room)).toContain('transactionId');
    await runInDurableObject(stub, async (_i: Trip, state) => {
      await state.storage.put('timers', { ownerAt: 0 });
    });
    await runDurableObjectAlarm(stub);
    expect(await tripKeys(room)).toEqual([]);
  });

  it('a failed drop leaves the drop off retryable', async () => {
    const flow = await atShop();
    const { key } = (await uploadProof(flow.id, flow.driver.token)).body;
    await env.DB.prepare("INSERT INTO owner_transactions (transaction_id, store_id, weight_kg, laundry_fee, notes, proof_photo_key) VALUES (?, ?, 1, 1, '', 'x')")
      .bind(flow.id, flow.storeId)
      .run();
    const body = { weight_kg: 6.5, laundry_fee: 25000, proof_photo_key: key };

    const failed = await api(`/dropoffs/${flow.id}/drop`, { token: flow.driver.token, body });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await env.DB.prepare('SELECT status FROM transactions WHERE id = ?').bind(flow.id).first()).toEqual({ status: 'en_route_shop' });
    expect(await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(flow.driver.user.id).first()).toEqual({ busy: 1 });

    await env.DB.prepare('DELETE FROM owner_transactions WHERE transaction_id = ?').bind(flow.id).run();
    const retry = await api(`/dropoffs/${flow.id}/drop`, { token: flow.driver.token, body });
    expect(retry.status).toBe(200);
    expect(retry.body.dropoff.status).toBe('dropped_off');
  });

  it('hides the proof from strangers', async () => {
    const flow = await droppedOffDropoff();
    const get = (token: string) => SELF.fetch(`https://api.test/dropoffs/${flow.id}/proof`, { headers: { authorization: `Bearer ${token}` } });

    const mine = await get(flow.customer.token);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(JPEG);

    const stranger = await registerUser('customer');
    expect((await get(stranger.token)).status).toBe(404);
  });
});
