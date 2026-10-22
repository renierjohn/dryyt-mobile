#!/usr/bin/env node
// Plays the laundry shop owner so customers and drivers can test with the real app.
// Usage: bun run mock:owner <storeId> [--paid] [--api <url>] [--remote]
// Links a test owner to the shop (if the shop has no owner yet), then confirms every
// drop off that arrives. With --paid it also marks it paid, completing the drop off.
// --remote links the owner in the deployed D1; use it together with --api.
import { d1, parseArgs, peso, sleep, testUser, time, usageError } from '../lib/mock.js';

const { api, flags, positional } = parseArgs();
const storeId = Number(positional[0]);
const remote = flags.has('--remote');
const markPaid = flags.has('--paid');

const usage = usageError('bun run mock:owner <storeId> [--paid] [--api <url>] [--remote]');
if (!Number.isInteger(storeId) || storeId <= 0) usage('storeId must be a positive integer');

// Test-only account; override with MOCK_OWNER_EMAIL / MOCK_OWNER_PASSWORD.
const OWNER = {
  email: process.env.MOCK_OWNER_EMAIL ?? 'mock.owner@dryyt.test',
  password: process.env.MOCK_OWNER_PASSWORD ?? 'mock-owner-pass',
  name: 'Mock Owner',
  phone: '09170000002',
  role: 'owner',
};
const POLL_MS = 5000;

async function main() {
  const user = await testUser(api, OWNER);

  // storeId and user.id are integers, so they're safe to inline.
  const [shop] = d1(`SELECT id, name, owner_id FROM stores WHERE id = ${storeId} AND type = 'laundry'`, remote);
  if (!shop) usage(`No laundry shop with id ${storeId}`);
  if (shop.owner_id !== null && shop.owner_id !== user.user.id) {
    usage(`${shop.name} already belongs to user #${shop.owner_id}; pick a shop without an owner`);
  }
  d1(`UPDATE stores SET owner_id = ${user.user.id} WHERE id = ${storeId}`, remote);
  console.log(`[${time()}] ${OWNER.email} owns ${shop.name} (#${storeId}). Waiting for drop offs… Ctrl+C stops.`);

  for (;;) {
    const { dropoffs } = await user.must('/owner/transactions?status=pending');
    for (const d of dropoffs) {
      console.log(`[${time()}] #${d.id} from ${d.customer_name} by ${d.driver_name}: ${d.weight_kg} kg, laundry fee ${peso(d.laundry_fee)}`);
      await user.must(`/owner/transactions/${d.id}/confirm`, {});
      console.log(`[${time()}] Confirmed #${d.id}`);
      if (markPaid) {
        await user.must(`/dropoffs/${d.id}/payment`, { paid: true });
        console.log(`[${time()}] Marked #${d.id} paid`);
      }
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
