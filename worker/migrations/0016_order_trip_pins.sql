-- Map pins for a picked-up pickup order: the customer's pinned spot (null for typed-address orders) and the
-- driver's latest location, sent by the driver's phone while the order is picked_up.
ALTER TABLE orders ADD COLUMN customer_lat REAL;
ALTER TABLE orders ADD COLUMN customer_lng REAL;
ALTER TABLE orders ADD COLUMN driver_lat REAL;
ALTER TABLE orders ADD COLUMN driver_lng REAL;
ALTER TABLE orders ADD COLUMN driver_loc_at TEXT;
