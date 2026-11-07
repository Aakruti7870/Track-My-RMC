-- Synthetic disposable CI identity. Never run against production.
INSERT INTO users (id,phone,email,hashed_password,full_name,role,is_active)
VALUES ('00000000-0000-4000-8000-000000000040','ci-admin','ci-admin@example.invalid','$argon2id$v=19$m=19456,t=2,p=1$SvWTeNFS61/Ui+SOXVyNJw$JGIBa6UrWI3fvkiDP+jDI+a6plEeoYVpTM72VyGddR8','CI Central Admin','central_admin',TRUE);
INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled)
VALUES ('00000000-0000-4000-8000-000000000040','GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',TRUE);
INSERT INTO control_center_access (user_id,approved,permissions)
VALUES ('00000000-0000-4000-8000-000000000040',TRUE,
    ARRAY['system.view','user.view','plant.view','order.view','support.view','audit.view','session.view','plant_owners.manage']);
INSERT INTO plant_listing_requests(name,address,lat,lng,applicant_owner_name,applicant_email,applicant_mobile)
VALUES('CI Approval Plant','Synthetic CI approval address',0,0,'CI Approved Owner','ci-owner-approval@example.invalid','12025550877');
