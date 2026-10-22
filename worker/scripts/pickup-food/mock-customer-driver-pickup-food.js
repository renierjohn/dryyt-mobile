#!/usr/bin/env node
// Plays the customer and the driver of a food pickup order so a store owner can test with the real app.
// Usage: bun run mock:customer-driver-pickup-food <customerId|email> <driverId|email> <storeId> [--speed <km/h>] [--api <url>]
// Signs in as both existing users (local `bun run dev` only: tokens are signed with worker/.dev.vars).
// The customer orders the store's first two menu items from about 1.5 km away and pays with a reference number and a
// photo, then waits for the owner to tap Done Pay in the app. Once confirmed, the customer places the order and the
// driver accepts it, drives to the store, picks it up, drives to the customer (sending GPS every 3 s) and delivers.
// Ctrl+C cancels the order (or releases the driver's job) if it's still early enough.
import { readFileSync } from 'node:fs';

import { car, d1, openRoom, parseArgs, peso, sleep, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, positional } = parseArgs(argv);
const [customerWho, driverWho, storeArg] = positional;
const storeId = Number(storeArg);

const usage = usageError('bun run mock:customer-driver-pickup-food <customerId|email> <driverId|email> <storeId> [--speed <km/h>] [--api <url>]');
if (!customerWho || !driverWho) usage('Give the customer and the driver (user id or email)');
if (!Number.isInteger(storeId) || storeId <= 0) usage('storeId must be a positive integer');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

const POLL_MS = 3000;
// The app logo stands in for the payment screenshot, so the owner app has a real image to show.
const PAYMENT_PNG = readFileSync(new URL('../../../assets/images/logo@3x.png', import.meta.url));
// The customer and the driver start this far (in degrees, ~1.5 km and ~1 km) from the store.
const CUSTOMER_OFFSET = { lat: 0.01, lng: 0.01 };
const DRIVER_OFFSET = { lat: -0.007, lng: -0.004 };

let customer;
let driver;
let order = null;

async function orderStatus() {
  order = (await customer.must(`/orders/${order.id}`)).order;
  return order.status;
}

async function waitFor(statuses, onChange) {
  let last = null;
  for (;;) {
    const status = await orderStatus();
    if (status !== last) {
      last = status;
      onChange?.(status);
    }
    if (statuses.includes(status)) return status;
    await sleep(POLL_MS);
  }
}

async function main() {
  try {
    customer = tokenUser(api, tokenForUser(customerWho, 'customer'));
    driver = tokenUser(api, tokenForUser(driverWho, 'driver'));
  } catch (err) {
    usage(err.message);
  }

  // storeId is an integer, so it's safe to inline.
  const [store] = d1(`SELECT id, name, lat, lng, owner_id FROM stores WHERE id = ${storeId} AND type = 'food'`, false);
  if (!store) usage(`No food store with id ${storeId}`);
  if (store.lat === null || store.lng === null) usage(`${store.name} has no map location yet`);
  if (store.owner_id === null) console.log(`Note: ${store.name} has no owner, so nobody can confirm the payment. Link one with bun run shop:set.`);
  const menu = d1(`SELECT id, name FROM store_menu_items WHERE store_id = ${storeId} ORDER BY sort_order, id LIMIT 2`, false);
  if (menu.length === 0) usage(`${store.name} has no menu items`);

  const busy = (await driver.must('/jobs/active')).job;
  if (busy) usage(`Driver already has pickup job #${busy.id} (${busy.status}); finish or release it first`);
  // Accepting flips drivers.busy, so the driver needs a free row there (a drop off in progress also counts).
  const [state] = d1(`SELECT busy FROM drivers WHERE user_id = ${driver.user.id}`, false);
  if (!state) usage(`Driver #${driver.user.id} has no drivers row yet; go online once in the driver app`);
  if (state.busy) usage(`Driver #${driver.user.id} is busy with another job`);

  const at = { lat: store.lat + CUSTOMER_OFFSET.lat, lng: store.lng + CUSTOMER_OFFSET.lng };
  const { key } = await customer.must('/orders/payment-photo', PAYMENT_PNG, { raw: true, headers: { 'content-type': 'image/png' } });
  ({ order } = await customer.must('/orders', {
    type: 'pickup',
    store_id: storeId,
    items: menu.map((m, i) => ({ menu_item_id: m.id, qty: i + 1 })),
    ...at,
    notes: 'Mock pickup order',
    payment_ref: `MOCK-${Date.now()}`,
    payment_photo_key: key,
  }));
  console.log(`[${time()}] ${customer.user.name} ordered #${order.id} at ${store.name}: ${order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`);
  console.log(`[${time()}] Items ${peso(order.items_total)} + delivery ${peso(order.total_delivery_fee)}. Tap Done Pay in the owner app. Ctrl+C cancels.`);

  process.on('SIGINT', async () => {
    if (['awaiting_payment', 'payment_confirmed', 'pending'].includes(order.status)) {
      const res = await customer.call(`/orders/${order.id}/cancel`, {});
      console.log(res.status < 400 ? `\nCancelled order #${order.id}` : `\nCould not cancel: ${res.data.error}`);
    } else if (order.status === 'accepted') {
      const res = await driver.call(`/jobs/${order.id}/release`, {});
      console.log(res.status < 400 ? `\nReleased job #${order.id}` : `\nCould not release: ${res.data.error}`);
    }
    process.exit(0);
  });

  if ((await waitFor(['payment_confirmed', 'cancelled'])) === 'cancelled') return console.log(`[${time()}] Order #${order.id} was cancelled`);
  console.log(`[${time()}] Payment confirmed`);
  ({ order } = await customer.must(`/orders/${order.id}/place`, {}));
  console.log(`[${time()}] Placed: waiting for a driver`);

  ({ job: order } = await driver.must(`/jobs/${order.id}/accept`, {}));
  console.log(`[${time()}] ${driver.user.name} accepted #${order.id}`);

  let room = null;
  const trip = car({ lat: store.lat + DRIVER_OFFSET.lat, lng: store.lng + DRIVER_OFFSET.lng }, speedKmh, () => room);
  await trip.driveTo({ lat: store.lat, lng: store.lng }, store.name);
  ({ job: order } = await driver.must(`/jobs/${order.id}/status`, { status: 'picked_up' }));
  console.log(`[${time()}] Picked up`);

  room = await openRoom(api, driver, `order-${order.id}`, () => {});
  await trip.driveTo(at, customer.user.name);
  room.close();
  room = null;
  ({ job: order } = await driver.must(`/jobs/${order.id}/status`, { status: 'delivered' }));
  console.log(`[${time()}] Delivered #${order.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
