-- The owner's reason when they turn down a proof of payment ("Payment not received"). The order goes back to to_pay so
-- the customer can pay again; cleared when they send a new proof.
ALTER TABLE transactions_pickup ADD COLUMN payment_rejected_reason TEXT;
