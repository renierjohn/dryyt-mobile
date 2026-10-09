/**
 * Pickup (food/laundry from a store to the customer) is switched off while Drop off ships first: its screens are
 * unreachable and its queries never run. The worker refuses /orders and /jobs too (PICKUP_ENABLED in wrangler.jsonc);
 * turn both on together.
 */
export const PICKUP_ENABLED = false;
