-- Synthetic disposable CI identity. Never run against production.
INSERT INTO users (id,phone,email,hashed_password,full_name,role,is_active)
VALUES ('00000000-0000-4000-8000-000000000040','ci-admin','ci-admin@example.invalid','$argon2id$v=19$m=19456,t=2,p=1$SvWTeNFS61/Ui+SOXVyNJw$JGIBa6UrWI3fvkiDP+jDI+a6plEeoYVpTM72VyGddR8','CI Central Admin','central_admin',TRUE);
INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled)
VALUES ('00000000-0000-4000-8000-000000000040','GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',TRUE);
INSERT INTO control_center_access (user_id,approved,permissions)
VALUES ('00000000-0000-4000-8000-000000000040',TRUE,
    ARRAY['system.view','user.view','plant.view','order.view','support.view','support.reply','audit.view','session.view','plant_owners.manage']);
INSERT INTO plant_listing_requests(name,address,lat,lng,applicant_owner_name,applicant_email,applicant_mobile)
VALUES('CI Approval Plant','Synthetic CI approval address',0,0,'CI Approved Owner','ci-owner-approval@example.invalid','12025550877');

-- Separate public synthetic Authority, never a promotion of the administrator.
INSERT INTO users (id,phone,email,hashed_password,full_name,role,is_active)
SELECT '00000000-0000-4000-8000-000000000041',NULL,'ci-authority@example.invalid',hashed_password,'CI Authority','authority',TRUE
FROM users WHERE id='00000000-0000-4000-8000-000000000040';
INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled)
VALUES ('00000000-0000-4000-8000-000000000041','GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',TRUE);
INSERT INTO control_center_access (user_id,approved,permissions)
VALUES ('00000000-0000-4000-8000-000000000041',TRUE,ARRAY['user.view','plant.view','order.view','support.view','support.reply']);

-- Platform-only synthetic support inboxes; both worker flags stay OFF.
INSERT INTO users(id,phone,hashed_password,full_name,role) VALUES
 ('00000000-0000-4000-8000-000000000042','ci-support-customer','!synthetic!','CI Support Customer','customer');
INSERT INTO support_cases(id,user_id,subject,category,status) VALUES
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000042','CI Admin Support','GENERAL','OPEN'),
 ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000042','CI Authority Support','GENERAL','OPEN');
INSERT INTO native_support_followups(case_id,due_at,next_attempt_at,reminder_count) SELECT id,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 hour',1 FROM support_cases WHERE id IN
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000044');
INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES
 ('00000000-0000-4000-8000-000000000040','Customer support follow-up due','Review the case in the secure web dashboard.','support_followup','00000000-0000-4000-8000-000000000043'),
 ('00000000-0000-4000-8000-000000000041','Customer support follow-up due','Review the case in the secure web dashboard.','support_followup','00000000-0000-4000-8000-000000000044');
