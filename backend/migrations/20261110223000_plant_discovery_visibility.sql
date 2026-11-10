-- Reversible publication hold independent of operational plant status.
-- Existing approved plants remain discoverable unless an Admin explicitly holds them.
ALTER TABLE plant_admin_controls
    ADD COLUMN IF NOT EXISTS discovery_visible BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN plant_admin_controls.discovery_visible IS
    'Central Admin customer-discovery visibility override. FALSE suppresses linked listings and new customer orders/RFQs without deactivating a plant.';
