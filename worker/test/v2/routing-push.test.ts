import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { checkPushReceipts, pushMessages, pushToUsers, sendPush } from '../../src/lib/push';
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

  it("sends owners' new orders and drop offs on their own channel with the order chime", () => {
    expect(pushMessages(['ExponentPushToken[abc]'], 'Hi', 'Body', undefined, 'ownerOrder')[0]).toMatchObject({
      channelId: 'owner-order-v2',
      sound: 'dryytorder.wav',
    });
  });
});

describe('pushToUsers', () => {
  it('resolves for many unknown user ids without throwing', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => 100000 + i);
    await expect(pushToUsers(env, ids, 'Hi', 'Body')).resolves.toBeUndefined();
  });
});

describe('sendPush', () => {
  const messages = (...tokens: string[]) => pushMessages(tokens, 'Hi', 'Body');

  it('returns the tokens Expo no longer delivers to, skipping other ticket errors', async () => {
    const { dead, tickets } = await sendPush(messages('ExponentPushToken[ok]', 'ExponentPushToken[gone]', 'ExponentPushToken[bad]'));
    expect(dead).toEqual(['ExponentPushToken[gone]']);
    expect(tickets.map((t) => t.token)).toEqual(['ExponentPushToken[ok]']);
  });

  it('retries a batch Expo answers 503', async () => {
    expect((await sendPush(messages('ExponentPushToken[flaky]', 'ExponentPushToken[gone]'))).dead).toEqual(['ExponentPushToken[gone]']);
  });
});

const insertUser = (email: string, token: string) =>
  env.DB.prepare("INSERT INTO users (email, password_hash, name, phone, role, push_token) VALUES (?, 'x', 'Push', '0917', 'customer', ?) RETURNING id")
    .bind(email, token)
    .first<{ id: number }>()
    .then((r) => r!.id);

describe('pushToUsers forgetting dead tokens', () => {
  it('clears a token Expo reports as DeviceNotRegistered and keeps the rest', async () => {
    const gone = await insertUser('push-gone@test.dev', 'ExponentPushToken[gone]');
    const ok = await insertUser('push-ok@test.dev', 'ExponentPushToken[ok]');
    await pushToUsers(env, [gone, ok], 'Hi', 'Body');
    const tokens = await env.DB.prepare('SELECT id, push_token FROM users WHERE id IN (?, ?) ORDER BY id').bind(gone, ok).all();
    expect(tokens.results).toEqual([
      { id: gone, push_token: null },
      { id: ok, push_token: 'ExponentPushToken[ok]' },
    ]);
    const tickets = await env.DB.prepare('SELECT token FROM push_tickets WHERE token = ?').bind('ExponentPushToken[ok]').all();
    expect(tickets.results).toHaveLength(1);
  });
});

describe('checkPushReceipts', () => {
  it('forgets tokens FCM/APNs reported unregistered and keeps tickets still waiting on a receipt', async () => {
    const lost = await insertUser('receipt-lost@test.dev', 'ExponentPushToken[lost]');
    const fine = await insertUser('receipt-fine@test.dev', 'ExponentPushToken[fine]');
    const ticket = (id: string, token: string, age: string) =>
      env.DB.prepare("INSERT INTO push_tickets (id, token, created_at) VALUES (?, ?, datetime('now', ?))").bind(id, token, age);
    await env.DB.batch([
      ticket('gone-1', 'ExponentPushToken[lost]', '-20 minutes'),
      ticket('ok-1', 'ExponentPushToken[fine]', '-20 minutes'),
      ticket('pending-1', 'ExponentPushToken[fine]', '-20 minutes'),
      ticket('gone-new', 'ExponentPushToken[fine]', '-1 minutes'),
      ticket('pending-old', 'ExponentPushToken[fine]', '-2 days'),
    ]);

    await checkPushReceipts(env);

    const users = await env.DB.prepare('SELECT id, push_token FROM users WHERE id IN (?, ?) ORDER BY id').bind(lost, fine).all();
    expect(users.results).toEqual([
      { id: lost, push_token: null },
      { id: fine, push_token: 'ExponentPushToken[fine]' },
    ]);
    const left = await env.DB.prepare("SELECT id FROM push_tickets WHERE id IN ('gone-1', 'ok-1', 'pending-1', 'gone-new', 'pending-old') ORDER BY id").all();
    expect(left.results.map((r) => r.id)).toEqual(['gone-new', 'pending-1']);
  });
});
