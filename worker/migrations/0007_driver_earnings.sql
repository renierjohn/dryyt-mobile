-- Running total (centavos) of a driver's delivery fees, added when the shop owner confirms a drop off.
ALTER TABLE driver_data ADD COLUMN earnings INTEGER NOT NULL DEFAULT 0;

-- Backfill from driver payouts already recorded.
INSERT INTO driver_data (user_id, earnings)
  SELECT p.payee_id, SUM(p.amount) FROM payouts p JOIN users u ON u.id = p.payee_id
  WHERE p.payee_type = 'driver' AND u.role = 'driver' GROUP BY p.payee_id
  ON CONFLICT (user_id) DO UPDATE SET earnings = excluded.earnings;
