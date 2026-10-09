-- Food shop menus, managed by the owner. Prices in centavos; discount_percent comes off the price at checkout.
ALTER TABLE menu_items RENAME TO store_menu_items;
ALTER TABLE store_menu_items ADD COLUMN image_url TEXT;
ALTER TABLE store_menu_items ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);
ALTER TABLE store_menu_items ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE store_menu_items ADD COLUMN best_seller INTEGER NOT NULL DEFAULT 0 CHECK (best_seller IN (0, 1));
CREATE INDEX store_menu_items_store ON store_menu_items (store_id);
