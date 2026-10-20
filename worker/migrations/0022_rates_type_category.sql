-- A rate per service (type) and vehicle (category) inside each area: pickups and drop offs are priced separately, and
-- each vehicle kind can have its own fees. category is text here; 0023 turns it into an integer code.
-- Bookings use motorcycle until customers can pick a vehicle.
CREATE TABLE rates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  category TEXT NOT NULL DEFAULT 'motorcycle',
  base_fee INTEGER NOT NULL,
  rate_per_km INTEGER NOT NULL,
  commission_pct REAL NOT NULL,
  UNIQUE (group_id, type, category)
);
-- Each area's current rate becomes its motorcycle rate for both services.
INSERT INTO rates_new (id, group_id, type, base_fee, rate_per_km, commission_pct)
  SELECT id, group_id, 'dropoff', base_fee, rate_per_km, commission_pct FROM rates;
INSERT INTO rates_new (group_id, type, base_fee, rate_per_km, commission_pct)
  SELECT group_id, 'pickup', base_fee, rate_per_km, commission_pct FROM rates;
DROP TABLE rates;
ALTER TABLE rates_new RENAME TO rates;
