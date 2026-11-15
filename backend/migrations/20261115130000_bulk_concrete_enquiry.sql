ALTER TABLE customer_service_enquiries
    DROP CONSTRAINT customer_service_enquiries_service_type_check,
    ADD CONSTRAINT customer_service_enquiries_service_type_check
        CHECK (service_type IN ('CEMENT', 'LABOUR_CONTRACTOR', 'BUILDING_MATERIAL', 'PUMP_RENTAL', 'BULK_CONCRETE'));
