-- Expo push tickets awaiting a delivery receipt; the cron checks them and forgets tokens whose app is gone.
CREATE TABLE push_tickets (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX push_tickets_created ON push_tickets (created_at);
