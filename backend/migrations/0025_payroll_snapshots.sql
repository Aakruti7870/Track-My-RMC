-- Preserve existing amounts; unavailable historical evidence remains NULL.
ALTER TABLE payroll_records ADD COLUMN overtime_amount NUMERIC(10,2);
ALTER TABLE payroll_records ADD COLUMN paid_days NUMERIC(5,2);
ALTER TABLE payroll_records ADD COLUMN notes TEXT;
ALTER TABLE payroll_records ADD COLUMN payment_method VARCHAR(30);
ALTER TABLE payroll_records ADD COLUMN paid_on DATE;
ALTER TABLE payroll_closures ADD COLUMN closure_version INT NOT NULL DEFAULT 0;
ALTER TABLE plant_expenses ADD COLUMN payroll_record_id UUID REFERENCES payroll_records(id);
CREATE UNIQUE INDEX payroll_expense_once ON plant_expenses(payroll_record_id) WHERE payroll_record_id IS NOT NULL;
CREATE TABLE payroll_payslip_snapshots (
 closure_id UUID NOT NULL REFERENCES payroll_closures(id),
 closure_version INT NOT NULL CHECK(closure_version>0),
 user_id UUID NOT NULL REFERENCES users(id),
 snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(closure_id,closure_version,user_id)
);
