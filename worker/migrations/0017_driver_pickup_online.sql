-- "Online for Pickup": separate from `online` (drop offs). Only these drivers join the live pickup job board.
ALTER TABLE drivers ADD COLUMN pickup_online INTEGER NOT NULL DEFAULT 0;
