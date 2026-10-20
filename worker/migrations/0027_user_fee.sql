-- The app's fee for a shop owner, per store (moved onto stores in 0028). fee_type 1 = flat: fee_flat (centavos) per store.
-- fee_type 2 = percentage: fee_percentage % of each store's order total (delivered pickups' items + completed drop offs' laundry fee).
ALTER TABLE users ADD COLUMN fee_type INTEGER NOT NULL DEFAULT 1 CHECK (fee_type IN (1, 2));
ALTER TABLE users ADD COLUMN fee_flat INTEGER NOT NULL DEFAULT 0 CHECK (fee_flat >= 0);
ALTER TABLE users ADD COLUMN fee_percentage REAL NOT NULL DEFAULT 0 CHECK (fee_percentage >= 0 AND fee_percentage <= 100);
