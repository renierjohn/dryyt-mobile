#!/usr/bin/env node
// Plays the driver of a laundry pickup so a customer and a shop owner can test with the real app.
// Usage: bun run mock:driver-pickup-laundry <driverId|email> [orderId] [--speed <km/h>] [--api <url>]
// Signs in as that existing driver (local `bun run dev` only: the token is signed with worker/.dev.vars).
// Waits for a laundry pickup on the job board (the given order, or the first one placed): the customer sends it to the
// shop, the owner sets the laundry fee and taps Done Pay, then the customer taps Place order. The driver then accepts,
// drives from about 1 km away to the shop, picks up the laundry, drives to the customer's pin (sending GPS so the
// customer's map follows) and delivers. Ctrl+C releases the job if it isn't picked up yet.
import { car, openRoom, parseArgs, peso, sleep, time, tokenForUser, tokenUser, usageError } from '../lib/mock.js';

const argv = process.argv.slice(2);
const speedAt = argv.indexOf('--speed');
const speedKmh = speedAt >= 0 ? Number(argv.splice(speedAt, 2)[1]) : 120;
const { api, positional } = parseArgs(argv);
const [driverWho, orderArg] = positional;
const wantedId = orderArg === undefined ? null : Number(orderArg);

const usage = usageError('bun run mock:driver-pickup-laundry <driverId|email> [orderId] [--speed <km/h>] [--api <url>]');
if (!driverWho) usage('Give the driver (user id or email)');
if (wantedId !== null && (!Number.isInteger(wantedId) || wantedId <= 0)) usage('orderId must be a positive integer');
if (!Number.isFinite(speedKmh) || speedKmh <= 0) usage('speed must be a positive number');

const POLL_MS = 3000;
// The driver starts this far (in degrees, ~1 km) from the shop.
const DRIVER_OFFSET = { lat: -0.007, lng: -0.004 };

let driver;
let job = null;

/** The laundry pickup to take: the wanted order once it's on the board, else the oldest laundry pickup there. */
async function waitForJob() {
  console.log(`[${time()}] Waiting for ${wantedId ? `laundry pickup #${wantedId}` : 'a laundry pickup'} on the job board. Ctrl+C stops.`);
  for (;;) {
    const { jobs } = await driver.must('/jobs/available');
    const found = jobs.find((j) => j.store_type === 'laundry' && (wantedId === null || j.id === wantedId));
    if (found) return found;
    await sleep(POLL_MS);
  }
}

async function main() {
  try {
    driver = tokenUser(api, tokenForUser(driverWho, 'driver'));
  } catch (err) {
    usage(err.message);
  }
  const busy = (await driver.must('/jobs/active')).job;
  if (busy) usage(`Driver already has pickup job #${busy.id} (${busy.status}); finish or release it first`);

  process.on('SIGINT', async () => {
    if (job?.status === 'accepted') {
      const res = await driver.call(`/jobs/${job.id}/release`, {});
      console.log(res.status < 400 ? `\nReleased job #${job.id}` : `\nCould not release: ${res.data.error}`);
    }
    process.exit(0);
  });

  const found = await waitForJob();
  if (found.customer_lat === null || found.store_lat === null) usage(`Order #${found.id} has no customer pin or shop location`);
  ({ job } = await driver.must(`/jobs/${found.id}/accept`, {}));
  console.log(
    `[${time()}] ${driver.user.name} accepted #${job.id} at ${job.store_name}: laundry ${peso(job.items_total)}, you earn ${peso(job.delivery_fee)}`,
  );
  if (job.notes) console.log(`[${time()}] Note: ${job.notes}`);

  const shop = { lat: job.store_lat, lng: job.store_lng };
  const home = { lat: job.customer_lat, lng: job.customer_lng };
  let room = null;
  const trip = car({ lat: shop.lat + DRIVER_OFFSET.lat, lng: shop.lng + DRIVER_OFFSET.lng }, speedKmh, () => room);
  await trip.driveTo(shop, job.store_name);
  ({ job } = await driver.must(`/jobs/${job.id}/status`, { status: 'picked_up' }));
  console.log(`[${time()}] Picked up the laundry`);

  room = await openRoom(api, driver, `order-${job.id}`, () => {});
  await trip.driveTo(home, job.customer_name ?? 'the customer');
  room.close();
  room = null;
  ({ job } = await driver.must(`/jobs/${job.id}/status`, { status: 'delivered' }));
  console.log(`[${time()}] Delivered #${job.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
