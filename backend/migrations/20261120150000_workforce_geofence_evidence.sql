ALTER TABLE rmc_plants
    ADD COLUMN attendance_radius_m DOUBLE PRECISION NOT NULL DEFAULT 250
        CHECK (attendance_radius_m > 0 AND attendance_radius_m < 'Infinity'::DOUBLE PRECISION);

-- Store the radius and measured distance at punch time. Historical records
-- without measurements remain NULL and cannot imply an inside-radius result.
ALTER TABLE workforce_attendance
    ADD COLUMN check_in_geofence JSONB,
    ADD COLUMN check_out_geofence JSONB;
