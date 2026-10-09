import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { pushMessages, pushToUsers } from '../../src/lib/push';
import { haversineKm } from '../../src/lib/geo';
import { roadDistanceKm } from '../../src/lib/routing';

const routing = {
  OSRM_URL: 'https://router.project-osrm.org',
  OSRM_USER_AGENT: 'dryyt-test',
  ORS_URL: 'https://api.openrouteservice.org',
  ORS_API_KEY: 'test-ors-key',
};
const shop = { lat: 14.55, lng: 121.02 };

describe('roadDistanceKm', () => {
  it('returns km from OSRM', async () => {
    expect(await roadDistanceKm(routing, { lat: 14.56, lng: 121.03 }, shop)).toBe(3.2);
  });

  it('falls back to OpenRouteService when OSRM has no route', async () => {
    expect(await roadDistanceKm(routing, { lat: 14.56, lng: 1 }, shop)).toBe(2.85);
  });

  it('estimates from the straight line when both services fail', async () => {
    const from = { lat: 14.56, lng: 0 };
    expect(await roadDistanceKm(routing, from, shop)).toBe(Math.round(haversineKm(from, shop) * 130) / 100);
  });

  it('skips OpenRouteService without a key', async () => {
    const from = { lat: 14.56, lng: 1 };
    expect(await roadDistanceKm({ ...routing, ORS_API_KEY: undefined }, from, shop)).toBe(Math.round(haversineKm(from, shop) * 130) / 100);
  });
});

describe('pushMessages', () => {
  it('keeps only Expo tokens and sends high priority', () => {
    expect(pushMessages(['ExponentPushToken[abc]', null, 'garbage'], 'Hi', 'Body', { id: 1 })).toEqual([
      { to: 'ExponentPushToken[abc]', title: 'Hi', body: 'Body', data: { id: 1 }, priority: 'high', channelId: 'default', sound: 'default' },
    ]);
  });

  it('sends new drop offs on their own channel with the Dryyt chime', () => {
    expect(pushMessages(['ExponentPushToken[abc]'], 'Hi', 'Body', undefined, 'newDropoff')[0]).toMatchObject({
      channelId: 'new-dropoff',
      sound: 'dryyt.wav',
    });
  });
});

describe('pushToUsers', () => {
  it('resolves for many unknown user ids without throwing', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => 100000 + i);
    await expect(pushToUsers(env.DB, ids, 'Hi', 'Body')).resolves.toBeUndefined();
  });
});
