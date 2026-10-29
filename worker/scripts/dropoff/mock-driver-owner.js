#!/usr/bin/env node
// Plays every side of a drop off except the customer, so a real customer can test the app end to end.
// Usage: bun run mock:driver-owner [<lat> <lng>] [--api <url>] [--speed <km/h>] [--paid]
// Puts 3 motorcycle and 3 tricycle test drivers online around lat/lng (default: Dauin town proper) (they're created and verified on first run).
// When the customer books a drop off at any laundry shop, the nearest waiting driver of the booked vehicle accepts,
// drives to the customer and on to the shop (GPS every 3 s), and drops off with a proof photo. The shop's owner then
// confirms it (a shop without an owner is linked to the test owner); with --paid the owner also marks it paid.
// The driver then goes back to its spot and waits again. Ctrl+C takes everyone offline.
// Signs owners in with worker/.dev.vars JWT_SECRET and verifies drivers in local D1, so it works against `bun run dev` only.
import { readFileSync } from 'node:fs';

import { car, d1, km, openRoom, parseArgs, peso, sleep, testUser, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, flags, positional } = parseArgs(argv);
// Dauin, Negros Oriental (town proper), same as the cpanel's default map center.
const DAUIN = { lat: 9.1906, lng: 123.2669 };
const [lat, lng] = positional.length > 0 ? positional.map(Number) : [DAUIN.lat, DAUIN.lng];
const markPaid = flags.has('--paid');

const usage = usageError('bun run mock:driver-owner [<lat> <lng>] [--api <url>] [--speed <km/h>] [--paid]');
if (!Number.isFinite(lat) || lat < -90 || lat > 90) usage('lat must be between -90 and 90');
if (!Number.isFinite(lng) || lng < -180 || lng > 180) usage('lng must be between -180 and 180');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

const VEHICLES = { 2: 'Motorcycle', 3: 'Tricycle' };
const PER_VEHICLE = 3;
// Test-only accounts.
const OWNER = { email: 'mock.owner@dryyt.test', password: 'mock-owner-pass', name: 'Mock Owner', phone: '09170000002', role: 'owner' };
const driverAccount = (vehicle, n) => ({
  email: `mock.${VEHICLES[vehicle].toLowerCase()}${n}@dryyt.test`,
  password: 'mock-driver-pass',
  name: `Mock ${VEHICLES[vehicle]} ${n}`,
  phone: `0917100${vehicle}${String(n).padStart(3, '0')}`,
  role: 'driver',
});
const TICK_MS = 3000; // above the server's 2 s location limit
const POLL_MS = 3000;

// The app logo stands in for the proof photo, so the owner app has a real image to show.
const PROOF_PNG = readFileSync(new URL('../../../assets/images/logo@3x.png', import.meta.url));

/** Drop offs a mock driver has accepted, so the others don't race it. */
const claimed = new Set();
const drivers = [];

/** A spot on a ring around lat/lng, 300 m to 1 km out, so drivers show as separate pins. */
function spotFor(i, total) {
  const angle = (2 * Math.PI * i) / total;
  const dist = 0.3 + 0.7 * (i / total);
  return { lat: lat + (dist / 111) * Math.cos(angle), lng: lng + (dist / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle) };
}

