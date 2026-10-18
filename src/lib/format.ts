import type { DropoffStatus, Order, OrderStatus } from './types';

/** Centavos as pesos with thousands commas, e.g. 123456 → "₱1,234.56". */
export const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A menu price (centavos) after its percent discount; matches the worker's checkout math. */
/** Every computed amount is rounded up to a whole peso (centavos always 00); same as the worker's roundUpToPeso. */
export const roundUpToPeso = (centavos: number) => Math.ceil(Math.round(centavos) / 100) * 100;

/** Mirrors the worker: the price after its percent discount, rounded up to a whole peso. */
export const discountedPrice = (item: { price: number; discount_percent: number }) => roundUpToPeso((item.price * (100 - item.discount_percent)) / 100);

/** D1's `datetime('now')` text ("2026-10-13 05:45:53", UTC) in epoch ms; NaN when unparseable. */
export const d1Time = (d1Utc: string) => new Date(`${d1Utc.replace(' ', 'T')}Z`).getTime();

/** The local calendar day of D1 UTC text, for grouping; the input itself when unparseable. */
export function localDay(d1Utc: string) {
  const date = new Date(d1Time(d1Utc));
  return Number.isNaN(date.getTime()) ? d1Utc : date.toDateString();
}

/** The local day of D1 UTC text as e.g. "Sat, Oct 17, 2026", for date group titles; the input itself when unparseable. */
export function dayLabel(d1Utc: string) {
  const date = new Date(d1Time(d1Utc));
  if (Number.isNaN(date.getTime())) return d1Utc;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** D1's `datetime('now')` text ("2026-10-13 05:45:53", UTC) as local time, e.g. "Oct 13, 2026, 1:45 PM". */
export function dateTime(d1Utc: string) {
  const date = new Date(d1Time(d1Utc));
  if (Number.isNaN(date.getTime())) return d1Utc;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Waiting for the store to confirm payment',
  payment_confirmed: 'Payment confirmed',
  pending: 'Waiting for a driver',
  accepted: 'Driver accepted',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function orderTitle(order: Pick<Order, 'store_type'>) {
  return order.store_type === 'food' ? 'Food/Beverages pickup' : 'Laundry pickup';
}

/** Where the driver collects (`from`) and where they finish (`to`). */
export function route(order: Order) {
  return { from: order.store_address, to: order.customer_address };
}

export const DROPOFF_STATUS_LABEL: Record<DropoffStatus, string> = {
  searching: 'Finding a driver',
  driver_accepted: 'Driver accepted',
  en_route_pickup: 'Driver on the way to you',
  en_route_shop: 'On the way to the shop',
  dropped_off: 'At the shop',
  owner_confirmed: 'Shop confirmed',
  completed: 'Completed',
  payment_pending: 'Payment pending',
  cancelled: 'Cancelled',
  expired: 'No driver found',
};
