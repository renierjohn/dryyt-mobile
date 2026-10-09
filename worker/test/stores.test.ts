import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let token: string;

beforeEach(async () => {
  token = (await registerUser('customer')).token;
});

describe('stores', () => {
  it('requires auth', async () => {
    expect((await api('/stores')).status).toBe(401);
  });

  it('lists all stores or filters by type', async () => {
    expect((await api('/stores', { token })).body.stores).toHaveLength(5);

    const food = await api('/stores?type=food', { token });
    expect(food.body.stores).toHaveLength(3);
    expect(food.body.stores.every((s: { type: string }) => s.type === 'food')).toBe(true);

    expect((await api('/stores?type=laundry', { token })).body.stores).toHaveLength(2);
  });

  it('rejects an unknown type', async () => {
    expect((await api('/stores?type=pharmacy', { token })).status).toBe(400);
  });

  it('returns a food store with its menu', async () => {
    const res = await api('/stores/1', { token });
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ id: 1, name: 'Tea Haven', type: 'food' });
    expect(res.body.store.menu).toHaveLength(4);
    expect(res.body.store.menu[0]).toEqual({
      id: 1,
      name: 'Wintermelon Milk Tea',
      price: 12000,
      image_url: null,
      discount_percent: 0,
      category: '',
      best_seller: false,
    });
  });

  it('returns a laundry store with an empty menu', async () => {
    const res = await api('/stores/4', { token });
    expect(res.body.store).toMatchObject({ type: 'laundry', menu: [] });
  });

  it('404s for unknown or non-numeric ids', async () => {
    expect((await api('/stores/999', { token })).status).toBe(404);
    expect((await api('/stores/abc', { token })).status).toBe(404);
  });
});
