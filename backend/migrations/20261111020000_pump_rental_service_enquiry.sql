-- Extend the existing role-scoped service-enquiry pipeline with pump rental leads.
-- This is not a paid booking and does not automatically contact a supplier.
ALTER TABLE customer_service_enquiries
  DROP CONSTRAINT IF EXISTS customer_service_enquiries_service_type_check;
ALTER TABLE customer_service_enquiries
  ADD CONSTRAINT customer_service_enquiries_service_type_check
  CHECK (service_type IN ('CEMENT', 'LABOUR_CONTRACTOR', 'BUILDING_MATERIAL', 'PUMP_RENTAL'));
