#!/usr/bin/env node
// Plays the customer side of a drop off so a driver can test with the real app.
// Usage: bun run mock:customer <storeId> <lat> <lng> [--user <customerId|email>] [--api <url>]
// Signs in as --user (an existing customer, local `bun run dev` only) or else the test customer
// (created on first run), requests a drop off at lat/lng,
// prints status changes, confirms the driver as soon as one accepts, and cancels on Ctrl+C.
import { appApiUrl, tokenForUser } from './lib/mock.js';

const args = process.argv.slice(2);
const userAt = args.indexOf('--user');
const asUser = userAt >= 0 ? (args.splice(userAt, 2)[1] ?? '') : null;
const apiAt = args.indexOf('--api');
const API = apiAt >= 0 ? args.splice(apiAt, 2)[1] : appApiUrl();
console.log(`Worker: ${API}`);
const [storeId, lat, lng] = args.map(Number);

const usage = (msg) => {
  console.error(`${msg}\nUsage: bun run mock:customer <storeId> <lat> <lng> [--user <customerId|email>] [--api <url>]`);
  process.exit(1);
};
if (asUser === '' || asUser?.startsWith('--')) usage('--user needs a customer id or email');
if (!Number.isInteger(storeId) || storeId <= 0) usage('storeId must be a positive integer');
if (!Number.isFinite(lat) || lat < -90 || lat > 90) usage('lat must be between -90 and 90');
if (!Number.isFinite(lng) || lng < -180 || lng > 180) usage('lng must be between -180 and 180');

// Test-only account; override with MOCK_CUSTOMER_EMAIL / MOCK_CUSTOMER_PASSWORD.
const CUSTOMER = {
  email: process.env.MOCK_CUSTOMER_EMAIL ?? 'mock.customer@dryyt.test',
  password: process.env.MOCK_CUSTOMER_PASSWORD ?? 'mock-customer-pass',
  name: 'Mock Customer',
  phone: '09170000000',
  role: 'customer',
};
const POLL_MS = 5000;

let token = null;

async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function must(path, body) {
  const res = await call(path, body);
  if (res.status >= 400) throw new Error(`${path}: ${res.status} ${res.data.error ?? ''}`);
  return res.data;
}

async function signIn() {
  if (asUser) {
    const { token: signed, user } = tokenForUser(asUser, 'customer');
    console.log(`Acting as customer #${user.id} ${user.name} <${user.email}>`);
    return signed;
  }
  const login = await call('/auth/login', { email: CUSTOMER.email, password: CUSTOMER.password });
  if (login.status === 200) return login.data.token;
  console.log(`Creating test customer ${CUSTOMER.email}`);
  return (await must('/auth/register', CUSTOMER)).token;
}

// The driver's part ends at dropped_off.
const DONE = ['dropped_off', 'owner_confirmed', 'completed', 'payment_pending', 'cancelled', 'expired'];

async function main() {
  token = await signIn();

  // One active drop off per customer. The test customer's leftovers are cancelled; a real
  // customer's are left alone (cancel it in the app first).
  const { dropoffs } = await must('/dropoffs');
  for (const old of dropoffs.filter((d) => !DONE.includes(d.status))) {
    if (asUser) usage(`Customer already has active drop off #${old.id} (${old.status}); finish or cancel it first`);
    await call(`/dropoffs/${old.id}/cancel`, {});
    console.log(`Cancelled leftover drop off #${old.id}`);
  }

  let { dropoff } = await must('/dropoffs', { store_id: storeId, lat, lng });
  console.log(`Drop off #${dropoff.id} to ${dropoff.store_name}: ${dropoff.road_km} km, fee ₱${(dropoff.total_delivery_fee / 100).toFixed(2)}`);
  console.log('Waiting for a driver. Accept it in the driver app. Ctrl+C cancels.');

  process.on('SIGINT', async () => {
    if (!DONE.includes(dropoff.status)) {
      const res = await call(`/dropoffs/${dropoff.id}/cancel`, {});
      console.log(res.status < 400 ? `\nCancelled drop off #${dropoff.id}` : `\nCould not cancel: ${res.data.error}`);
    }
    process.exit(0);
  });

  let last = null;
  for (;;) {
    ({ dropoff } = await must(`/dropoffs/${dropoff.id}`));
    if (dropoff.status !== last) {
      last = dropoff.status;
      console.log(`[${new Date().toLocaleTimeString()}] ${dropoff.status}${dropoff.driver_name ? ` (driver: ${dropoff.driver_name})` : ''}`);
      if (dropoff.status === 'driver_accepted') {
        await must(`/dropoffs/${dropoff.id}/confirm-driver`, {});
        console.log('Confirmed driver');
      }
      if (DONE.includes(dropoff.status)) break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
