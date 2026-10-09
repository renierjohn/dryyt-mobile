-- users.role gains 'owner' (CHECK change needs a table rebuild) and push_token.
PRAGMA defer_foreign_keys = on;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'driver', 'owner')),
  push_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new (id, email, password_hash, name, phone, role, created_at)
  SELECT id, email, password_hash, name, phone, role, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA defer_foreign_keys = off;

ALTER TABLE stores ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE stores ADD COLUMN group_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE stores ADD COLUMN lat REAL;
ALTER TABLE stores ADD COLUMN lng REAL;
UPDATE stores SET lat = 14.5547, lng = 121.0244 WHERE id = 4;
UPDATE stores SET lat = 14.5589, lng = 121.0170 WHERE id = 5;

CREATE TABLE drivers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  online INTEGER NOT NULL DEFAULT 0,
  busy INTEGER NOT NULL DEFAULT 0,
  group_id TEXT NOT NULL DEFAULT 'default',
  lat REAL,
  lng REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO drivers (user_id) SELECT id FROM users WHERE role = 'driver';
UPDATE drivers SET busy = 1
  WHERE user_id IN (SELECT driver_id FROM orders WHERE status IN ('accepted', 'picked_up'));

CREATE TABLE rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL UNIQUE,
  base_fee INTEGER NOT NULL,
  rate_per_km INTEGER NOT NULL,
  commission_pct REAL NOT NULL
);
-- Placeholder rate_per_km/commission until the admin sets real values.
INSERT INTO rates (group_id, base_fee, rate_per_km, commission_pct) VALUES ('default', 4000, 1000, 10);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'searching' CHECK (status IN (
    'searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop', 'dropped_off',
    'owner_confirmed', 'completed', 'payment_pending', 'cancelled', 'expired')),
  customer_lat REAL NOT NULL,
  customer_lng REAL NOT NULL,
  customer_address TEXT NOT NULL,
  shop_lat REAL NOT NULL,
  shop_lng REAL NOT NULL,
  road_km REAL NOT NULL,
  delivery_fee INTEGER NOT NULL,
  service_fee INTEGER NOT NULL,
  total_delivery_fee INTEGER NOT NULL,
  laundry_fee INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX transactions_customer ON transactions (customer_id);
CREATE INDEX transactions_store ON transactions (store_id);
CREATE INDEX transactions_status ON transactions (status);
CREATE UNIQUE INDEX transactions_one_active_job ON transactions (driver_id)
  WHERE status IN ('driver_accepted', 'en_route_pickup', 'en_route_shop');
CREATE UNIQUE INDEX transactions_one_active_per_customer ON transactions (customer_id)
  WHERE status IN ('searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop');

CREATE TABLE owner_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  weight_kg REAL NOT NULL,
  laundry_fee INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  proof_photo_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  payer_store_id INTEGER NOT NULL REFERENCES stores(id),
  payee_type TEXT NOT NULL CHECK (payee_type IN ('driver', 'developer')),
  payee_id INTEGER REFERENCES users(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (transaction_id, payee_type)
);
CREATE INDEX payouts_store ON payouts (payer_store_id);

CREATE TABLE driver_blocks (
  store_id INTEGER NOT NULL REFERENCES stores(id),
  driver_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, driver_id)
);

CREATE TABLE ws_tickets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  room TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
