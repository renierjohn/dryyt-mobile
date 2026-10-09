/**
 * How a push sounds. `default`: the system sound. `newDropoff`: the Dryyt chime bundled in the app (app.json
 * `expo-notifications.sounds`); Android plays the channel's sound, iOS the `sound` file. Keep in step with the app's
 * channels in use-push-notifications.ts.
 */
export const PUSH_STYLES = {
  default: { channelId: 'default', sound: 'default' },
  newDropoff: { channelId: 'new-dropoff', sound: 'dryyt.wav' },
} as const;
export type PushStyle = keyof typeof PUSH_STYLES;

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: 'high';
  channelId: string;
  sound: string;
};

export function pushMessages(
  tokens: (string | null)[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  style: PushStyle = 'default',
): PushMessage[] {
  return tokens
    .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken['))
    .map((to) => ({ to, title, body, data, priority: 'high', ...PUSH_STYLES[style] }));
}

/** Best effort: a push failure never fails the request that triggered it. */
export async function sendPush(messages: PushMessage[]) {
  for (let i = 0; i < messages.length; i += 100) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    } catch (err) {
      console.error('push failed', err);
    }
  }
}

export async function pushToUsers(
  db: D1Database,
  userIds: number[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  style: PushStyle = 'default',
) {
  if (userIds.length === 0) return;
  try {
    // D1 caps bound parameters per statement at 100, so look tokens up in chunks.
    const tokens: (string | null)[] = [];
    for (let i = 0; i < userIds.length; i += 90) {
      const chunk = userIds.slice(i, i + 90);
      const { results } = await db
        .prepare(`SELECT push_token FROM users WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(...chunk)
        .all<{ push_token: string | null }>();
      tokens.push(...results.map((r) => r.push_token));
    }
    await sendPush(pushMessages(tokens, title, body, data, style));
  } catch (err) {
    console.error('push lookup failed', err);
  }
}
