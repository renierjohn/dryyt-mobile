-- The vehicle the customer chose when booking, same codes as rates.category and driver_data.vehicle_type
-- (1 bicycle, 2 motorcycle, 3 tricycle, 4 car). It prices the booking and only drivers with that vehicle see it.
-- Existing bookings were priced with the motorcycle rate.
ALTER TABLE transactions_dropoff ADD COLUMN vehicle_type INTEGER NOT NULL DEFAULT 2;
ALTER TABLE transactions_pickup ADD COLUMN vehicle_type INTEGER NOT NULL DEFAULT 2;
