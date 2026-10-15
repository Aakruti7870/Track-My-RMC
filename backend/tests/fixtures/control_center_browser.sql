-- Synthetic disposable CI identity. Never run against production.
INSERT INTO users (id,phone,email,hashed_password,full_name,role,is_active)
VALUES ('00000000-0000-4000-8000-000000000040','ci-admin','ci-admin@example.invalid','unused','CI Central Admin','central_admin',TRUE);
INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled)
VALUES ('00000000-0000-4000-8000-000000000040','GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',TRUE);
INSERT INTO control_center_access (user_id,approved,permissions)
VALUES ('00000000-0000-4000-8000-000000000040',TRUE,
    ARRAY['system.view','user.view','plant.view','order.view','support.view','audit.view','session.view']);