async function startDriver(vehicle, n, home) {
  const account = driverAccount(vehicle, n);
  const user = await testUser(api, account);
  // Vehicle and verified badge straight in D1 (the API locks the vehicle once verified). user.id is an integer.
  d1(
    `INSERT INTO driver_data (user_id, vehicle_type, status) VALUES (${user.user.id}, ${vehicle}, 1)
     ON CONFLICT (user_id) DO UPDATE SET vehicle_type = excluded.vehicle_type, status = 1, updated_at = datetime('now')`,
    false,
  );
  await user.must('/drivers/me/online', { online: true });
  const self = { user, name: account.name, vehicle, home, room: null, free: false, sees: new Set() };
  self.car = car(home, speedKmh, () => self.room);
  drivers.push(self);
  const log = (msg) => console.log(`[${time()}] ${account.name}: ${msg}`);

  const job = async () => (await user.must('/drivers/me')).job;
  async function waitFor(id, statuses) {
    for (;;) {
      const j = await job();
      if (!j || j.id !== id) return null;
      if (statuses.includes(j.status)) return j;
      await sleep(POLL_MS);
    }
  }

  /** On standby at home until this driver accepts a request; resolves with its id. */
  async function standby() {
    self.car.here = home;
    let accepted = null;
    const dispatch = await openRoom(api, user, 'dispatch', (msg) => {
      if (msg.t === 'requests' && !accepted) {
        self.sees = new Set(msg.items.map((it) => it.transaction_id));
        // Only the nearest free driver that sees it takes it (the room sends each driver its own vehicle's requests,
        // minus any from a customer who turned that driver down).
        const r = msg.items.find((it) => !claimed.has(it.transaction_id) && nearest(it) === self);
        if (!r) return;
        claimed.add(r.transaction_id);
        log(`request #${r.transaction_id} to ${r.store_name}, ${r.distance_km} km away. Accepting.`);
        dispatch.send({ t: 'accept', transaction_id: r.transaction_id });
      } else if (msg.t === 'accepted') accepted = msg.transaction_id;
      else if (msg.t === 'error') log(msg.message);
    });
    self.dispatch = dispatch;
    self.free = true;
    while (!accepted) {
      dispatch.send({ t: 'loc', ...home });
      await sleep(TICK_MS);
    }
    self.free = false;
    self.sees = new Set();
    dispatch.close();
    self.dispatch = null;
    return accepted;
  }

  async function run() {
    for (;;) {
      let current = await job();
      if (current?.status === 'dropped_off') current = null;
      if (!current) {
        const id = await standby();
        log(`accepted #${id}. Waiting for the customer to confirm…`);
        current = await waitFor(id, ['en_route_pickup', 'en_route_shop']);
        claimed.delete(id);
        if (!current) {
          log(`turned down or cancelled #${id}`);
          continue;
        }
      }
      await deliver(current);
    }
  }

  async function deliver(current) {
    const id = current.id;
    log(`drop off #${id}: ${current.customer_name}, ${current.customer_phone}`);
    self.room = await openRoom(api, user, current.room_id, () => {});
    if (current.status === 'en_route_pickup') {
      await self.car.driveTo({ lat: current.customer_lat, lng: current.customer_lng }, 'the customer');
      await user.must(`/dropoffs/${id}/picked-up`, {});
      log('picked up');
    }
    await self.car.driveTo({ lat: current.shop_lat, lng: current.shop_lng }, current.store_name);
    self.room.close();
    self.room = null;

    const { key } = await user.must(`/dropoffs/${id}/proof-upload`, PROOF_PNG, { raw: true, headers: { 'content-type': 'image/png' } });
    const { dropoff } = await user.must(`/dropoffs/${id}/drop`, { weight_kg: 3.5, laundry_fee: 15000, notes: 'Mock drop off', proof_photo_key: key });
    log(`dropped off: 3.5 kg, laundry fee ${peso(15000)} → ${dropoff.status}`);
    await ownerResponds(id);
  }

  // Not awaited: each driver runs its own loop.
  run().catch((err) => log(`stopped: ${err.message}`));
}

/** Of the free drivers offered request `r`, the one closest to its customer. */
function nearest(r) {
  const offered = drivers.filter((d) => d.free && d.sees.has(r.transaction_id));
  return offered.sort((a, b) => km(a.home, r) - km(b.home, r))[0];
}

let mockOwner = null;

/** The shop's owner (or the test owner, for a shop with none) confirms the drop off. */
async function ownerResponds(id) {
  // id is an integer from the API.
  const [shop] = d1(`SELECT s.id, s.name, s.owner_id FROM transactions_dropoff t JOIN stores s ON s.id = t.store_id WHERE t.id = ${id}`, false);
  let owner;
  if (shop.owner_id === null) {
    mockOwner ??= await testUser(api, OWNER);
    d1(`UPDATE stores SET owner_id = ${mockOwner.user.id} WHERE id = ${shop.id} AND owner_id IS NULL`, false);
    console.log(`[${time()}] ${OWNER.email} now owns ${shop.name} (#${shop.id})`);
    owner = mockOwner;
  } else {
    owner = tokenUser(api, tokenForUser(String(shop.owner_id), 'owner'));
  }
  await sleep(POLL_MS);
  await owner.must(`/owner/transactions/${id}/confirm`, {});
  console.log(`[${time()}] Owner of ${shop.name} (${owner.user.email}) confirmed #${id}`);
  if (markPaid) {
    await owner.must(`/dropoffs/${id}/payment`, { paid: true });
    console.log(`[${time()}] Owner marked #${id} paid`);
  }
}

async function main() {
  const total = Object.keys(VEHICLES).length * PER_VEHICLE;
  let i = 0;
  for (const vehicle of Object.keys(VEHICLES).map(Number)) {
    for (let n = 1; n <= PER_VEHICLE; n++) await startDriver(vehicle, n, spotFor(i++, total));
  }
  console.log(`[${time()}] ${PER_VEHICLE} motorcycle and ${PER_VEHICLE} tricycle drivers waiting around ${lat}, ${lng}. Book a drop off in the customer app. Ctrl+C stops.`);
}

process.on('SIGINT', async () => {
  for (const d of drivers) {
    d.dispatch?.close();
    d.room?.close();
    await d.user.call('/drivers/me/online', { online: false });
  }
  console.log('\nDrivers went offline');
  process.exit(0);
});

main().catch(async (err) => {
  console.error(err.message);
  for (const d of drivers) await d.user.call('/drivers/me/online', { online: false });
  process.exit(1);
});
