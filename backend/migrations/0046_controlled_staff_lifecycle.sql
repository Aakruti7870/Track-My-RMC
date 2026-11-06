-- Additive: preserve existing identities, payroll, assignments and migrations.
-- Case collisions are conflicts for operator review, never silently repaired.
CREATE UNIQUE INDEX ux_users_registered_email ON users (lower(btrim(email)))
    WHERE email IS NOT NULL AND btrim(email) <> '';
ALTER TABLE users ADD COLUMN work_email_verified_at TIMESTAMPTZ;
ALTER TABLE plant_staff ADD COLUMN assignment_id UUID NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE plant_staff ADD COLUMN employment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE plant_staff ADD COLUMN invitation_expires_at TIMESTAMPTZ;
ALTER TABLE plant_staff ADD COLUMN status_reason TEXT;
UPDATE plant_staff SET employment_status = CASE
    WHEN removed_at IS NOT NULL THEN 'REMOVED'
    WHEN NOT is_active THEN 'SUSPENDED' ELSE 'ACTIVE' END;
ALTER TABLE plant_staff ADD CONSTRAINT staff_employment_status CHECK
    (employment_status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED','REMOVED','EXPIRED','CANCELLED'));
CREATE TABLE plant_staff_lifecycle_audit (
    id BIGSERIAL PRIMARY KEY,
    assignment_id UUID NOT NULL,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    staff_user_id UUID NOT NULL REFERENCES users(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    actor_role VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_staff_lifecycle_history ON plant_staff_lifecycle_audit(plant_id,staff_user_id,id);
ALTER TABLE plant_staff_manager_delegations ADD COLUMN can_manage_staff BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE plant_staff_manager_delegations ADD COLUMN can_manage_permissions BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plant_staff_manager_delegations ADD COLUMN can_manage_fleet BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plant_staff_manager_delegations ADD COLUMN can_manage_drivers BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plant_staff_manager_delegations ADD COLUMN permission_limits JSONB NOT NULL DEFAULT '{}';
ALTER TABLE plant_staff_module_permissions ADD COLUMN can_create BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plant_staff_module_permissions ADD COLUMN can_export BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE plant_staff_module_permissions SET can_create=can_edit;

ALTER TABLE plant_staff_module_permissions ADD CONSTRAINT staff_create_export_require_view
    CHECK ((NOT can_create OR can_view) AND (NOT can_export OR can_view));
CREATE FUNCTION reject_staff_history_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Staff audit history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER staff_lifecycle_append_only BEFORE UPDATE OR DELETE ON plant_staff_lifecycle_audit
    FOR EACH ROW EXECUTE FUNCTION reject_staff_history_mutation();
CREATE TRIGGER staff_slot_history_append_only BEFORE UPDATE OR DELETE ON plant_staff_role_slot_audit
    FOR EACH ROW EXECUTE FUNCTION reject_staff_history_mutation();
-- Preserve the previous effective policy as explicit compatibility grants.
-- New assignments receive no grants until an Owner authorizes them.
INSERT INTO plant_staff_module_permissions
    (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by)
SELECT ps.plant_id,ps.user_id,k.module_key,TRUE,k.can_edit,FALSE,p.owner_id
FROM plant_staff ps JOIN rmc_plants p ON p.id=ps.plant_id
JOIN (VALUES
    ('dispatcher','dispatch_queue',TRUE),
    ('dispatcher','fleet_availability',TRUE),
    ('dispatcher','challan_gate_pass',TRUE),
    ('dispatcher','material_inventory',FALSE),
    ('operator','production_queue',TRUE),
    ('operator','challan_gate_pass',TRUE),
    ('operator','material_inventory',FALSE),
    ('operator','fleet_availability',FALSE),
    ('operator','mix_designs',FALSE),
    ('operator','dispatch_queue',FALSE),
    ('operator','workforce',FALSE),
    ('operator','plant_reports',FALSE),
    ('supervisor','production_queue',TRUE),
    ('supervisor','dispatch_queue',TRUE),
    ('supervisor','challan_gate_pass',TRUE),
    ('supervisor','material_inventory',TRUE),
    ('supervisor','workforce',TRUE),
    ('supervisor','incidents',TRUE),
    ('supervisor','quality_register',FALSE),
    ('supervisor','mix_designs',FALSE),
    ('supervisor','fleet_availability',FALSE),
    ('supervisor','plant_reports',FALSE),
    ('accountant','billing_ledger',TRUE),
    ('accountant','payroll',TRUE),
    ('accountant','quotations',TRUE),
    ('accountant','expenses',TRUE),
    ('accountant','rate_cards',TRUE),
    ('accountant','workforce',FALSE),
    ('accountant','plant_reports',FALSE),
    ('accountant','employee_master',FALSE),
    ('accountant','purchases',FALSE),
    ('quality_engineer','quality_register',TRUE),
    ('quality_engineer','mix_designs',TRUE),
    ('quality_engineer','challan_gate_pass',TRUE),
    ('quality_engineer','dispatch_queue',FALSE),
    ('quality_engineer','material_inventory',FALSE),
    ('quality_engineer','production_queue',FALSE),
    ('quality_engineer','plant_reports',FALSE),
    ('quality_engineer','workforce',FALSE),
    ('fleet_manager','fleet_availability',TRUE),
    ('fleet_manager','dispatch_queue',TRUE),
    ('fleet_manager','diesel_ledger',TRUE),
    ('fleet_manager','driver_roster',TRUE),
    ('fleet_manager','plant_reports',FALSE),
    ('fleet_manager','workforce',FALSE),
    ('store_manager','material_inventory',TRUE),
    ('store_manager','suppliers',TRUE),
    ('store_manager','purchases',TRUE),
    ('store_manager','diesel_ledger',TRUE),
    ('store_manager','plant_reports',FALSE),
    ('store_manager','workforce',FALSE),
    ('admin','dispatch_queue',TRUE),
    ('admin','fleet_availability',TRUE),
    ('admin','challan_gate_pass',TRUE),
    ('admin','material_inventory',TRUE),
    ('admin','billing_ledger',TRUE),
    ('admin','payroll',TRUE),
    ('admin','production_queue',TRUE),
    ('admin','mix_designs',TRUE),
    ('admin','diesel_ledger',TRUE),
    ('admin','suppliers',TRUE),
    ('admin','purchases',TRUE),
    ('admin','quotations',TRUE),
    ('admin','expenses',TRUE),
    ('admin','rate_cards',TRUE),
    ('admin','workforce',TRUE),
    ('admin','incidents',TRUE),
    ('admin','driver_roster',TRUE),
    ('admin','quality_register',FALSE),
    ('admin','plant_reports',FALSE),
    ('admin','employee_master',FALSE)
) AS k(role,module_key,can_edit) ON k.role=ps.role
WHERE ps.removed_at IS NULL
ON CONFLICT DO NOTHING;

UPDATE plant_staff_module_permissions SET can_create=can_edit;
