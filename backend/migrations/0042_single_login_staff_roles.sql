-- Authentication JTI is server authoritative for all roles after successful login.
-- NULL preserves expiring legacy tokens until their first post-upgrade sign-in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_jti UUID;

-- One reserved email staff identity per plant/job role; suspension reserves slot.
ALTER TABLE plant_staff ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE plant_staff ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id);
ALTER TABLE plant_staff ADD CONSTRAINT staff_removal_is_inactive
    CHECK (removed_at IS NULL OR is_active=FALSE);

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM plant_staff
        WHERE removed_at IS NULL AND role IN (
            'dispatcher','operator','supervisor','accountant',
            'quality_engineer','fleet_manager','store_manager')
        GROUP BY plant_id, role HAVING COUNT(*)>1
    ) THEN
        RAISE EXCEPTION 'Existing plant staff role duplicates require owner review before migration';
    END IF;
END $preflight$;

CREATE UNIQUE INDEX ux_plant_staff_reserved_role
    ON plant_staff(plant_id,role)
    WHERE removed_at IS NULL AND role IN (
        'dispatcher','operator','supervisor','accountant',
        'quality_engineer','fleet_manager','store_manager');

CREATE TABLE plant_staff_role_slot_audit (
    id BIGSERIAL PRIMARY KEY,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    staff_user_id UUID NOT NULL REFERENCES users(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL CHECK(action IN ('ASSIGNED','SUSPENDED','REACTIVATED','REMOVED')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_staff_role_slot_audit_lookup
    ON plant_staff_role_slot_audit(plant_id,role,occurred_at DESC);
