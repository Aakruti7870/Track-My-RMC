-- 0017_complete_feature_parity.sql
-- Complete Relational Schema for RMC Plant Operations, Commercial Finance,
-- Production Batching, Workforce Lifecycles, Support Threading, and Stored Files.

-- 1. Plant Commercial Profiles
ALTER TABLE rmc_plants ADD COLUMN IF NOT EXISTS district VARCHAR(100);

CREATE TABLE IF NOT EXISTS plant_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE UNIQUE,
    legal_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(200),
    gstin VARCHAR(30),
    pan VARCHAR(20),
    billing_address TEXT NOT NULL,
    state VARCHAR(100),
    state_code VARCHAR(10),
    contact_phone VARCHAR(30),
    contact_email VARCHAR(254),
    bank_name VARCHAR(160),
    bank_account_masked VARCHAR(64),
    ifsc VARCHAR(30),
    invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV',
    challan_prefix VARCHAR(16) NOT NULL DEFAULT 'CH',
    quotation_prefix VARCHAR(16) NOT NULL DEFAULT 'QT',
    terms_and_conditions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Plant Rate Cards
CREATE TABLE IF NOT EXISTS plant_rate_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    grade VARCHAR(30) NOT NULL,
    rate_per_m3 NUMERIC(10,2) NOT NULL,
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    transport_rate_per_km NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pumping_rate_per_m3 NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_plant_grade ON plant_rate_cards(plant_id, grade, active);

-- 3. Plant Mix Designs
CREATE TABLE IF NOT EXISTS plant_mix_designs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    grade VARCHAR(30) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    cement_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    fly_ash_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    c_sand_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    sand_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    aggregate_10mm_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    aggregate_20mm_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    admixture_kg NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    water_litre NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    target_slump_mm INT DEFAULT 120,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mix_designs_plant_grade ON plant_mix_designs(plant_id, grade, active);

-- 4. Plant Suppliers
CREATE TABLE IF NOT EXISTS plant_suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    gstin VARCHAR(30),
    phone VARCHAR(30),
    email VARCHAR(254),
    address TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plant_suppliers_plant ON plant_suppliers(plant_id);

-- 5. Plant Materials & Stock
CREATE TABLE IF NOT EXISTS plant_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    material_type VARCHAR(50) NOT NULL, -- 'cement', 'flyash', 'sand', 'aggregate_10mm', 'aggregate_20mm', 'admixture'
    unit VARCHAR(20) NOT NULL DEFAULT 'kg', -- 'kg', 'litre', 'ton'
    current_stock NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    minimum_stock NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plant_materials_plant ON plant_materials(plant_id);

