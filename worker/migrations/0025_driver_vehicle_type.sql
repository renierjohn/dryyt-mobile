-- The driver's vehicle, same codes as rates.category: 1 bicycle, 2 motorcycle, 3 tricycle, 4 car (lightweight).
-- NULL until the driver picks one; locked with the rest of their details once verified (status = 1).
ALTER TABLE driver_data ADD COLUMN vehicle_type INTEGER;
