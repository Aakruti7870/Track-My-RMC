-- Keep four of the existing 64 provider slots available for Central Admin.
ALTER TABLE otp_delivery_slots
    ADD COLUMN pool TEXT NOT NULL DEFAULT 'public'
    CHECK (pool IN ('public', 'central_admin'));
UPDATE otp_delivery_slots SET pool = 'central_admin' WHERE slot BETWEEN 61 AND 64;

ALTER TABLE otp_delivery_budget
    ADD COLUMN pool TEXT NOT NULL DEFAULT 'public'
    CHECK (pool IN ('public', 'central_admin')),
    DROP COLUMN singleton;
ALTER TABLE otp_delivery_budget ADD PRIMARY KEY (pool);

-- Reserve up to 50 of the original total without resetting any prior usage.
WITH public_budget AS (
    SELECT utc_day, used, daily_limit, LEAST(50, daily_limit / 2) AS reserved
    FROM otp_delivery_budget WHERE pool = 'public'
)
INSERT INTO otp_delivery_budget (pool, utc_day, used, daily_limit)
SELECT 'central_admin', utc_day, GREATEST(0, used - (daily_limit - reserved)), reserved
FROM public_budget;

UPDATE otp_delivery_budget AS general
SET daily_limit = general.daily_limit - admin.daily_limit,
    used = LEAST(general.used, general.daily_limit - admin.daily_limit)
FROM otp_delivery_budget AS admin
WHERE general.pool = 'public' AND admin.pool = 'central_admin';
