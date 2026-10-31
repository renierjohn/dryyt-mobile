export const SEARCH_TIMEOUT_MS = 3 * 60_000;
export const CONFIRM_TIMEOUT_MS = 60_000;
/** A driver the customer turned down can't take that customer's drop offs for this long. */
export const REJECT_COOLDOWN_MS = 5 * 60_000;
export const NO_LOCATION_WARN_MS = 2 * 60_000;
export const OWNER_REMINDER_MS = 30 * 60_000;
/** Food pickup: the owner is reminded to review the proof of payment this often without Done Pay… */
export const PAYMENT_REMINDER_MS = 60_000;
/** …up to this many times. */
export const PAYMENT_REMINDERS = 10;
/** Food pickup: still no Done Pay one interval after the last reminder → the payment is accepted for the owner. */
export const PAYMENT_AUTO_CONFIRM_MS = (PAYMENT_REMINDERS + 1) * PAYMENT_REMINDER_MS;
/** Pickup: a driver on an order whose app hasn't been heard from (socket heartbeat or location) for this long is warned… */
export const PICKUP_DRIVER_WARN_MS = 5 * 60_000;
/** …and after this long is taken off it (accepted: back to the board) or reported (picked up: customer and owner pushed). */
export const PICKUP_DRIVER_GONE_MS = 10 * 60_000;
/** Drivers without a location for this long are hidden from customers. */
export const DRIVER_STALE_MS = 30_000;
/** Location messages faster than this are dropped. */
export const LOCATION_MIN_INTERVAL_MS = 2_000;
/** Trip clients send {"t":"ping"} this often; the room answers without waking up. */
export const HEARTBEAT_MS = 10_000;
/**
 * A customer not seen on the trip socket for this long counts as offline (the driver may cancel).
 * Long on purpose: covers a dropped connection or a switch to mobile data while they reconnect.
 */
export const CUSTOMER_OFFLINE_MS = 5 * 60_000;
