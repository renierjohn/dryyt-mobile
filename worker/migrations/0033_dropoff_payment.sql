-- Drop off: the customer pays the shop's payment QR once the shop confirms, and sends a reference number, a photo
-- (uploaded via /orders/payment-photo), or both, like a pickup order.
ALTER TABLE transactions_dropoff ADD COLUMN payment_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions_dropoff ADD COLUMN payment_photo_key TEXT;
