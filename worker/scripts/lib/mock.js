// Shared bits for the mock-* scripts: API calls as a test user, flag parsing and D1 access.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The worker the app talks to: EXPO_PUBLIC_API_URL from the app's .env, so the mocks join the same
 * Dispatch and Trip rooms as the real app. Each `wrangler dev` has its own rooms (only D1 is shared).
 */
export function appApiUrl() {
  try {
    const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
    const url = env.match(/^EXPO_PUBLIC_API_URL=(.+)$/m)?.[1].trim();
    if (url) return url;
  } catch {
    // no app .env
  }
  return 'http://localhost:8788';
}

/** Pulls `--api <url>` and `--remote` out of argv; the rest are positional args. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const apiAt = args.indexOf('--api');
  const api = apiAt >= 0 ? args.splice(apiAt, 2)[1] : appApiUrl();
  console.log(`Worker: ${api}`);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  return { api, flags, positional: args.filter((a) => !a.startsWith('--')) };
}

export function usageError(usage) {
  return (msg) => {
    console.error(`${msg}\nUsage: ${usage}`);
    process.exit(1);
  };
}

/** A signed-in test user. Logs in, or registers the account on first run. */
export async function testUser(api, account) {
  let token = null;

  async function call(path, body, { method, headers, raw } = {}) {
    const res = await fetch(`${api}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }

  async function must(path, body, opts) {
    const res = await call(path, body, opts);
    if (res.status >= 400) throw new Error(`${path}: ${res.status} ${res.data.error ?? ''}`);
    return res.data;
  }

  const login = await call('/auth/login', { email: account.email, password: account.password });
  if (login.status === 200) {
    token = login.data.token;
    if (login.data.user.role !== account.role) throw new Error(`${account.email} is a ${login.data.user.role}, not a ${account.role}`);
    return { call, must, user: login.data.user };
  }
  console.log(`Creating test ${account.role} ${account.email}`);
  const created = await must('/auth/register', account);
  token = created.token;
  return { call, must, user: created.user };
}

/** Opens a dispatch or trip room socket. `onMessage` gets parsed messages. */
export async function openRoom(api, user, room, onMessage) {
  const { ticket } = await user.must('/ws/ticket', { room });
  const path = room === 'dispatch' ? '/ws/dispatch' : `/ws/trip/${room}`;
  const ws = new WebSocket(`${api.replace(/^http/, 'ws')}${path}?ticket=${ticket}`);
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`Could not open ${room} socket`)), { once: true });
  });
  return { send: (msg) => ws.send(JSON.stringify(msg)), close: () => ws.close() };
}

/** Runs SQL on the local (or --remote) D1 database and returns the rows. Only pass validated values. */
export function d1(sql, remote) {
  return JSON.parse(
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'dryyt', remote ? '--remote' : '--local', '--json', '--command', sql], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    }),
  )[0].results;
}

/**
 * Signs in as an existing user without their password: looks them up in D1 (by id or email) and signs a
 * token with JWT_SECRET from worker/.dev.vars, like the worker's signToken. Works against `bun run dev` only,
 * since a deployed worker has a different secret.
 */
export function tokenForUser(who, role) {
  const where = /^\d+$/.test(who) ? `id = ${Number(who)}` : `email = '${who.toLowerCase().replaceAll("'", "''")}'`;
  const [user] = d1(`SELECT id, email, name, role FROM users WHERE ${where}`, false);
  if (!user) throw new Error(`No user ${who}`);
  if (user.role !== role) throw new Error(`User #${user.id} is ${user.role === 'owner' ? 'an' : 'a'} ${user.role}, not ${role === 'owner' ? 'an' : 'a'} ${role}`);

  let secret;
  try {
    secret = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8').match(/^JWT_SECRET=(.+)$/m)?.[1].trim();
  } catch {
    // no .dev.vars
  }
  if (!secret) throw new Error('JWT_SECRET is missing from worker/.dev.vars');

  const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  return { token, user };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const time = () => new Date().toLocaleTimeString();
export const peso = (centavos) => `₱${(centavos / 100).toFixed(2)}`;
