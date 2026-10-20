#!/usr/bin/env node
// Plays a food store owner so a customer can test paying for an order with the real app.
// Usage: bun run mock:store-owner <ownerUserId|email> [--api <url>]
// Signs in as that existing owner (local `bun run dev` only: the token is signed with worker/.dev.vars),
// then taps Done Pay on every order at their stores that is waiting for payment. Ctrl+C stops.
import { parseArgs, peso, sleep, time, tokenForUser, usageError } from './lib/mock.js';

const { api, positional } = parseArgs();
const usage = usageError('bun run mock:store-owner <ownerUserId|email> [--api <url>]');
if (!positional[0]) usage('Give the owner user id or email');

const POLL_MS = 5000;

async function main() {
  let owner;
  try {
    owner = tokenForUser(positional[0], 'owner');
  } catch (err) {
    usage(err.message);
  }
  const must = async (path, body) => {
    const res = await fetch(`${api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status >= 400) throw new Error(`${path}: ${res.status} ${data.error ?? ''}`);
    return data;
  };

  console.log(`[${time()}] Signed in as ${owner.user.name} (#${owner.user.id}, ${owner.user.email}). Waiting for payments… Ctrl+C stops.`);
  for (;;) {
    // Newest 50 is plenty for testing; older orders waiting for payment are left alone.
    const { orders } = await must('/owner/orders?limit=50');
    for (const o of orders.filter((x) => x.status === 'awaiting_payment')) {
      const proof = [o.payment_ref && `ref ${o.payment_ref}`, o.payment_photo_key && 'photo'].filter(Boolean).join(' + ');
      console.log(`[${time()}] #${o.id} at ${o.store_name} from ${o.customer_name}: ${peso(o.items_total + o.total_delivery_fee)}, proof: ${proof}`);
      await must(`/owner/orders/${o.id}/confirm-payment`, {});
      console.log(`[${time()}] Done Pay #${o.id}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
