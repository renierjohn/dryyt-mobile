import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api, placeOrder, registerUser } from '../helpers';
import { acceptedDropoff } from './helpers';
import { closeAll } from './socket';

afterEach(closeAll);

const busyOf = async (userId: number) => (await env.DB.prepare('SELECT busy FROM drivers WHERE user_id = ?').bind(userId).first())?.busy;

async function pickupOrder() {
  const customer = await registerUser('customer');
  const res = await placeOrder({
    token: customer.token,
    body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' },
  });
  return res.body.order.id as number;
}

describe('drivers', () => {
  it('toggles online and reports no job', async () => {
    const driver = await registerUser('driver');
    expect((await api('/drivers/me', { token: driver.token })).body).toEqual({ driver: { online: false, busy: false }, job: null });
    expect((await api('/drivers/me/online', { token: driver.token, body: { online: true } })).body).toEqual({ online: true });
    expect((await api('/drivers/me', { token: driver.token })).body.driver.online).toBe(true);
  });

  it('reports the active drop off with the fee split', async () => {
    const { driver, id } = await acceptedDropoff();
    const { body } = await api('/drivers/me', { token: driver.token });
    expect(body.driver.busy).toBe(true);
    expect(body.job).toMatchObject({ id, status: 'driver_accepted', delivery_fee: 7200, customer_phone: expect.any(String) });
  });

  it('prefers the active drop off over an older finished one', async () => {
    const { driver, id } = await acceptedDropoff();
    const other = await acceptedDropoff();
    // Lower id is active, higher id is already dropped off; both belong to this driver.
    await env.DB.prepare("UPDATE transactions SET status = 'en_route_pickup' WHERE id = ?").bind(id).run();
    await env.DB.prepare("UPDATE transactions SET status = 'dropped_off', driver_id = ? WHERE id = ?").bind(driver.user.id, other.id).run();
    const { body } = await api('/drivers/me', { token: driver.token });
    expect(body.job).toMatchObject({ id, status: 'en_route_pickup' });
  });

  it('keeps one active job across pickup orders and drop offs', async () => {
    const { driver } = await acceptedDropoff();
    const orderId = await pickupOrder();
    expect(await api(`/jobs/${orderId}/accept`, { token: driver.token, method: 'POST' })).toEqual({
      status: 409,
      body: { error: 'Finish your active job first' },
    });
  });

  it('marks v1 drivers busy until delivered or released', async () => {
    const driver = await registerUser('driver');
    const first = await pickupOrder();
    await api(`/jobs/${first}/accept`, { token: driver.token, method: 'POST' });
    expect(await busyOf(driver.user.id)).toBe(1);
    await api(`/jobs/${first}/release`, { token: driver.token, method: 'POST' });
    expect(await busyOf(driver.user.id)).toBe(0);

    const second = await pickupOrder();
    await api(`/jobs/${second}/accept`, { token: driver.token, method: 'POST' });
    await api(`/jobs/${second}/status`, { token: driver.token, body: { status: 'picked_up' } });
    await api(`/jobs/${second}/status`, { token: driver.token, body: { status: 'delivered' } });
    expect(await busyOf(driver.user.id)).toBe(0);
  });

  it('saves Expo push tokens only', async () => {
    const owner = await registerUser('owner');
    expect((await api('/me/push-token', { token: owner.token, body: { token: 'ExponentPushToken[xyz]' } })).body).toEqual({ ok: true });
    expect(await env.DB.prepare('SELECT push_token FROM users WHERE id = ?').bind(owner.user.id).first()).toEqual({ push_token: 'ExponentPushToken[xyz]' });
    expect((await api('/me/push-token', { token: owner.token, body: { token: 'nope' } })).status).toBe(400);
  });

  it('accepts push registration failure reports from the app', async () => {
    const driver = await registerUser('driver');
    const report = (body: unknown) => api('/me/push-token/error', { token: driver.token, body });
    expect((await report({ step: 'permission', error: 'denied', platform: 'android' })).body).toEqual({ ok: true });
    expect((await report({ step: 'nope', error: 'x' })).status).toBe(400);
    expect((await api('/me/push-token/error', { body: { step: 'save', error: 'x' } })).status).toBe(401);
  });

  it('keeps a push token on one account only, and clears it on sign out', async () => {
    const customer = await registerUser('customer');
    const driver = await registerUser('driver');
    const tokenOf = async (id: number) => (await env.DB.prepare('SELECT push_token FROM users WHERE id = ?').bind(id).first())?.push_token;
    const phone = 'ExponentPushToken[same-phone]';

    await api('/me/push-token', { token: customer.token, body: { token: phone } });
    await api('/me/push-token', { token: driver.token, body: { token: phone } });
    expect(await tokenOf(customer.user.id)).toBeNull();
    expect(await tokenOf(driver.user.id)).toBe(phone);

    expect((await api('/me/push-token', { token: driver.token, method: 'DELETE' })).body).toEqual({ ok: true });
    expect(await tokenOf(driver.user.id)).toBeNull();
  });
});
