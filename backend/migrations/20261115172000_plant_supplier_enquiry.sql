ALTER TABLE customer_service_enquiries
    ADD COLUMN request_key VARCHAR(80),
    DROP CONSTRAINT customer_service_enquiries_service_type_check,
    ADD CONSTRAINT customer_service_enquiries_service_type_check
        CHECK (service_type IN (
            'CEMENT', 'LABOUR_CONTRACTOR', 'BUILDING_MATERIAL', 'PUMP_RENTAL',
            'BULK_CONCRETE', 'PLANT_SUPPLIER'
        ));

CREATE UNIQUE INDEX ux_plant_supplier_enquiry_request
    ON customer_service_enquiries(customer_id, request_key) WHERE request_key IS NOT NULL;
