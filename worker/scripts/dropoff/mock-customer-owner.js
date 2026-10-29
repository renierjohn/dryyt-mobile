#!/usr/bin/env node
// Plays the customers and the shop owners of drop offs, so a real driver can test the app end to end.
// Usage: bun run mock:customer-owner [--vehicle <1-4>] [--paid] [--api <url>]
// Picks 5 random existing customers (not usera@gmail.com). Each books a drop off from a random spot in Dauin to a random laundry shop
// (--vehicle sets the booked vehicle, default 2 motorcycle; it must match the driver's), confirms the driver who
// accepts, and books again if nobody accepts in time. Once the driver drops the laundry off, the shop's owner confirms
// it (a shop without an owner is linked to the test owner); with --paid the owner also marks it paid.
// Ctrl+C cancels the bookings no driver has picked up yet.
// Signs in with worker/.dev.vars JWT_SECRET and reads local D1, so it works against `bun run dev` only.
import { d1, parseArgs, peso, sleep, testUser, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const vehicleAt = argv.indexOf('--vehicle');
const vehicle = vehicleAt >= 0 ? Number(argv.splice(vehicleAt, 2)[1]) : 2;
const { api, flags } = parseArgs(argv);
const markPaid = flags.has('--paid');

const usage = usageError('bun run mock:customer-owner [--vehicle <1-4>] [--paid] [--api <url>]');
if (![1, 2, 3, 4].includes(vehicle)) usage('vehicle must be 1 (bicycle), 2 (motorcycle), 3 (tricycle) or 4 (car)');

const CUSTOMERS = 5;
/** Real accounts the mock never books for. */
const EXCLUDED_EMAILS = ['usera@gmail.com'];
/** Inland Dauin around the town proper (the cpanel's default map center, 9.1906, 123.2669), clear of the sea to the east. */
const DAUIN = { minLat: 9.175, maxLat: 9.205, minLng: 123.245, maxLng: 123.266 };
// Test-only account, for shops with no owner.
const OWNER = { email: 'mock.owner@dryyt.test', password: 'mock-owner-pass', name: 'Mock Owner', phone: '09170000002', role: 'owner' };
const POLL_MS = 3000;
const ACTIVE = ['searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop'];
/** Still cancellable on Ctrl+C. */
const CANCELLABLE = ['searching', 'driver_accepted', 'en_route_pickup'];

const random = (min, max) => min + Math.random() * (max - min);
const spot = () => ({ lat: +random(DAUIN.minLat, DAUIN.maxLat).toFixed(6), lng: +random(DAUIN.minLng, DAUIN.maxLng).toFixed(6) });
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const shops = d1("SELECT id, name, owner_id FROM stores WHERE type = 'laundry' AND lat IS NOT NULL AND lng IS NOT NULL", false);
if (shops.length === 0) usage('No laundry shop with a pin in local D1');
// Customers without an active drop off (one each at a time).
const customers = d1(
  `SELECT id FROM users u WHERE role = 'customer' AND blocked = 0 AND email NOT IN (${EXCLUDED_EMAILS.map((e) => `'${e}'`).join(', ')})
     AND NOT EXISTS (SELECT 1 FROM transactions_dropoff t WHERE t.customer_id = u.id AND t.status IN (${ACTIVE.map((s) => `'${s}'`).join(', ')}))
   ORDER BY RANDOM() LIMIT ${CUSTOMERS}`,
  false,
);
if (customers.length === 0) usage('No customer free to book in local D1');

/** Bookings to cancel on Ctrl+C: customer → { user, id }. */
const open = new Map();
let mockOwner = null;

/** The shop's owner (or the test owner, for a shop with none). */
async function ownerOf(shop) {
  const [row] = d1(`SELECT owner_id FROM stores WHERE id = ${shop.id}`, false);
  if (row.owner_id !== null) return tokenUser(api, tokenForUser(String(row.owner_id), 'owner'));
  mockOwner ??= await testUser(api, OWNER);
  d1(`UPDATE stores SET owner_id = ${mockOwner.user.id} WHERE id = ${shop.id} AND owner_id IS NULL`, false);
  console.log(`[${time()}] ${OWNER.email} now owns ${shop.name} (#${shop.id})`);
  return mockOwner;
}

async function runCustomer({ id }) {
  const user = tokenUser(api, tokenForUser(String(id), 'customer'));
  const who = user.user.name || user.user.email;
  const log = (msg) => console.log(`[${time()}] ${who}: ${msg}`);

  for (;;) {
    const shop = pick(shops);
    const at = spot();
    const { quote } = await user.must('/dropoffs/quote', { store_id: shop.id, ...at });
    const option = quote.options.find((o) => o.vehicle_type === vehicle);
    if (!option) return log(`${shop.name} has no rate for vehicle ${vehicle}; stopping`);
    let { dropoff: d } = await user.must('/dropoffs', { store_id: shop.id, ...at, vehicle_type: vehicle, quote_token: quote.token });
    open.set(id, { user, id: d.id });
    log(`booked #${d.id} from ${at.lat}, ${at.lng} to ${shop.name}, ${quote.road_km.toFixed(1)} km, ${peso(option.total_delivery_fee)}`);

    let last = d.status;
    while (ACTIVE.includes(d.status)) {
      await sleep(POLL_MS);
      d = (await user.must(`/dropoffs/${d.id}`)).dropoff;
      if (d.status === last) continue;
      last = d.status;
      if (d.status === 'driver_accepted') {
        log(`${d.driver_name} accepted #${d.id}. Confirming.`);
        const res = await user.call(`/dropoffs/${d.id}/confirm-driver`, {});
        if (res.status >= 400) log(`confirm failed: ${res.data.error ?? res.status}`);
      } else log(`#${d.id} ${d.status.replaceAll('_', ' ')}`);
    }
    open.delete(id);

    if (d.status === 'dropped_off') {
      const owner = await ownerOf(shop);
      await sleep(POLL_MS);
      await owner.must(`/owner/transactions/${d.id}/confirm`, {});
      log(`owner of ${shop.name} confirmed #${d.id}`);
      if (markPaid) {
        await owner.must(`/dropoffs/${d.id}/payment`, { paid: true });
        log(`owner marked #${d.id} paid`);
      }
      return;
    }
    // Nobody accepted in time (or the driver cancelled): book again.
    if (d.status === 'expired' || d.status === 'cancelled') continue;
    return;
  }
}

process.on('SIGINT', async () => {
  for (const { user, id } of open.values()) {
    const d = (await user.call(`/dropoffs/${id}`)).data.dropoff;
    if (d && CANCELLABLE.includes(d.status)) {
      await user.call(`/dropoffs/${id}/cancel`, {});
      console.log(`Cancelled #${id}`);
    }
  }
  process.exit(0);
});

console.log(`[${time()}] ${customers.length} customers booking drop offs in Dauin for vehicle ${vehicle}. Go online in the driver app. Ctrl+C stops.`);
await Promise.all(customers.map((c) => runCustomer(c).catch((err) => console.error(`[${time()}] customer #${c.id}: ${err.message}`))));
console.log(`[${time()}] All done.`);
