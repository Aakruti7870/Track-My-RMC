-- Driver-reported vehicle observations, separate from authoritative plant billing/fuel ledgers.
-- Records are immutable and scoped to the authenticated driver and assigned mixer.
CREATE TABLE IF NOT EXISTS driver_vehicle_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES users(id),
    mixer_id UUID NOT NULL REFERENCES transit_mixers(id),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('diesel','odometer','maintenance')),
    diesel_litres DOUBLE PRECISION,
    odometer_km BIGINT,
    maintenance_type TEXT,
    notes TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (diesel_litres IS NULL OR (diesel_litres > 0 AND diesel_litres <= 1000)),
    CHECK (odometer_km IS NULL OR (odometer_km >= 0 AND odometer_km <= 10000000)),
    CHECK (notes IS NULL OR char_length(notes) <= 500),
    CHECK (
      (entry_kind = 'diesel' AND diesel_litres IS NOT NULL AND odometer_km IS NULL AND maintenance_type IS NULL)
      OR (entry_kind = 'odometer' AND odometer_km IS NOT NULL AND diesel_litres IS NULL AND maintenance_type IS NULL)
      OR (entry_kind = 'maintenance' AND maintenance_type IS NOT NULL AND diesel_litres IS NULL AND odometer_km IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_driver_vehicle_logs_period ON driver_vehicle_logs(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_vehicle_logs_mixer ON driver_vehicle_logs(mixer_id, recorded_at DESC);
