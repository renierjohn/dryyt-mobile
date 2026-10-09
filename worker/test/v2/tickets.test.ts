import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { consumeTicket } from '../../src/lib/tickets';
import { api, registerUser } from '../helpers';
import { createDropoff, makeDriver, makeShop } from './helpers';

const ticket = (token: string, room: string) => api('/ws/ticket', { token, body: { room } });

describe('websocket tickets', () => {
  it('lets online drivers and searching customers into dispatch', async () => {
    const { storeId, group } = await makeShop();
    const driver = await makeDriver(group);
    const offline = await registerUser('driver');
    const customer = await registerUser('customer');
    const owner = await registerUser('owner');

    expect((await ticket(driver.token, 'dispatch')).status).toBe(200);
    expect((await ticket(offline.token, 'dispatch')).status).toBe(403);
    expect((await ticket(customer.token, 'dispatch')).status).toBe(403);
    expect((await ticket(owner.token, 'dispatch')).status).toBe(403);

    await createDropoff(customer.token, { store_id: storeId });
    expect((await ticket(customer.token, 'dispatch')).status).toBe(200);
  });

  it('refuses unknown trip rooms', async () => {
    const customer = await registerUser('customer');
    expect((await ticket(customer.token, crypto.randomUUID())).status).toBe(403);
  });

  it('is single use, room bound and expires', async () => {
    const { group } = await makeShop();
    const driver = await makeDriver(group);

    const first = (await ticket(driver.token, 'dispatch')).body.ticket;
    expect(await consumeTicket(env.DB, first, 'dispatch')).toEqual({ user_id: driver.user.id, role: 'driver' });
    expect(await consumeTicket(env.DB, first, 'dispatch')).toBeNull();

    const second = (await ticket(driver.token, 'dispatch')).body.ticket;
    expect(await consumeTicket(env.DB, second, 'some-room')).toBeNull();

    const third = (await ticket(driver.token, 'dispatch')).body.ticket;
    expect(await consumeTicket(env.DB, third, 'dispatch', Date.now() + 61_000)).toBeNull();
  });
});
