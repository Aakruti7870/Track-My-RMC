-- 0016_play_review_fixtures.sql
-- Dedicated, non-privileged reviewer identities and isolated demo records.
-- These are explicitly labelled review fixtures; no real customer data is copied.
CREATE TABLE IF NOT EXISTS play_review_fixtures (
    role VARCHAR(24) PRIMARY KEY CHECK (role IN ('customer', 'plant_owner', 'driver')),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plant_id UUID REFERENCES rmc_plants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES customer_sites(id) ON DELETE CASCADE,
    mixer_id UUID REFERENCES transit_mixers(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    load_id UUID REFERENCES order_loads(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS play_review_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    client_hash CHAR(64) NOT NULL,
    succeeded BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_play_review_attempts_client_time
    ON play_review_login_attempts(client_hash, attempted_at DESC)
    WHERE succeeded = FALSE;

-- These accounts cannot use password or OTP login; the dedicated review endpoint
-- is the only supported authentication path. The sentinel hash is never verified.
INSERT INTO users (id, phone, email, hashed_password, full_name, role, is_active, is_verified)
VALUES
 ('a0000000-0000-4000-8000-000000000001', '10000000001', 'play-review-customer@trackmyrmc.invalid', '!play-review-only!', 'TrackMyRMC Play Review Customer', 'customer', TRUE, TRUE),
 ('a0000000-0000-4000-8000-000000000002', '10000000002', 'play-review-owner@trackmyrmc.invalid', '!play-review-only!', 'TrackMyRMC Play Review Owner', 'owner', TRUE, TRUE),
 ('a0000000-0000-4000-8000-000000000003', '10000000003', 'play-review-driver@trackmyrmc.invalid', '!play-review-only!', 'TrackMyRMC Play Review Driver', 'driver', TRUE, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO user_profiles (user_id, business_name, kyc_status)
VALUES
 ('a0000000-0000-4000-8000-000000000001', NULL, 'unverified'),
 ('a0000000-0000-4000-8000-000000000002', 'TrackMyRMC Play Review Plant', 'verified'),
 ('a0000000-0000-4000-8000-000000000003', NULL, 'unverified')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO rmc_plants (
 id, owner_id, name, code, latitude, longitude, address_line, city, state,
 pincode, contact_phone, contact_email, is_active
)
VALUES (
 'b0000000-0000-4000-8000-000000000001',
 'a0000000-0000-4000-8000-000000000002',
 'TrackMyRMC Play Review Plant', 'PLAY-REVIEW-PLANT',
 19.0760, 72.8777, 'Review-only demo location', 'Mumbai', 'Maharashtra',
 '400001', '10000000002', 'play-review-owner@trackmyrmc.invalid', TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_sites (
 id, customer_id, name, address_line, city, state, pincode, latitude, longitude,
 contact_person, contact_phone
)
VALUES (
 'b0000000-0000-4000-8000-000000000002',
 'a0000000-0000-4000-8000-000000000001',
 'Play Review Delivery Site', 'Review-only demo location', 'Mumbai', 'Maharashtra',
 '400001', 19.0765, 72.8780, 'Review Contact', '10000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transit_mixers (
 id, plant_id, registration_number, capacity_m3, driver_id, status
)
VALUES (
 'b0000000-0000-4000-8000-000000000003',
 'b0000000-0000-4000-8000-000000000001',
 'PLAY-REVIEW-001', 6.00, 'a0000000-0000-4000-8000-000000000003', 'dispatched'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders (
 id, order_number, customer_id, plant_id, site_id, concrete_grade, total_quantity_m3,
 delivery_date, delivery_time_slot, pump_required, total_amount, tax_amount, status, payment_status
)
VALUES (
 'b0000000-0000-4000-8000-000000000004',
 'PLAY-REVIEW-001',
 'a0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000002',
 'M-25', 6.00, CURRENT_DATE, 'Play review', FALSE, 0.00, 0.00, 'dispatched', 'unpaid'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_loads (
 id, order_id, load_number, mixer_id, driver_id, quantity_m3, status, dispatched_at
)
VALUES (
 'b0000000-0000-4000-8000-000000000005',
 'b0000000-0000-4000-8000-000000000004',
 1,
 'b0000000-0000-4000-8000-000000000003',
 'a0000000-0000-4000-8000-000000000003',
 6.00, 'dispatched', NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO challans (
 id, load_id, challan_number, plant_code, customer_name, site_address,
 concrete_grade, quantity_m3, slump_mm, water_cement_ratio, mixer_number, driver_name, status
)
VALUES (
 'b0000000-0000-4000-8000-000000000006',
 'b0000000-0000-4000-8000-000000000005',
 'PLAY-REVIEW-CHALLAN-001', 'PLAY-REVIEW-PLANT',
 'TrackMyRMC Play Review Customer', 'Review-only demo location',
 'M-25', 6.00, 120, 0.45, 'PLAY-REVIEW-001',
 'TrackMyRMC Play Review Driver', 'generated'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO play_review_fixtures (role, user_id, plant_id, site_id, mixer_id, order_id, load_id)
VALUES
 ('customer', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005'),
 ('plant_owner', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', NULL, 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005'),
 ('driver', 'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', NULL, 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005')
ON CONFLICT (role) DO UPDATE SET
 user_id = EXCLUDED.user_id,
 plant_id = EXCLUDED.plant_id,
 site_id = EXCLUDED.site_id,
 mixer_id = EXCLUDED.mixer_id,
 order_id = EXCLUDED.order_id,
 load_id = EXCLUDED.load_id,
 enabled = TRUE;

-- Keep attempts table bounded; this cleanup runs only when reviewer login is used.
