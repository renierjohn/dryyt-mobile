-- The app's cut of a pickup's delivery fee, like transactions.service_fee. orders.delivery_fee stays what the customer
-- pays for delivery (driver's share + service fee). 0 for flat-fee orders.
ALTER TABLE orders ADD COLUMN service_fee INTEGER NOT NULL DEFAULT 0;
