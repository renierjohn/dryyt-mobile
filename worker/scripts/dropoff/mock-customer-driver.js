#!/usr/bin/env node
// Plays the customer and the driver of a drop off, so a real shop owner can test the app end to end.
// Usage: bun run mock:customer-driver [<storeId>] [--vehicle <1-4>] [--speed <km/h>] [--api <url>]
// The test customer (created on first run) books a drop off from a random spot in Dauin to laundry shop storeId (default:
// a random one with a pin). The test driver (created and verified on first run, with the booked vehicle, default 2
// motorcycle) goes online 500 m away, accepts, gets confirmed, drives to the customer and on to the shop (GPS every 3 s)
// and drops off with a proof photo. Confirm it in the owner app; the script prints the status until then.
// Ctrl+C cancels the booking if it isn't picked up yet and takes the driver offline.
// Verifies the driver in local D1, so it works against `bun run dev` only.
import { readFileSync } from 'node:fs';

import { car, d1, openRoom, parseArgs, peso, sleep, testUser, time, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const vehicleAt = argv.indexOf('--vehicle');
const vehicle = vehicleAt >= 0 ? Number(argv.splice(vehicleAt, 2)[1]) : 2;
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, positional } = parseArgs(argv);
const storeId = positional.length > 0 ? Number(positional[0]) : null;

const usage = usageError('bun run mock:customer-driver [<storeId>] [--vehicle <1-4>] [--speed <km/h>] [--api <url>]');
if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) usage('storeId must be a positive integer');
if (![1, 2, 3, 4].includes(vehicle)) usage('vehicle must be 1 (bicycle), 2 (motorcycle), 3 (tricycle) or 4 (car)');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

// Test-only accounts; override with MOCK_CUSTOMER_EMAIL / MOCK_DRIVER_EMAIL (and _PASSWORD). The driver is its own,
// apart from mock:driver's, so blocking or verifying one doesn't touch the other.
const CUSTOMER = {
  email: process.env.MOCK_CUSTOMER_EMAIL ?? 'mock.customer@dryyt.test',
  password: process.env.MOCK_CUSTOMER_PASSWORD ?? 'mock-customer-pass',
  name: 'Mock Customer',
  phone: '09170000000',
  role: 'customer',
};
const DRIVER = {
  email: process.env.MOCK_DRIVER_EMAIL ?? 'mock.dropoff.driver@dryyt.test',
  password: process.env.MOCK_DRIVER_PASSWORD ?? 'mock-driver-pass',
  name: 'Mock Drop Off Driver',
  phone: '09170000003',
  role: 'driver',
};
/** Inland Dauin around the town proper (the cpanel's default map center, 9.1906, 123.2669), clear of the sea to the east. */
const DAUIN = { minLat: 9.175, maxLat: 9.205, minLng: 123.245, maxLng: 123.266 };
const TICK_MS = 3000; // above the server's 2 s location limit
const POLL_MS = 3000;
const ACTIVE = ['searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop'];
/** Still cancellable on Ctrl+C. */
const CANCELLABLE = ['searching', 'driver_accepted', 'en_route_pickup'];
/** The owner has answered (or it never got that far). */
const DONE = ['owner_confirmed', 'completed', 'payment_pending', 'cancelled', 'expired'];

// The app logo stands in for the proof photo, so the owner app has a real image to show.
const PROOF_PNG = readFileSync(new URL('../../../assets/images/logo@3x.png', import.meta.url));

const random = (min, max) => min + Math.random() * (max - min);
const spot = () => ({ lat: +random(DAUIN.minLat, DAUIN.maxLat).toFixed(6), lng: +random(DAUIN.minLng, DAUIN.maxLng).toFixed(6) });

// storeId is a validated integer.
const shops = d1(
  `SELECT id, name FROM stores WHERE type = 'laundry' AND lat IS NOT NULL AND lng IS NOT NULL${storeId ? ` AND id = ${storeId}` : ''}`,
  false,
);
if (shops.length === 0) usage(storeId ? `Store #${storeId} is not a laundry shop with a pin in local D1` : 'No laundry shop with a pin in local D1');
const shop = shops[Math.floor(Math.random() * shops.length)];

let customer;
let driver;
let dropoffId = null;
let dispatch = null;
let room = null;

