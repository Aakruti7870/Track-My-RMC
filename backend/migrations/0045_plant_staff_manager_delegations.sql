-- Owner-controlled Plant Manager is a delegation, not an eighth job role.
-- Delegations only reference existing plant staff; one active manager per plant.
CREATE TABLE plant_staff_manager_delegations (
    plant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    granted_by UUID NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    revoked_by UUID REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (plant_id, user_id),
    FOREIGN KEY (plant_id, user_id) REFERENCES plant_staff(plant_id, user_id) ON DELETE CASCADE,
    CONSTRAINT manager_revocation_actor_required CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL)
);
CREATE UNIQUE INDEX ux_plant_one_active_manager
    ON plant_staff_manager_delegations (plant_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_plant_manager_user
    ON plant_staff_manager_delegations (user_id, plant_id)
    WHERE revoked_at IS NULL;
