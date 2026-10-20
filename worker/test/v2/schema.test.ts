import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { registerUser } from '../helpers';

describe('v2 schema', () => {
  it('registers an owner', async () => {
    const { user } = await registerUser('owner');
    expect(user.role).toBe('owner');
  });

  it('creates a drivers row for new drivers', async () => {
    const { user } = await registerUser('driver');
    const row = await env.DB.prepare('SELECT online, busy, group_id FROM drivers WHERE user_id = ?').bind(user.id).first();
    expect(row).toEqual({ online: 0, busy: 0, group_id: 'default' });
  });

  it('seeds default rates and laundry shop coordinates', async () => {
    const rate = await env.DB.prepare("SELECT base_fee, rate_per_km, commission_pct FROM rates WHERE group_id = 'default' AND type = 'dropoff' AND category = 2").first();
    expect(rate).toEqual({ base_fee: 4000, rate_per_km: 1000, commission_pct: 10 });
    const { results } = await env.DB.prepare("SELECT id FROM stores WHERE type = 'laundry' AND group_id = 'default' AND lat IS NOT NULL ORDER BY id").all();
    expect(results.map((r) => r.id)).toEqual([4, 5]);
  });
});
