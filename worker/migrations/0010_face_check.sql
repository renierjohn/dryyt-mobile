-- How the current face photo was taken: 'passed' the app's live face check, or 'skipped' it
-- (the driver's phone couldn't run it), so a developer looks at it closely before verifying.
-- NULL for photos uploaded before the check existed.
ALTER TABLE driver_data ADD COLUMN face_check TEXT CHECK (face_check IN ('passed', 'skipped'));
