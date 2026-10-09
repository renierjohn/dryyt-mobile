-- Polling hot paths: look up by driver / owner / store instead of scanning by status.
CREATE INDEX transactions_driver_status ON transactions (driver_id, status);
CREATE INDEX orders_driver_status ON orders (driver_id, status);
CREATE INDEX stores_owner ON stores (owner_id);

-- Owner lists: filter by status inside the store (replaces the store_id-only indexes).
DROP INDEX transactions_store;
CREATE INDEX transactions_store_status ON transactions (store_id, status, updated_at);
DROP INDEX payouts_store;
CREATE INDEX payouts_store_status ON payouts (payer_store_id, status, id);
