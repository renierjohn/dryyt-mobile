-- Owners send proof of their app fee payment from the app (a photo, a reference number, or both): that adds an app_fee
-- row dated the day it was sent, with no amount or type yet (amount 0, type NULL) until an admin fills them in from the
-- cpanel. photo_key is an R2 key in PROOFS (app-fee/<owner id>/<file>). SQLite can't change a CHECK, so rebuild.
CREATE TABLE app_fee_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  type TEXT CHECK (type IS NULL OR type IN ('both', 'service_fee', 'subscription')),
  payment_type TEXT NOT NULL DEFAULT '',
  date_paid TEXT NOT NULL,
  next_due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  photo TEXT,
  ref_number TEXT NOT NULL DEFAULT ''
);
INSERT INTO app_fee_new (id, user_id, amount, type, payment_type, date_paid, next_due_date, created_at)
  SELECT id, user_id, amount, type, payment_type, date_paid, next_due_date, created_at FROM app_fee;
DROP TABLE app_fee;
ALTER TABLE app_fee_new RENAME TO app_fee;
CREATE INDEX app_fee_user ON app_fee (user_id, date_paid, id);
