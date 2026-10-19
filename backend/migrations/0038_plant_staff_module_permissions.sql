-- Dispatcher permission pilot: no automatic grants or cross-plant data movement.
-- Each override belongs to one existing staff assignment and is deleted with it.
CREATE TABLE plant_staff_module_permissions (
    plant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    module_key TEXT NOT NULL CHECK (module_key IN (
        'dispatch_queue','fleet_availability','challan_gate_pass',
        'material_inventory','billing_ledger','payroll'
    )),
    can_view BOOLEAN NOT NULL,
    can_edit BOOLEAN NOT NULL,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plant_id, user_id, module_key),
    FOREIGN KEY (plant_id, user_id) REFERENCES plant_staff(plant_id, user_id) ON DELETE CASCADE,
    CONSTRAINT staff_permissions_compatible CHECK (
        (NOT can_edit OR can_view) AND (NOT can_approve OR can_view)
    )
);
CREATE INDEX idx_staff_module_permissions_user ON plant_staff_module_permissions(user_id, plant_id);

-- Append-only permission audit: never store private authentication material.
CREATE TABLE plant_staff_module_permission_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    staff_user_id UUID NOT NULL REFERENCES users(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    module_key TEXT NOT NULL,
    old_grant JSONB,
    new_grant JSONB NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_staff_module_permission_audit_lookup
    ON plant_staff_module_permission_audit(plant_id, staff_user_id, changed_at DESC);

CREATE FUNCTION reject_permission_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Permission audit history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER permission_audit_append_only
    BEFORE UPDATE OR DELETE ON plant_staff_module_permission_audit
    FOR EACH ROW EXECUTE FUNCTION reject_permission_audit_mutation();
