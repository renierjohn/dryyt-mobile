#!/usr/bin/env node
// Plays the driver side of a drop off so a customer can test with the real app.
// Usage: yarn mock:driver <lat> <lng> [--api <url>] [--speed <km/h>]
// Goes online at lat/lng, accepts the first nearby request, waits for the customer to confirm,
// drives the road to the customer and then to the shop (sending GPS every 3 s), and drops off with a proof photo.
// Ctrl+C goes offline.
import { readFileSync } from 'node:fs';

import { openRoom, parseArgs, peso, sleep, testUser, time, usageError } from './lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, positional } = parseArgs(argv);
const [lat, lng] = positional.map(Number);

const usage = usageError('yarn mock:driver <lat> <lng> [--api <url>] [--speed <km/h>]');
if (!Number.isFinite(lat) || lat < -90 || lat > 90) usage('lat must be between -90 and 90');
if (!Number.isFinite(lng) || lng < -180 || lng > 180) usage('lng must be between -180 and 180');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

// Test-only account; override with MOCK_DRIVER_EMAIL / MOCK_DRIVER_PASSWORD.
const DRIVER = {
  email: process.env.MOCK_DRIVER_EMAIL ?? 'mock.driver@dryyt.test',
  password: process.env.MOCK_DRIVER_PASSWORD ?? 'mock-driver-pass',
  name: 'Mock Driver',
  phone: '09170000001',
  role: 'driver',
};
const TICK_MS = 3000; // above the server's 2 s location limit
const POLL_MS = 3000;

// The app logo stands in for the proof photo, so the owner app has a real image to show.
const PROOF_PNG = readFileSync(new URL('../../assets/images/logo@3x.png', import.meta.url));

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let here = { lat, lng };
let user;
let room = null;

/** Road path from `here` to `to` as points via the public OSRM server; a straight line if it fails. */
async function roadPath(to) {
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${here.lng},${here.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
      { headers: { 'user-agent': 'dryyt-mock-driver' } },
    );
    const data = await res.json();
    if (data.code === 'Ok') return [...data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), to];
  } catch {
    // fall through
  }
  console.log(`[${time()}] No road route, driving straight`);
  return [to];
}

/** Drives along the road to `to` at speedKmh, sending a fix to `room` every tick. */
async function driveTo(to, label) {
  const path = await roadPath(to);
  const total = path.reduce((sum, p, i) => sum + km(i === 0 ? here : path[i - 1], p), 0);
  console.log(`[${time()}] Driving to ${label} (${total.toFixed(2)} km by road)`);
  const stepKm = (speedKmh * TICK_MS) / 3_600_000;
  let next = 0;
  while (next < path.length) {
    // Walk stepKm along the path, across as many points as it covers.
    let budget = stepKm;
    while (next < path.length) {
      const leg = km(here, path[next]);
      if (leg > budget) {
        const f = budget / leg;
        here = { lat: here.lat + (path[next].lat - here.lat) * f, lng: here.lng + (path[next].lng - here.lng) * f };
        break;
      }
      budget -= leg;
      here = path[next++];
    }
    room?.send({ t: 'loc', ...here });
    if (next < path.length) await sleep(TICK_MS);
  }
  console.log(`[${time()}] Arrived at ${label}`);
}

async function job() {
  return (await user.must('/drivers/me')).job;
}

async function waitFor(id, statuses) {
  for (;;) {
    const j = await job();
    if (!j || j.id !== id) return null;
    if (statuses.includes(j.status)) return j;
    await sleep(POLL_MS);
  }
}

async function main() {
  user = await testUser(api, DRIVER);
  await user.must('/drivers/me/online', { online: true });

  process.on('SIGINT', async () => {
    await user.call('/drivers/me/online', { online: false });
    console.log('\nWent offline');
    process.exit(0);
  });

  // Resume a job from an earlier run instead of waiting for a new one.
  let current = await job();
  if (current?.status === 'dropped_off') current = null;

  if (!current) {
    console.log(`[${time()}] Online at ${lat}, ${lng}. Request a drop off within 10 km in the customer app.`);
    let accepted = null;
    const dispatch = await openRoom(api, user, 'dispatch', (msg) => {
      if (msg.t === 'requests' && !accepted && msg.items.length > 0) {
        const r = msg.items[0];
        console.log(`[${time()}] Request #${r.transaction_id} to ${r.store_name}, ${r.distance_km} km away. Accepting.`);
        dispatch.send({ t: 'accept', transaction_id: r.transaction_id });
      } else if (msg.t === 'accepted') accepted = msg.transaction_id;
      else if (msg.t === 'taken' || msg.t === 'error') console.log(`[${time()}] ${msg.t}: ${msg.message ?? `#${msg.transaction_id}`}`);
    });
    // Location every tick keeps the request list fresh.
    while (!accepted) {
      dispatch.send({ t: 'loc', ...here });
      await sleep(TICK_MS);
    }
    dispatch.close();
    console.log(`[${time()}] Accepted #${accepted}. Waiting for the customer to confirm…`);
    current = await waitFor(accepted, ['en_route_pickup', 'en_route_shop']);
    if (!current) {
      console.log(`[${time()}] The customer turned this driver down or cancelled.`);
      return main();
    }
  }

  const id = current.id;
  console.log(`[${time()}] Drop off #${id}: ${current.customer_name}, ${current.customer_phone}`);
  room = await openRoom(api, user, current.room_id, () => {});

  if (current.status === 'en_route_pickup') {
    await driveTo({ lat: current.customer_lat, lng: current.customer_lng }, 'the customer');
    await user.must(`/dropoffs/${id}/picked-up`, {});
    console.log(`[${time()}] Picked up`);
  }
  await driveTo({ lat: current.shop_lat, lng: current.shop_lng }, current.store_name);
  room.close();

  const { key } = await user.must(`/dropoffs/${id}/proof-upload`, PROOF_PNG, { raw: true, headers: { 'content-type': 'image/png' } });
  const { dropoff } = await user.must(`/dropoffs/${id}/drop`, { weight_kg: 3.5, laundry_fee: 15000, notes: 'Mock drop off', proof_photo_key: key });
  console.log(`[${time()}] Dropped off: 3.5 kg, laundry fee ${peso(15000)} → ${dropoff.status}`);

  await user.must('/drivers/me/online', { online: false });
  console.log('Went offline');
}

main().catch(async (err) => {
  console.error(err.message);
  await user?.call('/drivers/me/online', { online: false });
  process.exit(1);
});
