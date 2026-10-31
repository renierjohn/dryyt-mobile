-- When the order room last flagged the assigned driver as silent (no app heartbeat or location for 10 min). The customer
-- may then cancel an accepted order or send it back to the drivers. Cleared when the driver is heard from again.
ALTER TABLE transactions_pickup ADD COLUMN driver_silent_at TEXT;
