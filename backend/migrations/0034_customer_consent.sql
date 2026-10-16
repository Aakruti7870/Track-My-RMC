CREATE TABLE IF NOT EXISTS user_permission_consent (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    location_choice TEXT NOT NULL CHECK (location_choice IN ('granted','denied','manual','unavailable','undetermined')),
    notification_choice TEXT NOT NULL CHECK (notification_choice IN ('granted','denied','manual','unavailable','undetermined')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gps_telemetry_load_latest_idx ON gps_telemetry(load_id, recorded_at DESC);
