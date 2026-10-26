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
    expect(res.body.dropoff).toMatchObject({ status: 'searching', road_km: 3.2, total_delivery_fee: 8000, has_proof: false });
    expect(res.body.dropoff).not.toHaveProperty('delivery_fee');
    expect(res.body.dropoff).not.toHaveProperty('service_fee');
    expect(res.body.dropoff).not.toHaveProperty('proof_photo_key');

    const row = await env.DB.prepare('SELECT delivery_fee, service_fee FROM transactions_dropoff WHERE id = ?').bind(res.body.dropoff.id).first();
    expect(row).toEqual({ delivery_fee: 7200, service_fee: 800 });
  });

  it('quotes every vehicle the area has a rate for and books at the chosen one', async () => {
    const { storeId, group } = await makeShop();
    await env.DB.prepare("INSERT INTO rates (group_id, type, category, base_fee, rate_per_km, commission_pct) VALUES (?, 'dropoff', 3, 6000, 1500, 10)")
      .bind(group)
      .run();
    const customer = await registerUser('customer');
    const quote = await api('/dropoffs/quote', { token: customer.token, body: { store_id: storeId, ...HOME } });
    // Tricycle: 60 + 3.2 km × 15 = 108, + 10% = 118.80, rounded up to 119.
    expect(quote.body.quote).toEqual({
      road_km: 3.2,
      options: [
        { vehicle_type: 2, base_fee: 4000, rate_per_km: 1000, total_delivery_fee: 8000 },
        { vehicle_type: 3, base_fee: 6000, rate_per_km: 1500, total_delivery_fee: 11900 },
      ],
      token: expect.any(String),
    });

    expect((await createDropoff(customer.token, { store_id: storeId, vehicle_type: 4, quote_token: quote.body.quote.token })).status).toBe(400);
    const res = await createDropoff(customer.token, { store_id: storeId, vehicle_type: 3, quote_token: quote.body.quote.token });
    expect(res.body.dropoff).toMatchObject({ vehicle_type: 3, total_delivery_fee: 11900 });
  });

  it('saves the pinned coordinates as the address when none is given', async () => {
    const { storeId } = await makeShop();
    const customer = await registerUser('customer');
    const res = await createDropoff(customer.token, { store_id: storeId, address: undefined });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT customer_address FROM transactions_dropoff WHERE id = ?').bind(res.body.dropoff.id).first();
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
