import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, placeOrder, registerUser } from './helpers';

const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

const shop = {
  name: 'Suds Laundry',
  type: 'laundry',
  address: '1 Main St',
  lat: 14.55,
  lng: 121.02,
};

let token: string;

beforeEach(async () => {
  token = (await registerUser('owner')).token;
});

describe('owner stores', () => {
  it('is owner only', async () => {
    const customer = (await registerUser('customer')).token;
    expect((await api('/owner/stores', { token: customer })).status).toBe(403);
  });

  it('creates, lists, updates and deletes own shops', async () => {
    expect((await api('/owner/stores', { token })).body.stores).toEqual([]);

    const created = await api('/owner/stores', { token, body: shop });
    expect(created.status).toBe(201);
    const id = created.body.store.id;
    expect(created.body.store).toMatchObject(shop);

    const updated = await api(`/owner/stores/${id}`, {
      token,
      body: { ...shop, name: 'Suds 2', lat: null, lng: null },
    });
    expect(updated.body.store).toMatchObject({ id, name: 'Suds 2', lat: null });
    expect((await api('/owner/stores', { token })).body.stores).toHaveLength(1);

    expect((await api(`/owner/stores/${id}`, { token, method: 'DELETE' })).status).toBe(200);
    expect((await api('/owner/stores', { token })).body.stores).toEqual([]);
  });

  it('limits shops to the owner\'s maxstore', async () => {
    const owner = await registerUser('owner');
    const t = owner.token;
    expect((await api('/owner/stores', { token: t })).body.maxstore).toBe(1);
    expect((await api('/owner/stores', { token: t, body: shop })).status).toBe(201);
    const over = await api('/owner/stores', { token: t, body: shop });
    expect(over.status).toBe(409);
    expect(over.body).toEqual({ error: 'Shop limit reached' });

    await env.DB.prepare('UPDATE users SET maxstore = 2 WHERE id = ?').bind(owner.user.id).run();
    expect((await api('/owner/stores', { token: t })).body.maxstore).toBe(2);
    expect((await api('/owner/stores', { token: t, body: shop })).status).toBe(201);
  });

  it('rejects invalid input', async () => {
    expect((await api('/owner/stores', { token, body: { ...shop, name: ' ' } })).status).toBe(400);
    expect(
      (
        await api('/owner/stores', {
          token,
          body: { ...shop, type: 'pharmacy' },
        })
      ).status,
    ).toBe(400);
  });

  it("404s on someone else's shop", async () => {
    const other = (await registerUser('owner')).token;
    const id = (await api('/owner/stores', { token: other, body: shop })).body.store.id;
    expect((await api(`/owner/stores/${id}`, { token, body: shop })).status).toBe(404);
    expect((await api(`/owner/stores/${id}`, { token, method: 'DELETE' })).status).toBe(404);
  });

  it('refuses to delete a shop with history', async () => {
    const id = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;
    const customer = await registerUser('customer');
    await env.DB.prepare(
      "INSERT INTO transactions_pickup (type, customer_id, store_id, customer_address, items_total, delivery_fee) VALUES ('pickup', ?, ?, 'x', 0, 0)",
    )
      .bind(customer.user.id, id)
      .run();
    expect((await api(`/owner/stores/${id}`, { token, method: 'DELETE' })).status).toBe(409);
  });

  it('saves a logo and up to 3 payment QRs, and drops images no longer used', async () => {
    const upload = async () => {
      const res = await SELF.fetch('https://api.test/owner/stores/image', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
        body: JPEG,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { image_url: string }).image_url;
    };
    /** Reads the body too, so R2 isn't left open between tests. */
    const served = async (url: string) => {
      const res = await SELF.fetch(url);
      await res.arrayBuffer();
      return res.status;
    };
    const logo = await upload();
    expect(logo).toMatch(/^https:\/\/api\.test\/store-images\/\d+\/[\w-]+\.jpg$/);
    expect(await served(logo)).toBe(200);
    const gcash = { label: 'GCash 0917 123 4567', image_url: await upload() };
    const maya = { label: 'Maya', image_url: await upload() };

    const created = await api('/owner/stores', { token, body: { ...shop, store_logo: logo, store_payment_gateway: [gcash, maya] } });
    expect(created.status).toBe(201);
    const id = created.body.store.id;
    expect(created.body.store).toMatchObject({ store_logo: logo, store_payment_gateway: [gcash, maya] });
    expect((await api(`/stores/${id}`, { token })).body.store.store_payment_gateway).toEqual([gcash, maya]);

    const tooMany = Array(4).fill(gcash);
    expect((await api(`/owner/stores/${id}`, { token, body: { ...shop, store_payment_gateway: tooMany } })).status).toBe(400);
    const noLabel = [{ label: ' ', image_url: gcash.image_url }];
    expect((await api(`/owner/stores/${id}`, { token, body: { ...shop, store_payment_gateway: noLabel } })).status).toBe(400);

    const updated = await api(`/owner/stores/${id}`, { token, body: { ...shop, store_logo: null, store_payment_gateway: [gcash] } });
    expect(updated.body.store).toMatchObject({ store_logo: null, store_payment_gateway: [gcash] });
    // The R2 deletes run in waitUntil, after the response.
    await vi.waitFor(async () => expect(await served(logo)).toBe(404));
    await vi.waitFor(async () => expect(await served(maya.image_url)).toBe(404));
    expect(await served(gcash.image_url)).toBe(200);

    await api(`/owner/stores/${id}`, { token, method: 'DELETE' });
    await vi.waitFor(async () => expect(await served(gcash.image_url)).toBe(404));
  });

  it('defaults to no logo or payment QRs', async () => {
    const { store } = (await api('/owner/stores', { token, body: shop })).body;
    expect(store).toMatchObject({ store_logo: null, store_payment_gateway: [] });
  });
});

