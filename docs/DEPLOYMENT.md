# TrackMyRMC — Deployment and Release Runbook

## Deployment policy

- **Production target:** AWS. The intended architecture is an HTTPS Application Load Balancer, Rust/Axum service on ECS Fargate (or an explicitly approved equivalent), private Amazon RDS for PostgreSQL, Secrets Manager, CloudWatch logs/alarms, and automated deployment/rollback.
- **Preview/staging only:** Render may be used for short-lived integration verification. The repository's `render.yaml` is not proof that a service is provisioned, configured, or healthy, and it must not be treated as the production deployment.
- **No production cutover until release gates pass.** A successful CI run only verifies the checks executed by that workflow; it does not validate provider credentials, live migrations, backup restoration, or device flows.

## 1. Required AWS infrastructure

Before deployment, provision and verify:

1. A VPC with public ALB subnets and private application/database subnets across at least two Availability Zones.
2. An HTTPS ALB listener using an ACM certificate for the approved API hostname; redirect HTTP to HTTPS.
3. ECS service/task definition for the backend container, with health check `GET /health`, rolling deployment limits, and a rollback strategy.
4. Amazon RDS for PostgreSQL in private subnets. Use Multi-AZ for production, encryption at rest, automated backups, a documented retention period, and a tested point-in-time restore procedure.
5. AWS Secrets Manager entries for all production secrets. Do not commit secret values or place them in container images.
6. CloudWatch log retention, service/database alarms, deployment notifications, and a documented incident/rollback owner.
7. Security groups that allow only ALB-to-service traffic and service-to-database traffic on the required ports. Do not expose PostgreSQL publicly.
8. A migration release task that runs SQLx migrations once against the intended database before new application tasks receive traffic.

The exact AWS account, region, resource names, DNS records, and approved monthly budget must be confirmed before creating billable infrastructure.

## 2. Required application configuration

| Variable | Production requirement |
|---|---|
| `DATABASE_URL` | Private PostgreSQL connection string, stored as a secret |
| `APP_ENV` | `production` |
| `JWT_SECRET` | Unique high-entropy secret of at least 64 bytes |
| `JWT_EXPIRATION_HOURS` | Integer from 1 to 24 |
| `OTP_PEPPER` | Unique secret of at least 32 bytes |
| `CORS_ORIGIN` | **Required in production**; comma-separated exact HTTPS origins for every browser client (for example `https://trackmyrmc.com,https://admin.trackmyrmc.com`); never `*`. The API fails startup if unset or empty. |
| `PORT` | Runtime-provided port, or the explicitly configured service port |
| `META_WHATSAPP_TOKEN` | Required only when WhatsApp OTP delivery is enabled; store in Secrets Manager |
| `META_PHONE_NUMBER_ID` | Required for the configured WhatsApp sender |
| `META_WABA_ID` | Required where used by the WhatsApp integration |
| `EMAIL_API_KEY` | Required for production email OTP delivery |
| `EMAIL_FROM_ADDRESS` | Verified sender address for the configured email provider |
| `RUST_LOG` | Use `info` by default; avoid verbose production logging of user data |

Do not use development fallback secrets in production. Provider configuration must be tested with real, authorized test accounts before enabling login for customers.

## 3. Database migration and recovery

1. Take a verified backup/snapshot before schema changes.
2. Confirm the target database and migration list; run the repository's SQLx migrations through a controlled release task.
3. Confirm migration success and exercise critical reads/writes against staging.
4. Test restoring a backup into an isolated database and record the measured recovery time.
5. Never test destructive migrations or deletion workflows against production data.

## 4. Release gates

- Backend CI: Rust check, Clippy, tests and formatting step pass on the exact release commit.
- Frontend CI: TypeScript/readiness checks, Android layout, Expo web export and admin build pass on the same release commit.
- Authentication: WhatsApp OTP, email OTP, TOTP, recovery codes, logout/session revocation and inactive-user rejection are tested end-to-end.
- Data: account-deletion request, cancellation, authorized completion/de-identification, retention rules and audit trail are reviewed and tested.
- Operations: HTTPS, CORS, secret injection, database connectivity, backup restoration, logs/alarms, rollback and real Android device smoke tests pass.
- API contract: mobile and admin clients are tested against the actual deployed staging backend, not only static mocks or CI checks.

## 5. Current status

This file is a runbook, not a deployment attestation. The current production AWS account/resources, live PostgreSQL migration state, provider delivery, backup restoration, and real-device smoke tests have not been verified by this document. Do not mark production ready until evidence for each release gate is recorded.
