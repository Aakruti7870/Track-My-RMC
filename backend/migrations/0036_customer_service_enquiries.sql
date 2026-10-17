-- Customer-initiated service enquiries. These are leads, not paid orders or confirmed quotations.
CREATE TABLE IF NOT EXISTS customer_service_enquiries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type VARCHAR(32) NOT NULL CHECK (service_type IN ('CEMENT', 'LABOUR_CONTRACTOR', 'BUILDING_MATERIAL')),
    contact_name VARCHAR(150) NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 150),
    contact_phone VARCHAR(20) NOT NULL CHECK (length(btrim(contact_phone)) BETWEEN 10 AND 20),
    location VARCHAR(500) NOT NULL CHECK (length(btrim(location)) BETWEEN 3 AND 500),
    required_date DATE NOT NULL,
    details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUOTED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_service_enquiries_customer
    ON customer_service_enquiries(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_service_enquiries_queue
    ON customer_service_enquiries(status, created_at DESC);
