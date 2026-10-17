-- How many shops an owner may run.
ALTER TABLE users ADD COLUMN maxstore INTEGER NOT NULL DEFAULT 1 CHECK (maxstore >= 0);
UPDATE users SET maxstore = 3 WHERE id = 9;
UPDATE users SET maxstore = 2 WHERE id = 7;
