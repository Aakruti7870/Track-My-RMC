-- Pending and suspended employment reserve a Driver identity. Historical
-- assignments are released explicitly; never guess which duplicate to retain.
ALTER TABLE driver_employment_profiles ADD COLUMN employment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE driver_employment_profiles ADD COLUMN released_at TIMESTAMPTZ;
ALTER TABLE driver_employment_profiles ADD COLUMN released_by UUID REFERENCES users(id);
UPDATE driver_employment_profiles SET employment_status=CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END;
ALTER TABLE driver_employment_profiles ADD CONSTRAINT driver_employment_state CHECK (
    employment_status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED')
    AND is_active=(employment_status='ACTIVE')
    AND (released_at IS NOT NULL)=(employment_status='TERMINATED')
    AND (released_at IS NULL OR released_by IS NOT NULL)
);
DO $preflight$
BEGIN
    IF EXISTS(SELECT 1 FROM driver_employment_profiles GROUP BY driver_id HAVING count(*)>1) THEN
        RAISE EXCEPTION 'Multiple Driver employment records require operator review before reservation migration';
    END IF;
    IF EXISTS(SELECT 1 FROM driver_employment_profiles d JOIN transit_mixers tm ON tm.driver_id=d.driver_id WHERE tm.plant_id<>d.plant_id) THEN
        RAISE EXCEPTION 'Cross-plant Driver vehicle records require operator review before reservation migration';
    END IF;
END $preflight$;
CREATE UNIQUE INDEX ux_driver_current_employment
    ON driver_employment_profiles(driver_id) WHERE released_at IS NULL;
