ALTER TABLE payroll_closures ADD COLUMN reopened_at TIMESTAMPTZ;
ALTER TABLE payroll_closures ADD COLUMN reopened_by UUID REFERENCES users(id);
ALTER TABLE payroll_closures ADD COLUMN reopen_reason TEXT;
