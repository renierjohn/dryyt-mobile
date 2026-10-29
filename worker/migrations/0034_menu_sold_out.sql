-- The owner marks a menu item sold out: customers still see it, dimmed, but can't add it to an order.
ALTER TABLE store_menu_items ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0;
