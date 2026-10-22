-- Laundry pickups are priced and paid upfront like food, with the shop setting the laundry fee first:
-- awaiting_fee (shop sets the laundry fee) -> to_pay (customer sends proof) -> awaiting_payment -> payment_confirmed -> pending -> …
-- The laundry fee is kept in items_total: it is what the shop charges, like a food order's items.
-- SQLite can't change a CHECK, so rebuild (and order_items with it, as in 0014).
PRAGMA defer_foreign_keys = true;

CREATE TABLE transactions_pickup_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('awaiting_fee', 'to_pay', 'awaiting_payment', 'payment_confirmed', 'pending', 'accepted', 'picked_up', 'delivered', 'cancelled')),
  customer_address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  items_total INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  payment_ref TEXT NOT NULL DEFAULT '',
  -- R2 key in PROOFS: payments/<customer id>/<file>
  payment_photo_key TEXT,
  service_fee INTEGER NOT NULL DEFAULT 0,
  customer_lat REAL,
  customer_lng REAL,
  driver_lat REAL,
  driver_lng REAL,
  driver_loc_at TEXT,
  driver_paid_at TEXT,
  total_delivery_fee INTEGER NOT NULL DEFAULT 0,
  road_km REAL
);

INSERT INTO transactions_pickup_new (id, type, customer_id, driver_id, store_id, status, customer_address, notes, items_total, delivery_fee,
    created_at, updated_at, payment_ref, payment_photo_key, service_fee, customer_lat, customer_lng, driver_lat, driver_lng, driver_loc_at,
    driver_paid_at, total_delivery_fee, road_km)
  SELECT id, type, customer_id, driver_id, store_id, status, customer_address, notes, items_total, delivery_fee,
    created_at, updated_at, payment_ref, payment_photo_key, service_fee, customer_lat, customer_lng, driver_lat, driver_lng, driver_loc_at,
    driver_paid_at, total_delivery_fee, road_km
  FROM transactions_pickup;

CREATE TABLE order_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES transactions_pickup_new(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  menu_item_id INTEGER REFERENCES store_menu_items(id) ON DELETE SET NULL
);
INSERT INTO order_items_new (id, order_id, name, price, qty, menu_item_id) SELECT id, order_id, name, price, qty, menu_item_id FROM order_items;

DROP TABLE order_items;
DROP TABLE transactions_pickup;
ALTER TABLE transactions_pickup_new RENAME TO transactions_pickup;
ALTER TABLE order_items_new RENAME TO order_items;

CREATE INDEX orders_customer ON transactions_pickup (customer_id);
CREATE INDEX orders_status ON transactions_pickup (status);
CREATE UNIQUE INDEX orders_one_active_job ON transactions_pickup (driver_id) WHERE status IN ('accepted', 'picked_up');
CREATE INDEX orders_driver_status ON transactions_pickup (driver_id, status);
CREATE INDEX order_items_order ON order_items (order_id);
-- Owner Orders tab.
CREATE INDEX orders_store ON transactions_pickup (store_id, id);
