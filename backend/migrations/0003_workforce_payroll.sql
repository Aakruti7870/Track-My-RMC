-- 0003_workforce_payroll.sql
-- Shifts, Attendance, Payroll Closures, and Salary Records

CREATE TABLE IF NOT EXISTS workforce_shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_night_shift BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workforce_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    shift_id UUID REFERENCES workforce_shifts(id),
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'present',
    check_in_lat DOUBLE PRECISION,
    check_in_lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(plant_id, user_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_att_date ON workforce_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_att_user ON workforce_attendance(user_id);

CREATE TABLE IF NOT EXISTS payroll_closures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INT NOT NULL CHECK (year >= 2020),
    total_gross NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_net NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    employee_count INT NOT NULL DEFAULT 0,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id),
    override_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(plant_id, month, year)
);

CREATE TABLE IF NOT EXISTS payroll_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    closure_id UUID NOT NULL REFERENCES payroll_closures(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    basic_pay NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    allowances NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    deductions NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    net_pay NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    transaction_ref VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
