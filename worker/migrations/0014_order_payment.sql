-- Food orders are paid upfront to the store's payment QR: the customer sends a proof (photo or reference number),
-- the owner confirms it (Done Pay), then the customer places the order for drivers.
-- awaiting_payment -> payment_confirmed -> pending -> accepted -> picked_up -> delivered. SQLite can't change a CHECK, so rebuild.
PRAGMA defer_foreign_keys = true;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('awaiting_payment', 'payment_confirmed', 'pending', 'accepted', 'picked_up', 'delivered', 'cancelled')),
  customer_address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  items_total INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  payment_ref TEXT NOT NULL DEFAULT '',
  -- R2 key in PROOFS: payments/<customer id>/<file>
  payment_photo_key TEXT
);

INSERT INTO orders_new (id, type, customer_id, driver_id, store_id, status, customer_address, notes, items_total, delivery_fee, created_at, updated_at)
  SELECT id, type, customer_id, driver_id, store_id, status, customer_address, notes, items_total, delivery_fee, created_at, updated_at FROM orders;

-- order_items points at orders, so dropping orders would orphan its rows: rebuild it against orders_new first
-- (the rename below carries its reference over to orders), and drop the old one before the old orders.
CREATE TABLE order_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders_new(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  menu_item_id INTEGER REFERENCES store_menu_items(id) ON DELETE SET NULL
);
INSERT INTO order_items_new (id, order_id, name, price, qty, menu_item_id) SELECT id, order_id, name, price, qty, menu_item_id FROM order_items;

DROP TABLE order_items;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
ALTER TABLE order_items_new RENAME TO order_items;

CREATE INDEX orders_customer ON orders (customer_id);
CREATE INDEX orders_status ON orders (status);
CREATE UNIQUE INDEX orders_one_active_job ON orders (driver_id) WHERE status IN ('accepted', 'picked_up');
CREATE INDEX orders_driver_status ON orders (driver_id, status);
CREATE INDEX order_items_order ON order_items (order_id);
-- Owner Orders tab.
CREATE INDEX orders_store ON orders (store_id, id);