CREATE TABLE IF NOT EXISTS plant_material_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id UUID NOT NULL REFERENCES plant_materials(id) ON DELETE CASCADE,
    adjusted_by UUID NOT NULL REFERENCES users(id),
    quantity_change NUMERIC(14,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Customer RFQs and Plant Quotations
CREATE TABLE IF NOT EXISTS customer_quotation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
    grade VARCHAR(30) NOT NULL,
    quantity_m3 NUMERIC(10,2) NOT NULL,
    required_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'QUOTED', 'DECLINED', 'CANCELLED'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cust_rfq_customer ON customer_quotation_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_rfq_plant ON customer_quotation_requests(plant_id);

CREATE TABLE IF NOT EXISTS plant_quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    quotation_number VARCHAR(60) NOT NULL UNIQUE,
    request_id UUID REFERENCES customer_quotation_requests(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_name VARCHAR(200) NOT NULL,
    customer_mobile VARCHAR(30),
    site_name VARCHAR(180) NOT NULL,
    site_address TEXT NOT NULL,
    grade VARCHAR(30) NOT NULL,
    quantity_m3 NUMERIC(10,2) NOT NULL,
    rate_per_m3 NUMERIC(10,2) NOT NULL,
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    transport_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    pumping_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL,
    valid_until DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'SENT', -- 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'
    decline_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plant_quotations_plant ON plant_quotations(plant_id);
CREATE INDEX IF NOT EXISTS idx_plant_quotations_cust ON plant_quotations(customer_id);

-- 7. Customer Pour Plans & Receiving Records
CREATE TABLE IF NOT EXISTS customer_pour_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES customer_sites(id) ON DELETE CASCADE,
    grade VARCHAR(30) NOT NULL,
    total_quantity_m3 NUMERIC(10,2) NOT NULL,
    mixer_capacity_m3 NUMERIC(6,2) NOT NULL DEFAULT 6.00,
    pour_date DATE NOT NULL,
    start_time VARCHAR(10) NOT NULL,
    unload_minutes INT NOT NULL DEFAULT 30,
    discharge_mode VARCHAR(20) NOT NULL DEFAULT 'PUMP', -- 'PUMP', 'DIRECT'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pour_plans_customer ON customer_pour_plans(customer_id);

CREATE TABLE IF NOT EXISTS customer_receiving_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES customer_sites(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    grade VARCHAR(30) NOT NULL,
    received_quantity_m3 NUMERIC(8,2) NOT NULL,
    challan_number VARCHAR(160),
    tm_number VARCHAR(64),
    arrival_time VARCHAR(10),
    unloading_start_time VARCHAR(10),
    unloading_end_time VARCHAR(10),
    observed_slump_mm NUMERIC(6,2),
    sample_cast_date DATE,
    checklist JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receiving_records_cust ON customer_receiving_records(customer_id);

CREATE TABLE IF NOT EXISTS cube_test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_id UUID REFERENCES customer_receiving_records(id) ON DELETE CASCADE,
    sample_id VARCHAR(160) NOT NULL,
    age_days INT NOT NULL CHECK (age_days IN (7, 28)),
    tested_on DATE NOT NULL,
    result_mpa NUMERIC(6,2) NOT NULL,
    lab_name VARCHAR(240),
    report_reference VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quality inspection cube tests extensions
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS slump_mm INT;
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS compressive_strength_7d_mpa NUMERIC(6,2);
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS compressive_strength_28d_mpa NUMERIC(6,2);
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS actual_cement NUMERIC(8,2);
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS actual_water NUMERIC(8,2);
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS result VARCHAR(20) DEFAULT 'PASS';
ALTER TABLE cube_tests ADD COLUMN IF NOT EXISTS testing_date DATE DEFAULT CURRENT_DATE;

-- 8. Production Batching Records & Gate Passes
CREATE TABLE IF NOT EXISTS batch_production_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id UUID NOT NULL REFERENCES order_loads(id) ON DELETE CASCADE,
    operator_id UUID NOT NULL REFERENCES users(id),
    batch_number INT NOT NULL DEFAULT 1,
    actual_weights JSONB NOT NULL DEFAULT '{}',
    target_weights JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED', -- 'IN_PROGRESS', 'COMPLETED', 'ABORTED'
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_batch_records_load ON batch_production_records(load_id);

CREATE TABLE IF NOT EXISTS gate_passes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id UUID NOT NULL REFERENCES order_loads(id) ON DELETE CASCADE UNIQUE,
    pass_number VARCHAR(60) NOT NULL UNIQUE,
    security_name VARCHAR(160),
    remarks TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Driver SOS Incidents
CREATE TABLE IF NOT EXISTS driver_sos_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    load_id UUID REFERENCES order_loads(id) ON DELETE SET NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    alert_type VARCHAR(50) NOT NULL DEFAULT 'EMERGENCY', -- 'BREAKDOWN', 'ACCIDENT', 'TRAFFIC_HALT', 'EMERGENCY'
    message TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'RESPONDING', 'RESOLVED'
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status ON driver_sos_alerts(status, created_at DESC);

-- 10. Operations Finance: Expenses, Diesel, Purchases, Invoices, Payments
CREATE TABLE IF NOT EXISTS plant_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    recorded_by UUID NOT NULL REFERENCES users(id),
    category VARCHAR(50) NOT NULL, -- 'diesel', 'salary', 'maintenance', 'electricity', 'rent', 'material', 'transport', 'office', 'tax', 'other'
    amount NUMERIC(12,2) NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor VARCHAR(200),
    reference VARCHAR(160),
    payment_method VARCHAR(30) NOT NULL DEFAULT 'cash',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plant_expenses_plant_date ON plant_expenses(plant_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS diesel_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    recorded_by UUID NOT NULL REFERENCES users(id),
    transaction_type VARCHAR(20) NOT NULL, -- 'IN', 'OUT', 'ADJUSTMENT'
    litres NUMERIC(10,2) NOT NULL,
    rate_per_litre NUMERIC(8,2) DEFAULT 0.00,
    vehicle_id UUID REFERENCES transit_mixers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES plant_suppliers(id) ON DELETE SET NULL,
    odometer_km NUMERIC(10,2),
    reference VARCHAR(160),
    notes TEXT,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_diesel_plant_date ON diesel_transactions(plant_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS purchase_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES plant_suppliers(id) ON DELETE CASCADE,
    receipt_number VARCHAR(160) NOT NULL,
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    lines JSONB NOT NULL DEFAULT '[]', -- array of { material_id, quantity, rate }
    gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    freight_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_plant ON purchase_receipts(plant_id);

CREATE TABLE IF NOT EXISTS plant_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    invoice_number VARCHAR(60) NOT NULL UNIQUE,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    subtotal_amount NUMERIC(12,2) NOT NULL,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ISSUED', -- 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_plant ON plant_invoices(plant_id);

CREATE TABLE IF NOT EXISTS plant_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES plant_invoices(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'bank_transfer',
    transaction_ref VARCHAR(160),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_plant ON plant_payments(plant_id);

-- 11. Workforce: Roster Schedules, Leaves, Visits, Expense Claims, HR Salary Profiles
ALTER TABLE workforce_shifts ADD COLUMN IF NOT EXISTS grace_minutes INT DEFAULT 10;
ALTER TABLE workforce_shifts ADD COLUMN IF NOT EXISTS half_day_threshold_minutes INT;
ALTER TABLE workforce_shifts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS workforce_roster_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES workforce_shifts(id) ON DELETE SET NULL,
    date_key DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(plant_id, user_id, date_key)
);
CREATE INDEX IF NOT EXISTS idx_roster_plant_date ON workforce_roster_schedules(plant_id, date_key);

CREATE TABLE IF NOT EXISTS workforce_leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL, -- 'CASUAL', 'SICK', 'PAID', 'UNPAID', 'OTHER'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    decision_note TEXT,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON workforce_leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_plant ON workforce_leave_requests(plant_id);

CREATE TABLE IF NOT EXISTS workforce_client_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    client_name VARCHAR(160) NOT NULL,
    purpose TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    site_address TEXT NOT NULL,
    contact_name VARCHAR(120),
    contact_phone VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    start_lat DOUBLE PRECISION,
    start_lng DOUBLE PRECISION,
    completed_lat DOUBLE PRECISION,
    completed_lng DOUBLE PRECISION,
    outcome TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_user ON workforce_client_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_visits_plant ON workforce_client_visits(plant_id);

CREATE TABLE IF NOT EXISTS workforce_expense_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    category VARCHAR(64) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    receipt_reference VARCHAR(500),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_VERIFICATION', -- 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'
    accountant_note TEXT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    owner_note TEXT,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_claims_plant ON workforce_expense_claims(plant_id, status);

CREATE TABLE IF NOT EXISTS employee_hr_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    employee_code VARCHAR(50),
    designation VARCHAR(100),
    department VARCHAR(100),
    join_date DATE,
    employment_type VARCHAR(50) NOT NULL DEFAULT 'PERMANENT',
    weekly_off_day VARCHAR(20) NOT NULL DEFAULT 'SUNDAY',
    work_location VARCHAR(150),
    emergency_contact_name VARCHAR(120),
    emergency_contact_phone VARCHAR(30),
    document_references JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, plant_id)
);
CREATE INDEX IF NOT EXISTS idx_hr_profiles_plant ON employee_hr_profiles(plant_id);

CREATE TABLE IF NOT EXISTS employee_salary_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    pay_basis VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    basic_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    hra_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    allowances NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    overtime_rate_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    fixed_deductions NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    employee_pf NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    employee_esi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    professional_tax NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    tds NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    deductions NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, plant_id)
);

-- 12. Support Case Replies
CREATE TABLE IF NOT EXISTS support_case_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_staff BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_replies_case ON support_case_replies(case_id, created_at);

-- 13. Plant SaaS Subscription Plans & Payment Tracking
CREATE TABLE IF NOT EXISTS plant_subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    monthly_price NUMERIC(10,2) NOT NULL,
    features JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plant_plan_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plant_subscription_plans(id),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'CANCELLED'
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_subscriptions_plant ON plant_plan_subscriptions(plant_id);

CREATE TABLE IF NOT EXISTS plant_plan_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    order_number VARCHAR(100) NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL,
    gateway_order_id VARCHAR(100),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PAID', 'FAILED'
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. File Storage Metadata
CREATE TABLE IF NOT EXISTS stored_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    file_path VARCHAR(500) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    storage_provider VARCHAR(50) NOT NULL DEFAULT 'local', -- 'local', 's3'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Order Status Automation Queue & Callbacks
CREATE TABLE IF NOT EXISTS order_automation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL DEFAULT 'ORDER_STATUS_CHANGED',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD_LETTER'
    routing_key VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    worker_id VARCHAR(128),
    lease_token VARCHAR(256),
    lease_expires_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_events_status ON order_automation_events(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS order_automation_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES order_automation_events(id) ON DELETE CASCADE,
    action VARCHAR(64) NOT NULL,
    provider VARCHAR(64),
    provider_id VARCHAR(256),
    status VARCHAR(64) NOT NULL,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
