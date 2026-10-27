import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let token: string;

beforeEach(async () => {
  token = (await registerUser('customer')).token;
});

describe('popular menu', () => {
  it('is public, for guests on the home screen', async () => {
    expect((await api('/menu/popular')).status).toBe(200);
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

  it('searches names case-insensitively and filters by category', async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE store_menu_items SET category = 'Milk Tea' WHERE id IN (1, 2, 3)"),
      env.DB.prepare("UPDATE store_menu_items SET category = 'Burgers' WHERE id IN (5, 6)"),
      env.DB.prepare("INSERT INTO store_menu_items (store_id, name, price, category) VALUES (4, 'Milk Tea Stain Wash', 9000, 'Laundry')"),
    ]);
    const ids = async (query: string) =>
      (await api(`/menu/popular?limit=50&${query}`, { token })).body.items.map((i: { id: number }) => i.id).sort((a: number, b: number) => a - b);

    expect(await ids('q=MILK%20tea')).toEqual([1, 2, 3]);
    expect(await ids('q=%20burger%20')).toEqual([5, 6]);
    expect(await ids('q=pizza')).toEqual([]);
    expect(await ids('category=Burgers')).toEqual([5, 6]);
    expect(await ids('category=Burgers&q=cheese')).toEqual([6]);
  });

  it('lists food categories A-Z regardless of the filters', async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE store_menu_items SET category = 'Milk Tea' WHERE id = 1"),
      env.DB.prepare("UPDATE store_menu_items SET category = 'Burgers' WHERE id IN (5, 6)"),
      env.DB.prepare("INSERT INTO store_menu_items (store_id, name, price, category) VALUES (4, 'Wash & Fold', 9000, 'Laundry')"),
    ]);
    const expected = ['Burgers', 'Milk Tea'];
    expect((await api('/menu/popular', { token })).body.categories).toEqual(expected);
    expect((await api('/menu/popular?q=pizza&category=Burgers', { token })).body.categories).toEqual(expected);
  });

  it('rejects an overlong search', async () => {
    expect((await api(`/menu/popular?q=${'a'.repeat(51)}`, { token })).status).toBe(400);
  });
});
