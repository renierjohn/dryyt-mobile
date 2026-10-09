import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from './helpers';

describe('health', () => {
  it('responds ok', async () => {
    const res = await api('/health');
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await api('/nope');
    expect(res).toEqual({ status: 404, body: { error: 'Not found' } });
  });

  it('has seeded stores and menu items', async () => {
    const stores = await env.DB.prepare('SELECT COUNT(*) AS n FROM stores').first<{ n: number }>();
    const items = await env.DB.prepare('SELECT COUNT(*) AS n FROM store_menu_items').first<{ n: number }>();
    expect(stores?.n).toBe(5);
    expect(items?.n).toBe(12);
  });
});
