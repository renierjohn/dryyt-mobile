-- How many of this item customers have received (sum of qty on delivered orders). The worker keeps it current.
ALTER TABLE store_menu_items ADD COLUMN popularity INTEGER NOT NULL DEFAULT 0;
CREATE INDEX store_menu_items_popularity ON store_menu_items (popularity DESC);
-- Order lines snapshot name and price; this links them back to the menu item they came from.
ALTER TABLE order_items ADD COLUMN menu_item_id INTEGER REFERENCES store_menu_items(id) ON DELETE SET NULL;
-- Best effort for lines placed before this column: same store, same name.
UPDATE order_items SET menu_item_id = (
  SELECT m.id FROM store_menu_items m JOIN orders o ON o.id = order_items.order_id
  WHERE m.store_id = o.store_id AND m.name = order_items.name LIMIT 1
) WHERE menu_item_id IS NULL;
UPDATE store_menu_items SET popularity = COALESCE((
  SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.menu_item_id = store_menu_items.id AND o.status = 'delivered'
), 0);
