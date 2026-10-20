-- What shop owners pay the app (subscription), recorded from the cpanel. amount is centavos; dates are YYYY-MM-DD.
-- payment_type is free text (cash, gcash, bank, ...); next_due_date is when the next payment is due, if set.
CREATE TABLE app_fee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  payment_type TEXT NOT NULL,
  date_paid TEXT NOT NULL,
  next_due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX app_fee_user ON app_fee (user_id, date_paid, id);
