-- Driver verification: face and license photos (R2 keys in the PROOFS bucket) and the license plate.
-- status 1 = verified (details locked); only a developer sets it (yarn driver:verify), the API never does.
CREATE TABLE driver_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  photo_face TEXT,
  photo_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CHECK can't look at another table, so triggers keep user_id to drivers.
CREATE TRIGGER driver_data_driver_only_insert BEFORE INSERT ON driver_data
WHEN (SELECT role FROM users WHERE id = NEW.user_id) IS NOT 'driver'
BEGIN
  SELECT RAISE(ABORT, 'driver_data.user_id must be a driver');
END;

CREATE TRIGGER driver_data_driver_only_update BEFORE UPDATE OF user_id ON driver_data
WHEN (SELECT role FROM users WHERE id = NEW.user_id) IS NOT 'driver'
BEGIN
  SELECT RAISE(ABORT, 'driver_data.user_id must be a driver');
END;
