-- Cpanel access (worker/web cpanel.html). A flag rather than a new role: users.role has a CHECK, and an admin keeps their app role.
-- Only a developer sets it (bun run admin:set), the API never does.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
