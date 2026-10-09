import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api, registerUser } from '../helpers';
import { createDropoff, HOME, makeShop } from './helpers';

describe('drop offs', () => {
  it('prices by road distance and hides the fee split from the customer', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const res = await createDropoff(customer.token, { store_id: storeId });

    expect(res.status).toBe(201);
    expect(res.body.dropoff).toMatchObject({ status: 'searching', road_km: 3.2, total_delivery_fee: 7920, has_proof: false });
    expect(res.body.dropoff).not.toHaveProperty('delivery_fee');
    expect(res.body.dropoff).not.toHaveProperty('service_fee');
    expect(res.body.dropoff).not.toHaveProperty('proof_photo_key');

    const row = await env.DB.prepare('SELECT delivery_fee, service_fee FROM transactions WHERE id = ?').bind(res.body.dropoff.id).first();
    expect(row).toEqual({ delivery_fee: 7200, service_fee: 720 });
  });

  it('saves the pinned coordinates as the address when none is given', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const res = await createDropoff(customer.token, { store_id: storeId, address: undefined });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT customer_address FROM transactions WHERE id = ?').bind(res.body.dropoff.id).first();
    expect(row).toEqual({ customer_address: 'Pinned location 14.56000, 121.03000' });
  });

  it('only accepts laundry shops', async () => {
    const customer = await registerUser('customer');
    expect((await createDropoff(customer.token, { store_id: 1 })).status).toBe(400);
  });

  it('still books when OSRM fails, using the fallback distance', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const res = await createDropoff(customer.token, { store_id: storeId, lng: 1 });
    expect(res.status).toBe(201);
    expect(res.body.dropoff.road_km).toBe(2.85);
  });

  it('allows one active drop off per customer', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    await createDropoff(customer.token, { store_id: storeId });
    expect(await createDropoff(customer.token, { store_id: storeId })).toEqual({
      status: 409,
      body: { error: 'You already have an active drop off' },
    });
  });

  it('shows a drop off only to its customer', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const other = await registerUser('customer');
    const driver = await registerUser('driver');
    const id = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id;

    expect((await api(`/dropoffs/${id}`, { token: customer.token })).status).toBe(200);
    expect((await api(`/dropoffs/${id}`, { token: other.token })).status).toBe(404);
    expect((await api(`/dropoffs/${id}`, { token: driver.token })).status).toBe(404);
    expect((await api('/dropoffs', { token: customer.token })).body.dropoffs.map((d: { id: number }) => d.id)).toEqual([id]);
    expect((await api('/dropoffs', { token: other.token })).body.dropoffs).toEqual([]);
  });

  it('cancels while searching, once', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const id = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id;

    const res = await api(`/dropoffs/${id}/cancel`, { token: customer.token, method: 'POST' });
    expect(res.body.dropoff.status).toBe('cancelled');
    expect((await api(`/dropoffs/${id}/cancel`, { token: customer.token, method: 'POST' })).status).toBe(409);
  });
});
