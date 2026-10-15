-- Preserve requested pumping and immutable commercial-response intent.
ALTER TABLE customer_quotation_requests ADD COLUMN pump_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_quotation_requests ADD COLUMN decline_reason TEXT;
ALTER TABLE customer_quotation_requests ADD COLUMN response_payload JSONB;
