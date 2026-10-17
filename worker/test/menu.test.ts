import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let token: string;

beforeEach(async () => {
  token = (await registerUser('customer')).token;
});

describe('popular menu', () => {
  it('requires auth', async () => {
    expect((await api('/menu/popular')).status).toBe(401);
  });

  it('sorts by popularity, then best seller, then newest; food only', async () => {
    await env.DB.batch([
      env.DB.prepare('UPDATE store_menu_items SET popularity = 5 WHERE id = 6'),
      env.DB.prepare('UPDATE store_menu_items SET popularity = 3 WHERE id = 2'),
      env.DB.prepare('UPDATE store_menu_items SET best_seller = 1 WHERE id = 9'),
      env.DB.prepare("INSERT INTO store_menu_items (store_id, name, price, popularity) VALUES (4, 'Wash & Fold', 9000, 99)"),
    ]);

    const res = await api('/menu/popular', { token });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([6, 2, 9, 12]);
    expect(res.body.items[0]).toMatchObject({ name: 'Cheeseburger', popularity: 5, best_seller: false, store_id: 2, store_name: 'Burger Barn', store_logo: null });
    expect(res.body.items[2].best_seller).toBe(true);
  });

  it('honours limit and rejects bad ones', async () => {
    expect((await api('/menu/popular?limit=10', { token })).body.items).toHaveLength(10);
    for (const bad of ['0', '51', 'abc', '2.5']) expect((await api(`/menu/popular?limit=${bad}`, { token })).status).toBe(400);
  });
});
