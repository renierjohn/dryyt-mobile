#!/usr/bin/env node
// Plays the drivers and the store owners of food pickup orders, so a real customer can test the app end to end.
// Usage: bun run mock:driver-owner-pickup-food [--speed <km/h>] [--api <url>]
// Puts 5 random existing verified drivers (not blocked, not busy) online for pickup. When the customer pays for a food
// order, the store's owner taps Done Pay. Once the customer places it, the first waiting driver with the booked vehicle
// counts down 5 s, accepts, drives to the store (GPS every 3 s), picks up, drives to the customer and delivers, then
// waits again. Ctrl+C puts the drivers' Online for Pickup back as it was.
// Signs everyone in with worker/.dev.vars JWT_SECRET and reads local D1, so it works against `bun run dev` only.
import { car, d1, km, openRoom, parseArgs, peso, sleep, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api } = parseArgs(argv);

const usage = usageError('bun run mock:driver-owner-pickup-food [--speed <km/h>] [--api <url>]');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

const DRIVERS = 5;
const COUNTDOWN_S = 5;
const POLL_MS = 3000;
const BACKOFF_MS = 10_000;
/** A driver whose last fix is farther than this from the store starts this close instead. */
const MAX_START_KM = 20;
const START_OFFSET = { lat: -0.007, lng: -0.004 }; // ~1 km from the store

const drivers = d1(
  `SELECT u.id, u.name, dd.vehicle_type, d.pickup_online, d.lat, d.lng
   FROM users u JOIN drivers d ON d.user_id = u.id JOIN driver_data dd ON dd.user_id = u.id
   WHERE u.role = 'driver' AND u.blocked = 0 AND dd.status = 1 AND dd.vehicle_type IS NOT NULL AND d.busy = 0
   ORDER BY RANDOM() LIMIT ${DRIVERS}`,
  false,
).map((row) => ({ ...row, user: tokenUser(api, tokenForUser(String(row.id), 'driver')) }));
if (drivers.length === 0) usage('No verified, free driver in local D1');

const owners = d1("SELECT DISTINCT owner_id FROM stores WHERE type = 'food' AND owner_id IS NOT NULL", false).map((row) =>
  tokenUser(api, tokenForUser(String(row.owner_id), 'owner')),
);
if (owners.length === 0) console.log('Note: no food store has an owner, so nobody taps Done Pay. Link one with bun run shop:set.');

/** Orders a driver is counting down on or has taken, so the others leave them. */
const claimed = new Set();
let stopping = false;

/** Done Pay on every food order waiting for payment at the owner's stores. */
async function runOwner(owner) {
  const who = owner.user.name || owner.user.email;
  while (!stopping) {
    // Newest 20 is plenty for testing; older orders waiting for payment are left alone.
    const { orders } = await owner.must('/owner/orders?type=food&limit=20');
    for (const o of orders.filter((x) => x.status === 'awaiting_payment')) {
      await owner.must(`/owner/orders/${o.id}/confirm-payment`, {});
      console.log(`[${time()}] ${who}: Done Pay #${o.id} at ${o.store_name} from ${o.customer_name}, ${peso(o.items_total + o.total_delivery_fee)}`);
    }
    await sleep(POLL_MS);
  }
}

async function runDriver(driver) {
  const { user } = driver;
  const log = (msg) => console.log(`[${time()}] ${driver.name}: ${msg}`);
  await user.must('/drivers/me/pickup-online', { online: true });
  log(`online for pickup (vehicle ${driver.vehicle_type})`);

  while (!stopping) {
    // Busy on a job from somewhere else (the app, or another mock using the same driver): wait it out.
    if ((await user.must('/drivers/me')).driver.busy) {
      await sleep(POLL_MS);
      continue;
    }
    const { jobs } = await user.must('/jobs/available');
    const job = jobs.find((j) => j.store_type === 'food' && !claimed.has(j.id));
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    claimed.add(job.id);
    log(`#${job.id} at ${job.store_name}, ${peso(job.total_delivery_fee)}. Accepting in…`);
    for (let s = COUNTDOWN_S; s > 0; s--) {
      console.log(`[${time()}] ${driver.name}:   ${s}`);
      await sleep(1000);
    }
    const res = await user.call(`/jobs/${job.id}/accept`, {});
    if (res.status >= 400) {
      log(`could not accept #${job.id}: ${res.data.error ?? res.status}`);
      claimed.delete(job.id);
      // Gives another waiting driver the first go.
      await sleep(BACKOFF_MS);
      continue;
    }
    log(`accepted #${job.id}`);
    await deliver(driver, res.data.job, log);
  }
}

async function deliver(driver, order, log) {
  const { user } = driver;
  const store = { lat: order.store_lat, lng: order.store_lng };
  const last = driver.lat !== null && driver.lng !== null ? { lat: driver.lat, lng: driver.lng } : null;
  const start = last && km(last, store) <= MAX_START_KM ? last : { lat: store.lat + START_OFFSET.lat, lng: store.lng + START_OFFSET.lng };
  let room = null;
  const trip = car(start, speedKmh, () => room);

  await trip.driveTo(store, order.store_name);
  ({ job: order } = await user.must(`/jobs/${order.id}/status`, { status: 'picked_up' }));
  log(`picked up #${order.id}`);

  if (order.customer_lat !== null && order.customer_lng !== null) {
    room = await openRoom(api, user, `order-${order.id}`, () => {});
    await trip.driveTo({ lat: order.customer_lat, lng: order.customer_lng }, order.customer_name);
    room.close();
  }
  await user.must(`/jobs/${order.id}/status`, { status: 'delivered' });
  log(`delivered #${order.id}`);
  ({ lat: driver.lat, lng: driver.lng } = trip.here);
}

process.on('SIGINT', async () => {
  stopping = true;
  for (const d of drivers) await d.user.call('/drivers/me/pickup-online', { online: d.pickup_online === 1 });
  console.log('\nDrivers back to their Online for Pickup setting');
  process.exit(0);
});

console.log(
  `[${time()}] ${drivers.length} drivers waiting, ${owners.length} food store owners watching payments. Order food in the customer app. Ctrl+C stops.`,
);
for (const owner of owners) runOwner(owner).catch((err) => console.error(`[${time()}] owner #${owner.user.id}: ${err.message}`));
for (const driver of drivers) runDriver(driver).catch((err) => console.error(`[${time()}] ${driver.name}: ${err.message}`));
