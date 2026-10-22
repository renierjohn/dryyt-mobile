-- app_fee.type: what the payment covers. 'both' = Service fee & Subscription, 'service_fee', 'subscription'.
-- Payments recorded before this (type 'pickup' / 'dropoff') become 'subscription'. SQLite can't change a CHECK, so rebuild.
CREATE TABLE app_fee_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('both', 'service_fee', 'subscription')),
  payment_type TEXT NOT NULL,
  date_paid TEXT NOT NULL,
  next_due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO app_fee_new (id, user_id, amount, type, payment_type, date_paid, next_due_date, created_at)
  SELECT id, user_id, amount, 'subscription', payment_type, date_paid, next_due_date, created_at FROM app_fee;
DROP TABLE app_fee;
ALTER TABLE app_fee_new RENAME TO app_fee;
CREATE INDEX app_fee_user ON app_fee (user_id, date_paid, id);
