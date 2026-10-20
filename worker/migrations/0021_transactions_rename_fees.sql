-- Drop offs and pickups both become transactions; a pickup's delivery fee splits like a drop off's:
-- delivery_fee is the driver's share, service_fee the app's cut, total_delivery_fee what the customer pays.
-- RENAME rewrites the foreign keys pointing at them (owner_transactions, payouts, order_items).
ALTER TABLE transactions RENAME TO transactions_dropoff;
ALTER TABLE orders RENAME TO transactions_pickup;

-- road_km is null for typed-address (flat-fee) pickups and ones placed before this migration.
ALTER TABLE transactions_pickup ADD COLUMN total_delivery_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions_pickup ADD COLUMN road_km REAL;
UPDATE transactions_pickup SET total_delivery_fee = delivery_fee, delivery_fee = delivery_fee - service_fee;
