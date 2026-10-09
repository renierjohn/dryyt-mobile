-- v1 drop off orders are replaced by v2 transactions; the app no longer creates or labels them.
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE type = 'dropoff');
DELETE FROM orders WHERE type = 'dropoff';
