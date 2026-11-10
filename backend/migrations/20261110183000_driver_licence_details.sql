-- Extend plant-managed Driver employment records with the two licence
-- fields shown in the read-only digital driver card. This does not assert
-- governmental verification. Existing rows retain NULL values.
ALTER TABLE driver_employment_profiles
    ADD COLUMN driving_licence_number VARCHAR(32),
    ADD COLUMN driving_licence_valid_until DATE;

ALTER TABLE driver_employment_profiles
    ADD CONSTRAINT driver_licence_validity_depends_on_number
    CHECK (driving_licence_valid_until IS NULL OR driving_licence_number IS NOT NULL);
