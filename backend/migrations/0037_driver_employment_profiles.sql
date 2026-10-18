-- 0037: Driver profile/employment data, scoped by a real RMC plant and existing users.
-- Driver authentication remains the existing WhatsApp OTP user role, not plant_staff.
CREATE TABLE IF NOT EXISTS driver_employment_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_code VARCHAR(50),
    company_joining_date DATE,
    total_driving_experience_months INTEGER,
    blood_group VARCHAR(3),
    emergency_contact_1_name VARCHAR(120),
    emergency_contact_1_phone VARCHAR(20),
    emergency_contact_2_name VARCHAR(120),
    emergency_contact_2_phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_employment_plant_driver_unique UNIQUE (plant_id, driver_id),
    CONSTRAINT driver_experience_range CHECK (
        total_driving_experience_months IS NULL
        OR total_driving_experience_months BETWEEN 0 AND 960
    ),
    CONSTRAINT driver_blood_group_value CHECK (
        blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_employment_plant_employee_code
    ON driver_employment_profiles (plant_id, employee_code)
    WHERE employee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_employment_driver_lookup
    ON driver_employment_profiles (driver_id, plant_id) WHERE is_active = TRUE;

-- Audit without copying sensitive contact numbers or medical data into logs.
CREATE TABLE IF NOT EXISTS driver_employment_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CREATED','UPDATED')),
    changed_fields TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS driver_employment_audit_history
    ON driver_employment_audit (plant_id, driver_id, created_at DESC);
