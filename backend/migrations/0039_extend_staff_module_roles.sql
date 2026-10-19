-- Extend the Dispatcher permission pilot to existing plant staff roles.
-- Keep the existing composite staff/plant foreign key and immutable audit.
ALTER TABLE plant_staff_module_permissions
    DROP CONSTRAINT IF EXISTS plant_staff_module_permissions_module_key_check;
ALTER TABLE plant_staff_module_permissions
    ADD CONSTRAINT plant_staff_module_permissions_module_key_check CHECK (module_key IN (
        'dispatch_queue','fleet_availability','challan_gate_pass',
        'material_inventory','billing_ledger','payroll',
        'production_queue','quality_register','mix_designs','diesel_ledger',
        'suppliers','purchases','quotations','expenses','rate_cards',
        'workforce','incidents','plant_reports','driver_roster','employee_master'
    ));
