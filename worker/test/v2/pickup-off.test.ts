import { createExecutionContext, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import app from '../../src/index';
import { api, registerUser } from '../helpers';

/** The worker with PICKUP_ENABLED off, as in wrangler.jsonc (the test pool turns it on for the Pickup suites). */
async function offline(path: string, token: string, init: RequestInit = {}) {
  const res = await app.request(
    `https://api.test${path}`,
    { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } },
    { ...env, PICKUP_ENABLED: 'false' },
    createExecutionContext(),
  );
  return { status: res.status, body: (await res.json()) as { error?: string; items?: { kind: string }[] } };
}

describe('Pickup switched off', () => {
  it('refuses every Pickup route', async () => {
    const customer = await registerUser('customer');
    const driver = await registerUser('driver');
    const off = { status: 403, body: { error: 'Pickup is not available yet' } };

    expect(await offline('/orders', customer.token, { method: 'POST', body: '{}' })).toEqual(off);
    expect(await offline('/orders/1', customer.token)).toEqual(off);
    expect(await offline('/jobs/available', driver.token)).toEqual(off);
    expect(await offline('/menu/popular', customer.token)).toEqual(off);
    expect(await offline('/jobs/active', driver.token)).toEqual(off);
    expect(await offline('/jobs/1/accept', driver.token, { method: 'POST' })).toEqual(off);
  });

  it('leaves Pickup orders out of history', async () => {
    const customer = await registerUser('customer');
    // Placed while Pickup was on (the pool default).
    await api('/orders', {
      token: customer.token,
      body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' },
    });
    expect((await api('/history', { token: customer.token })).body.items).toHaveLength(1);
    expect((await offline('/history', customer.token)).body.items).toEqual([]);
  });
});
