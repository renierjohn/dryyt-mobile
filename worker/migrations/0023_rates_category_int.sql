-- rates.category becomes a vehicle code: 1 bicycle, 2 motorcycle (default), 3 tricycle, 4 car (lightweight).
-- No CHECK, so new vehicle codes need no rebuild; the worker validates it (VEHICLE_CATEGORIES in src/lib/fees.ts).
CREATE TABLE rates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  category INTEGER NOT NULL DEFAULT 2,
  base_fee INTEGER NOT NULL,
  rate_per_km INTEGER NOT NULL,
  commission_pct REAL NOT NULL,
  UNIQUE (group_id, type, category)
);
INSERT INTO rates_new (id, group_id, type, category, base_fee, rate_per_km, commission_pct)
  SELECT id, group_id, type,
    CASE category WHEN 'bicycle' THEN 1 WHEN 'motorcycle' THEN 2 WHEN 'tricycle' THEN 3 WHEN 'car' THEN 4 ELSE 2 END,
    base_fee, rate_per_km, commission_pct
  FROM rates;
DROP TABLE rates;
ALTER TABLE rates_new RENAME TO rates;
