ALTER TABLE customer_service_enquiries
    DROP CONSTRAINT customer_service_enquiries_service_type_check,
    ADD CONSTRAINT customer_service_enquiries_service_type_check
        CHECK (service_type IN (
            'CEMENT', 'LABOUR_CONTRACTOR', 'BUILDING_MATERIAL', 'PUMP_RENTAL',
            'BULK_CONCRETE', 'PLANT_SUPPLIER', 'PLANT_WEBSITE_DESIGN',
            'PLANT_BUY_DOMAIN', 'PLANT_DIGITAL_MARKETING', 'PLANT_ACCESSORIES'
        ));
