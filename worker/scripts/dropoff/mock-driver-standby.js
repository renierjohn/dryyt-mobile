#!/usr/bin/env node
// Puts an existing driver online at a fixed spot and only watches: prints each drop off request that
// reaches them (fee and distance) and when it goes away. Never accepts. Ctrl+C restores their online state.
// Usage: bun run mock:standby <driverId|email> <lat> <lng> [--api <url>]
// Signs in with worker/.dev.vars JWT_SECRET, so it works against local `bun run dev` only.
import { openRoom, parseArgs, peso, sleep, time, tokenForUser, usageError } from '../lib/mock.js';

const { api, positional } = parseArgs();
const [who, latArg, lngArg] = positional;
const lat = Number(latArg);
const lng = Number(lngArg);

const usage = usageError('bun run mock:standby <driverId|email> <lat> <lng> [--api <url>]');
if (!who) usage('Pass the driver id or email');
if (!Number.isFinite(lat) || lat < -90 || lat > 90) usage('lat must be between -90 and 90');
if (!Number.isFinite(lng) || lng < -180 || lng > 180) usage('lng must be between -180 and 180');

const TICK_MS = 3000; // above the server's 2 s location limit

let token;
let driver;
try {
  ({ token, user: driver } = tokenForUser(who, 'driver'));
} catch (err) {
  usage(err.message);
}

async function must(path, body) {
  const res = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error ?? ''}`);
  return data;
}
const user = { must };

const me = await must('/drivers/me');
if (me.job) usage(`Driver #${driver.id} is on drop off #${me.job.id} (${me.job.status}); finish it first`);
const wasOnline = me.driver.online;
await must('/drivers/me/online', { online: true });

const shown = new Map();
const dispatch = await openRoom(api, user, 'dispatch', (msg) => {
  if (msg.t !== 'requests') return;
  const ids = new Set(msg.items.map((r) => r.transaction_id));
  for (const r of msg.items) {
    if (shown.has(r.transaction_id)) continue;
    shown.set(r.transaction_id, r);
    console.log(
      `[${time()}] Request #${r.transaction_id}  ${r.store_name}  ${r.distance_km} km away (${r.colour})  ` +
        `You earn ${peso(r.delivery_fee)} · customer pays ${peso(r.total_delivery_fee)}  ${r.customer_name} ${r.customer_phone}`.trimEnd(),
    );
  }
  for (const id of [...shown.keys()]) {
    if (ids.has(id)) continue;
    shown.delete(id);
    console.log(`[${time()}] Request #${id} gone (taken, cancelled or expired)`);
  }
});

console.log(`[${time()}] Driver #${driver.id} ${driver.name} on standby at ${lat}, ${lng}. Waiting for drop offs within range… Ctrl+C stops.`);

process.on('SIGINT', async () => {
  dispatch.close();
  if (!wasOnline) await must('/drivers/me/online', { online: false }).catch(() => {});
  console.log(`\nStopped${wasOnline ? '' : '; driver back offline'}.`);
  process.exit(0);
});

// Location every tick keeps the request list fresh (the room sends it back on each fix).
for (;;) {
  dispatch.send({ t: 'loc', lat, lng });
  await sleep(TICK_MS);
}
