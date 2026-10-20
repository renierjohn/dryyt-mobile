-- 1 = the account can't sign in (app or cpanel). Set from the cpanel (POST /admin/users/:id/blocked).
ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1));
