-- The app fee is set per store, not per owner: move 0027's columns from users to stores (each store starts with its
-- owner's setting). fee_type 1 = flat: fee_flat (centavos). fee_type 2 = percentage: fee_percentage % of the store's
-- order total (delivered pickups' items + completed drop offs' laundry fee).
ALTER TABLE stores ADD COLUMN fee_type INTEGER NOT NULL DEFAULT 1 CHECK (fee_type IN (1, 2));
ALTER TABLE stores ADD COLUMN fee_flat INTEGER NOT NULL DEFAULT 0 CHECK (fee_flat >= 0);
ALTER TABLE stores ADD COLUMN fee_percentage REAL NOT NULL DEFAULT 0 CHECK (fee_percentage >= 0 AND fee_percentage <= 100);
UPDATE stores SET
  fee_type = (SELECT fee_type FROM users WHERE id = stores.owner_id),
  fee_flat = (SELECT fee_flat FROM users WHERE id = stores.owner_id),
  fee_percentage = (SELECT fee_percentage FROM users WHERE id = stores.owner_id)
WHERE owner_id IS NOT NULL;
ALTER TABLE users DROP COLUMN fee_type;
ALTER TABLE users DROP COLUMN fee_flat;
ALTER TABLE users DROP COLUMN fee_percentage;
