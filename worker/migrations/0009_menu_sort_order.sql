-- Owner-set menu order (drag to reorder): lower comes first. Existing items keep their insertion order.
ALTER TABLE store_menu_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE store_menu_items SET sort_order = id;
