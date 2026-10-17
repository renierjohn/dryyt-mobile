-- Shop logo URL, and up to 3 payment QR codes as a JSON array of { label, image_url } (e.g. "GCash 0917…" + its QR).
ALTER TABLE stores ADD COLUMN store_logo TEXT;
ALTER TABLE stores ADD COLUMN store_payment_gateway TEXT NOT NULL DEFAULT '[]';
