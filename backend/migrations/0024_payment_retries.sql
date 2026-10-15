-- Additive replay key; historical financial rows are preserved.
ALTER TABLE plant_payments ADD COLUMN request_id VARCHAR(128);
CREATE UNIQUE INDEX plant_payment_retry ON plant_payments(invoice_id,request_id) WHERE request_id IS NOT NULL;
