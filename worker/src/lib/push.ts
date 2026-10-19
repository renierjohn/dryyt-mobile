/**
 * How a push sounds. `default`: the system sound. `newDropoff`: the Dryyt chime, `ownerOrder`: the owner's order
 * chime, both bundled in the app (app.json `expo-notifications.sounds`); Android plays the channel's sound, iOS the
 * `sound` file. Keep in step with the app's channels in use-push-notifications.ts.
 */
export const PUSH_STYLES = {
  default: { channelId: 'default', sound: 'default' },
  newDropoff: { channelId: 'new-dropoff', sound: 'dryyt.wav' },
  ownerOrder: { channelId: 'owner-order-v2', sound: 'dryytorder.wav' },
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

/** Enough of a push token to tell devices apart in logs without exposing it. */
export const maskToken = (token: unknown) =>
  typeof token === 'string' && token.length > 12 ? `${token.slice(0, 22)}…${token.slice(-4)}` : JSON.stringify(token ?? null);

/** Expo's answer per message, in message order. A receipt has the same shape minus the id. */
type PushTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
type PushReceipt = { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };

/** What sending needs: D1 for tokens and tickets, and the Expo access token when push security is on. */
export type PushEnv = { DB: D1Database; EXPO_ACCESS_TOKEN?: string };

/** Waits before each retry of a request Expo answered 429 or 5xx (or that hit a network error). */
export const PUSH_RETRY_DELAYS_MS = [1000, 3000];

/** Posts to an Expo push endpoint, retrying throttling and server errors. Null when it never got through. */
async function postExpo<T>(path: string, payload: unknown, accessToken?: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const { data, errors } = (await res.json()) as { data?: T; errors?: unknown };
        if (errors) console.error('[push] request errors', { path, errors });
        return data ?? null;
      }
      if (res.status !== 429 && res.status < 500) {
        console.error('[push] rejected', { path, status: res.status, body: await res.text() });
        return null;
      }
      console.warn('[push] retryable', { path, status: res.status, attempt });
    } catch (err) {
      console.warn('[push] failed', { path, attempt, err: String(err) });
    }
    if (attempt >= PUSH_RETRY_DELAYS_MS.length) {
      console.error('[push] gave up', { path });
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_DELAYS_MS[attempt]));
  }
}

/** True when Expo says this token no longer belongs to an installed app; other errors are logged. */
function isDead(result: PushTicket | PushReceipt, token: string) {
  if (result.status !== 'error') return false;
  if (result.details?.error === 'DeviceNotRegistered') return true;
  console.error('[push] delivery error', { token: maskToken(token), error: result.details?.error, message: result.message });
  return false;
}

/**
 * Best effort: a push failure never fails the request that triggered it. Returns the tokens Expo already knows are
 * dead, and the tickets it accepted, whose receipts say later whether FCM/APNs delivered them.
 */
export async function sendPush(messages: PushMessage[], accessToken?: string) {
  const dead: string[] = [];
  const tickets: { id: string; token: string }[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const results = await postExpo<PushTicket[]>('send', batch, accessToken);
    results?.forEach((ticket, j) => {
      const token = batch[j]?.to;
      if (!token) return;
      if (ticket.status === 'ok') tickets.push({ id: ticket.id, token });
      else if (isDead(ticket, token)) dead.push(token);
    });
  }
  return { dead, tickets };
}

/** Clears tokens whose app is gone, so later pushes skip them. */
async function forgetTokens(db: D1Database, tokens: string[]) {
  for (let i = 0; i < tokens.length; i += 90) {
    const chunk = tokens.slice(i, i + 90);
    await db
      .prepare(`UPDATE users SET push_token = NULL WHERE push_token IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .run();
  }
  console.log('[push] forgot unregistered tokens', { count: tokens.length });
}

export async function pushToUsers(
  env: PushEnv,
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
      const { results } = await env.DB
        .prepare(`SELECT push_token FROM users WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(...chunk)
        .all<{ push_token: string | null }>();
      tokens.push(...results.map((r) => r.push_token));
    }
    const { dead, tickets } = await sendPush(pushMessages(tokens, title, body, data, style), env.EXPO_ACCESS_TOKEN);
    if (dead.length > 0) await forgetTokens(env.DB, dead);
    if (tickets.length > 0) {
      const insert = env.DB.prepare('INSERT OR IGNORE INTO push_tickets (id, token) VALUES (?, ?)');
      await env.DB.batch(tickets.map((t) => insert.bind(t.id, t.token)));
    }
  } catch (err) {
    console.error('push failed', err);
  }
}

/** Expo answers receipts for at most 1000 ids per request. */
const RECEIPTS_PER_REQUEST = 1000;

/**
 * Cron: reads the receipts of tickets sent at least 15 minutes ago (Expo keeps them for a day) and forgets tokens
 * FCM/APNs reported as unregistered. Checked tickets are dropped, as are any older than a day whose receipt never came.
 */
export async function checkPushReceipts(env: PushEnv) {
  const { results } = await env.DB.prepare(
    `SELECT id, token FROM push_tickets WHERE created_at <= datetime('now', '-15 minutes') ORDER BY created_at LIMIT ${RECEIPTS_PER_REQUEST}`,
  ).all<{ id: string; token: string }>();
  if (results.length > 0) {
    const receipts = await postExpo<Record<string, PushReceipt>>('getReceipts', { ids: results.map((t) => t.id) }, env.EXPO_ACCESS_TOKEN);
    if (receipts) {
      const dead = results.filter((t) => receipts[t.id] && isDead(receipts[t.id], t.token)).map((t) => t.token);
      if (dead.length > 0) await forgetTokens(env.DB, [...new Set(dead)]);
      // Ids without a receipt yet stay for the next run.
      const done = results.filter((t) => receipts[t.id]).map((t) => t.id);
      const remove = env.DB.prepare('DELETE FROM push_tickets WHERE id = ?');
      if (done.length > 0) await env.DB.batch(done.map((id) => remove.bind(id)));
    }
  }
  await env.DB.prepare("DELETE FROM push_tickets WHERE created_at < datetime('now', '-1 day')").run();
}