describe('owner menu', () => {
  const item = {
    name: 'Adobo',
    price: 15000,
    image_url: 'https://img.test/adobo.jpg',
    discount_percent: 20,
    category: 'Mains',
    best_seller: true,
  };

  it('adds, updates and deletes items on a food shop', async () => {
    const storeId = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;

    const created = await api(`/owner/stores/${storeId}/menu`, {
      token,
      body: item,
    });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject(item);
    const itemId = created.body.item.id;

    const updated = await api(`/owner/stores/${storeId}/menu/${itemId}`, {
      token,
      body: { ...item, best_seller: false, image_url: null },
    });
    expect(updated.body.item).toMatchObject({
      id: itemId,
      best_seller: false,
      image_url: null,
    });

    const menu = (await api(`/stores/${storeId}`, { token })).body.store.menu;
    expect(menu).toEqual([{ ...item, id: itemId, best_seller: false, image_url: null, popularity: 0 }]);

    expect(
      (
        await api(`/owner/stores/${storeId}/menu/${itemId}`, {
          token,
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect((await api(`/stores/${storeId}`, { token })).body.store.menu).toEqual([]);
  });

  it('charges the discounted price', async () => {
    const storeId = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;
    const itemId = (await api(`/owner/stores/${storeId}/menu`, { token, body: item })).body.item.id;
    const customer = (await registerUser('customer')).token;
    const order = await placeOrder({
      token: customer,
      body: {
        type: 'pickup',
        store_id: storeId,
        items: [{ menu_item_id: itemId, qty: 2 }],
        customer_address: '123 Some Street',
      },
    });
    expect(order.status).toBe(201);
    expect(order.body.order.items_total).toBe(24000);
  });

  it('rejects laundry shops, bad input and other owners', async () => {
    const { id: ownerId } = (await api('/me', { token })).body.user;
    await env.DB.prepare('UPDATE users SET maxstore = 2 WHERE id = ?').bind(ownerId).run();
    const laundry = (await api('/owner/stores', { token, body: shop })).body.store.id;
    expect((await api(`/owner/stores/${laundry}/menu`, { token, body: item })).status).toBe(409);

    const food = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;
    expect(
      (
        await api(`/owner/stores/${food}/menu`, {
          token,
          body: { ...item, discount_percent: 101 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(`/owner/stores/${food}/menu`, {
          token,
          body: { ...item, image_url: 'not a url' },
        })
      ).status,
    ).toBe(400);

    const other = (await registerUser('owner')).token;
    expect((await api(`/owner/stores/${food}/menu`, { token: other, body: item })).status).toBe(404);
  });

  it('reorders the menu', async () => {
    const storeId = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;
    const ids: number[] = [];
    for (const name of ['A', 'B', 'C'])
      ids.push(
        (
          await api(`/owner/stores/${storeId}/menu`, {
            token,
            body: { ...item, name },
          })
        ).body.item.id,
      );
    const names = async () => (await api(`/stores/${storeId}`, { token })).body.store.menu.map((m: { name: string }) => m.name);
    expect(await names()).toEqual(['A', 'B', 'C']);

    const res = await api(`/owner/stores/${storeId}/menu/order`, {
      token,
      body: { ids: [ids[2], ids[0], ids[1]] },
    });
    expect(res.status).toBe(200);
    expect(await names()).toEqual(['C', 'A', 'B']);

    // New items go last.
    await api(`/owner/stores/${storeId}/menu`, {
      token,
      body: { ...item, name: 'D' },
    });
    expect(await names()).toEqual(['C', 'A', 'B', 'D']);

    // Missing, duplicated or foreign ids are refused.
    expect(
      (
        await api(`/owner/stores/${storeId}/menu/order`, {
          token,
          body: { ids },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(`/owner/stores/${storeId}/menu/order`, {
          token,
          body: { ids: [ids[0], ids[0], ids[1], ids[2]] },
        })
      ).status,
    ).toBe(409);
  });

  it('uploads a photo, serves it publicly and deletes it with the item', async () => {
    const storeId = (await api('/owner/stores', { token, body: { ...shop, type: 'food' } })).body.store.id;
    const upload = (body: Uint8Array<ArrayBuffer>) =>
      SELF.fetch(`https://api.test/owner/stores/${storeId}/menu/image`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
        body,
      });

    expect((await upload(new Uint8Array([1, 2, 3, 4]))).status).toBe(400);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(JPEG);
    const tooBig = await upload(big);
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: 'Photo must be under 1 MB' });
    const res = await upload(JPEG);
    expect(res.status).toBe(201);
    const { image_url } = (await res.json()) as { image_url: string };
    expect(image_url).toMatch(new RegExp(`^https://api\\.test/menu-images/${storeId}/[\\w-]+\\.jpg$`));

    const photo = await SELF.fetch(image_url);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);

    const itemId = (await api(`/owner/stores/${storeId}/menu`, { token, body: { ...item, image_url } })).body.item.id;
    await api(`/owner/stores/${storeId}/menu/${itemId}`, { token, method: 'DELETE' });
    // The R2 delete runs in waitUntil, after the response.
    await vi.waitFor(async () => expect((await SELF.fetch(image_url)).status).toBe(404));
  });
});
