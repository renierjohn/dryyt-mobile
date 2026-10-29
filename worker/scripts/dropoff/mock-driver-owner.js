#!/usr/bin/env node
// Plays every side of a drop off except the customer, so a real customer can test the app end to end.
// Usage: bun run mock:driver-owner-dropoff [--api <url>] [--speed <km/h>] [--paid]
// Puts 5 random existing drivers (verified, not blocked, not busy, with a vehicle) online at random spots in inland Dauin
// (clear of the sea). When the customer books a drop off at any laundry shop, the nearest waiting driver of the booked vehicle
// counts down 5 s, accepts, drives to the customer and on to the shop (GPS every 3 s), and drops off with a proof photo.
// The shop's owner then confirms it (a shop without an owner is linked to the test owner); with --paid the owner also
// marks it paid. The driver then goes back to its spot and waits again. Ctrl+C puts the drivers' Online back as it was.
// Signs everyone in with worker/.dev.vars JWT_SECRET and reads local D1, so it works against `bun run dev` only.
import { readFileSync } from 'node:fs';

import { car, d1, km, openRoom, parseArgs, peso, sleep, testUser, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, flags } = parseArgs(argv);
const markPaid = flags.has('--paid');

const usage = usageError('bun run mock:driver-owner-dropoff [--api <url>] [--speed <km/h>] [--paid]');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

const DRIVERS = 5;
const COUNTDOWN_S = 5;
// Test-only account, for shops with no owner.
const OWNER = { email: 'mock.owner@dryyt.test', password: 'mock-owner-pass', name: 'Mock Owner', phone: '09170000002', role: 'owner' };
const TICK_MS = 3000; // above the server's 2 s location limit
const POLL_MS = 3000;

// The app logo stands in for the proof photo, so the owner app has a real image to show.
const PROOF_PNG = readFileSync(new URL('../../../assets/images/logo@3x.png', import.meta.url));

/** Drop offs a mock driver has accepted, so the others don't race it. */
const claimed = new Set();
const drivers = [];

/** Inland Dauin around the town proper (the cpanel's default map center, 9.1906, 123.2669), clear of the sea to the east. */
const DAUIN = { minLat: 9.175, maxLat: 9.205, minLng: 123.245, maxLng: 123.266 };
const random = (min, max) => min + Math.random() * (max - min);
/** A random spot in Dauin, so drivers show as separate pins. */
const spot = () => ({ lat: +random(DAUIN.minLat, DAUIN.maxLat).toFixed(6), lng: +random(DAUIN.minLng, DAUIN.maxLng).toFixed(6) });

async function startDriver(row, home) {
  const user = tokenUser(api, tokenForUser(String(row.id), 'driver'));
  await user.must('/drivers/me/online', { online: true });
  const self = { user, name: row.name, vehicle: row.vehicle_type, wasOnline: row.online === 1, home, room: null, free: false, sees: new Set() };
  self.car = car(home, speedKmh, () => self.room);
  drivers.push(self);
  const log = (msg) => console.log(`[${time()}] ${row.name}: ${msg}`);
  log(`online (vehicle ${row.vehicle_type})`);

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
        self.free = false;
        log(`request #${r.transaction_id} to ${r.store_name}, ${r.distance_km} km away. Accepting in…`);
        countdown(r.transaction_id).then(() => dispatch.send({ t: 'accept', transaction_id: r.transaction_id }));
      } else if (msg.t === 'accepted') accepted = msg.transaction_id;
      else if (msg.t === 'taken' && claimed.has(msg.transaction_id) && !accepted) {
        // Someone else (a real driver) took it during the countdown.
        claimed.delete(msg.transaction_id);
        self.free = true;
      } else if (msg.t === 'error') {
        log(msg.message);
        self.free = true;
      }
    });
    async function countdown(id) {
      for (let s = COUNTDOWN_S; s > 0; s--) {
        console.log(`[${time()}] ${row.name}:   ${s} (#${id})`);
        await sleep(1000);
      }
    }
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
  const rows = d1(
    `SELECT u.id, u.name, dd.vehicle_type, d.online
     FROM users u JOIN drivers d ON d.user_id = u.id JOIN driver_data dd ON dd.user_id = u.id
     WHERE u.role = 'driver' AND u.blocked = 0 AND dd.status = 1 AND dd.vehicle_type IS NOT NULL AND d.busy = 0
     ORDER BY RANDOM() LIMIT ${DRIVERS}`,
    false,
  );
  if (rows.length === 0) usage('No verified, free driver in local D1');
  for (const row of rows) await startDriver(row, spot());
  console.log(`[${time()}] ${rows.length} drivers waiting in Dauin. Book a drop off in the customer app. Ctrl+C stops.`);
}

process.on('SIGINT', async () => {
  for (const d of drivers) {
    d.dispatch?.close();
    d.room?.close();
    await d.user.call('/drivers/me/online', { online: d.wasOnline });
  }
  console.log('\nDrivers back to their Online setting');
  process.exit(0);
});

main().catch(async (err) => {
  console.error(err.message);
  for (const d of drivers) await d.user.call('/drivers/me/online', { online: d.wasOnline });
  process.exit(1);
});
