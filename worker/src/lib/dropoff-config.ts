export const SEARCH_TIMEOUT_MS = 3 * 60_000;
export const CONFIRM_TIMEOUT_MS = 60_000;
/** A driver the customer turned down can't take that customer's drop offs for this long. */
export const REJECT_COOLDOWN_MS = 5 * 60_000;
export const NO_LOCATION_WARN_MS = 2 * 60_000;
export const OWNER_REMINDER_MS = 30 * 60_000;
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
