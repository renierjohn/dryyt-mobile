-- When the shop owner paid the driver their share of a delivered pickup's delivery fee (delivery_fee - service_fee).
ALTER TABLE orders ADD COLUMN driver_paid_at TEXT;
