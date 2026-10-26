# TrackMyRMC P0 launch closeout — 26 October 2026

**Status:** NO-GO for unrestricted public launch; never interpret green CI as provider or device acceptance.

## Evidence baseline (read-only at capture)

- The pinned web/API production release `19892d7f1ba833f88dbdfa00d9604c2d897bc948` passed Backend CI PG16/PG18, Frontend CI and the AWS production deploy (Actions 40240220098, 40240220010, 40240468931).
- EC2 SSM online, `trackmyrmc-backend` and RDS credential recovery timer active; TLS trusted-origin health passes.
- RDS 18.3 is encrypted, deletion-protected, `7`-day automated backup retention. Existing **running database name is `postgres`**, not intended `trackmyrmc`. It has SQLx migrations through 0040.
- Production has **zero CloudWatch alarms, zero SNS topics, zero CloudWatch log groups**. No off-host alert delivery has been proven.
- `TRACKMYRMC_KYC_ENABLED=false`; Cashfree sandbox runtime flags unset and hard-disabled by `APP_ENV=production`. Existing provider/customer acceptance evidence must be connected to this application before enabling.
- Cashfree `ops/pending-migrations/cashfree_sandbox_intents.sql` remains **outside automatic SQLx migration execution**. Merchant-pricing approval and financial posting/refund settlement are not accepted. Never claim customer invoices are paid because a webhook was received.

## Ready-to-run nonmutating checks

Run on EC2 (not GitHub runner):

```bash
bash /opt/trackmyrmc/source/ops/release/launch_preflight_readonly.sh
```

This probes exact release marker, systemd backend/Nginx/recovery timer, selected database **name only**, migration version, trusted-origin /health, anonymous /api/me and /api/customer/kyc rejection. The probe does not run SQL writes, print credentials, charge cards, create identities, or change services.

Review AWS inventories with read-only CLI: `aws cloudwatch describe-alarms`, `aws sns list-topics`, `aws logs describe-log-groups`, `aws rds describe-db-instances --db-instance-identifier trackmyrmc-postgres`, and `aws rds describe-db-snapshots --db-instance-identifier trackmyrmc-postgres --snapshot-type automated`.

## Operational monitoring activation — P0

1. Obtain explicit AWS spend approval and a confirmed 24x7 incident owner + notification email/telephone. Create/verify an SNS subscription; never store personal contacts in source.
2. Review `ops/monitoring/trackmyrmc-production-alarms.yml` and budget. Apply only after approval with an existing verified SNS topic. Alarm conditions include EC2 system/instance failures and RDS storage/CPU.
3. Configure *restricted-access, encrypted* off-host logs with retention, sensitive-field redaction and queries; verify logs do not include `DATABASE_URL`, OTP, JWT, Cashfree tokens, Aadhaar, KYC payloads, request signatures or driver contact/PII. Start with backend error/audit events and retained nginx security events. Set explicit retention and budget caps.
4. Prove end-to-end alert delivery using a controlled test alarm or approved operational test, acknowledge it and record screenshots/timestamps. Disabling metrics, creating an SNS topic without subscriptions, or merely validating a CloudFormation template does **not** clear P0.

## Isolated database restore & rollback — P0

1. Record RDS source snapshot ID, current instance database name, migration checksums, size and row-count/hash inventory of critical tables. Enforce encryption and deletion protection.
2. Obtain explicit approval for a **potentially billable** isolated RDS restore. Place the new restore in a private network with no app traffic and distinct credentials, disable any outgoing WhatsApp/Cashfree/KYC callbacks, and restrict users.
3. Restore to a **new** instance; never overwrite or retarget live `DATABASE_URL`. Run read-only schema/row/parity and application-health checks against isolated restored data. Capture repeatable recovery time.
4. Rehearse a pinned release rollback **only in the isolated environment** and verify no newer data is accidentally overwritten. Do not manually set `_sqlx_migrations` checksums, reset production migrations or use `DROP DATABASE`.
5. Record recovery point objective, recovery time objective, backup consistency, actual operator and observed pass/fail evidence in #106. Keep production pointed at `postgres` until an approved cutover preserves all real records.

## Cashfree release gate

- Production posting is prohibited until merchant credentials/environment pairing, approved plant plan SKUs and prices, customer invoice balances, signed webhook verification, retry/duplicate/refund and settlement reconciliation all pass on **real Cashfree sandbox API responses**.
- A verified sandbox payment is **not money received**. Its accounting must remain isolated. Provider failures/timeouts must not grant plan access or over-credit invoices.
- The sandbox table migration must be reviewed and assigned a free number after SQLx 0040 with a measured rollback/restore procedure. Do not move the staged DDL under `backend/migrations/` just to make CI pass.
- Treat plan promotion entitlements, taxes, partial payments, refunds and actual deposit settlement as individually required acceptance cases; do not invent prices or silently process a live refund.

## 13-role security/operational acceptance

**Roles:** Customer, Driver, Plant Owner, Admin, Dispatcher, Operator, Supervisor, Accountant, Quality Engineer, Fleet Manager, Store Manager, Authority, Central Admin.

All roles require negative auth tests, active-account checks, MFA as appropriate, denied cross-plant data access, create/edit/approve ceilings and audit trails; owner exception must require owning an active plant. Automated synthetic tests are useful but **do not substitute** live privileged identity provisioning, physical-device journeys or staff sign-off. Authority reviewer must remain distinct from Central Admin and cannot be replaced with a bypass.

## Android signed candidate and Play gate

1. Confirm `frontend/app.json` has package `com.trackmyrmc.concreteking`, matching `2.0.32 / versionCode 90` in `.github/workflows/android-build.yml`; verify expected upload certificate fingerprint and signing secret presence without reading private keys.
2. Run privacy/location, account deletion, notification, Play-review MFA, app links and role-routing static checks. Build a signed AAB only through a reviewed workflow on the **exact accepted SHA**. Never upload to Play automatically.
3. Test two physical Android devices (including recent API), denied/allowed fine/background location, offline GPS/resume, Android back handling, WhatsApp OTP, MFA, KYC return, order/POD, Cashfree callback and deep links.
4. Secure Play Console reviewer sign-off and a final owner **GO** after monitoring, restore, provider, role, pricing and support/incident gates are evidenced.

## Release policy

A merged and deployed change may prove **software delivery**, not that live identity, money movement, driver location or emergency workflows are safe. Keep P0 issue #106 open until every gate has exact artifacts, device/provider receipts and owner sign-off.