async function main() {
  customer = await testUser(api, CUSTOMER);
  driver = await testUser(api, DRIVER);
  // Vehicle and verified badge straight in D1 (the API locks the vehicle once verified). user.id is an integer.
  d1(
    `INSERT INTO driver_data (user_id, vehicle_type, status) VALUES (${driver.user.id}, ${vehicle}, 1)
     ON CONFLICT (user_id) DO UPDATE SET vehicle_type = excluded.vehicle_type, status = 1, updated_at = datetime('now')`,
    false,
  );

  // One active drop off each: clear the test accounts' leftovers from an earlier run.
  for (const old of (await customer.must('/dropoffs')).dropoffs.filter((d) => CANCELLABLE.includes(d.status))) {
    await customer.call(`/dropoffs/${old.id}/cancel`, {});
    console.log(`[${time()}] Cancelled leftover drop off #${old.id}`);
  }
  const leftover = (await driver.must('/drivers/me')).job;
  if (leftover && ACTIVE.includes(leftover.status)) usage(`${DRIVER.email} is still on drop off #${leftover.id} (${leftover.status}); finish or cancel it first`);

  const at = spot();
  const { quote } = await customer.must('/dropoffs/quote', { store_id: shop.id, ...at });
  const option = quote.options.find((o) => o.vehicle_type === vehicle);
  if (!option) usage(`${shop.name} has no rate for vehicle ${vehicle}`);

  // The driver waits 500 m north of the customer, so the request is in range and the drive is short.
  const home = { lat: at.lat + 0.5 / 111, lng: at.lng };
  const wheels = car(home, speedKmh, () => room);
  await driver.must('/drivers/me/online', { online: true });
  let accepted = null;
  dispatch = await openRoom(api, driver, 'dispatch', (msg) => {
    if (msg.t === 'requests' && !accepted && dropoffId) {
      const r = msg.items.find((it) => it.transaction_id === dropoffId);
      if (!r) return;
      console.log(`[${time()}] Driver: request #${r.transaction_id}, ${r.distance_km} km away. Accepting.`);
      dispatch.send({ t: 'accept', transaction_id: r.transaction_id });
    } else if (msg.t === 'accepted') accepted = msg.transaction_id;
    else if (msg.t === 'taken' || msg.t === 'error') console.log(`[${time()}] Driver: ${msg.t}: ${msg.message ?? `#${msg.transaction_id}`}`);
  });
  dispatch.send({ t: 'loc', ...home });

  let { dropoff: d } = await customer.must('/dropoffs', { store_id: shop.id, ...at, vehicle_type: vehicle, quote_token: quote.token });
  dropoffId = d.id;
  console.log(
    `[${time()}] Customer: booked #${d.id} from ${at.lat}, ${at.lng} to ${shop.name} (#${shop.id}), ${quote.road_km.toFixed(1)} km, ${peso(option.total_delivery_fee)}`,
  );

  // Location every tick keeps the request list fresh.
  while (!accepted) {
    dispatch.send({ t: 'loc', ...home });
    await sleep(TICK_MS);
  }
  dispatch.close();
  dispatch = null;

  // Another real driver may have taken it first; only confirm ours.
  for (;;) {
    d = (await customer.must(`/dropoffs/${d.id}`)).dropoff;
    if (d.status === 'driver_accepted' && d.driver_id === driver.user.id) break;
    if (d.status !== 'searching' && d.status !== 'driver_accepted') throw new Error(`Drop off #${d.id} is ${d.status}`);
    await sleep(POLL_MS);
  }
  await customer.must(`/dropoffs/${d.id}/confirm-driver`, {});
  console.log(`[${time()}] Customer: confirmed ${DRIVER.name}`);

  let job = (await driver.must('/drivers/me')).job;
  room = await openRoom(api, driver, job.room_id, () => {});
  if (job.status === 'en_route_pickup') {
    await wheels.driveTo({ lat: job.customer_lat, lng: job.customer_lng }, 'the customer');
    await driver.must(`/dropoffs/${d.id}/picked-up`, {});
    console.log(`[${time()}] Driver: picked up`);
  }
  await wheels.driveTo({ lat: job.shop_lat, lng: job.shop_lng }, shop.name);
  room.close();
  room = null;

  const { key } = await driver.must(`/dropoffs/${d.id}/proof-upload`, PROOF_PNG, { raw: true, headers: { 'content-type': 'image/png' } });
  ({ dropoff: d } = await driver.must(`/dropoffs/${d.id}/drop`, { weight_kg: 3.5, laundry_fee: 15000, notes: 'Mock drop off', proof_photo_key: key }));
  console.log(`[${time()}] Driver: dropped off at ${shop.name}: 3.5 kg, laundry fee ${peso(15000)} → ${d.status}`);
  await driver.must('/drivers/me/online', { online: false });
  console.log(`[${time()}] Confirm drop off #${d.id} in the owner app. Ctrl+C stops.`);

  let last = d.status;
  while (!DONE.includes(d.status)) {
    await sleep(POLL_MS);
    d = (await customer.must(`/dropoffs/${d.id}`)).dropoff;
    if (d.status === last) continue;
    last = d.status;
    console.log(`[${time()}] #${d.id} ${d.status.replaceAll('_', ' ')}`);
  }
}

async function stop() {
  dispatch?.close();
  room?.close();
  if (dropoffId) {
    const d = (await customer.call(`/dropoffs/${dropoffId}`)).data.dropoff;
    if (d && CANCELLABLE.includes(d.status)) {
      await customer.call(`/dropoffs/${dropoffId}/cancel`, {});
      console.log(`Cancelled #${dropoffId}`);
    }
  }
  await driver?.call('/drivers/me/online', { online: false });
}

process.on('SIGINT', async () => {
  console.log();
  await stop();
  process.exit(0);
});

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err.message);
    await stop();
    process.exit(1);
  });
