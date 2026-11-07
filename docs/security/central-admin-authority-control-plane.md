# Central Admin and delegated Authority — control plane

Status: **implementation in PR #157; not automatically approved for production**.

## Boundary and deployment

- The installed production Nginx configuration serves the separately built `admin-web` bundle at `https://trackmyrmc.com/admin/` and proxies the existing Rust API to `/api/`.
- `central_admin` and `authority` are **web-only privileged roles**. No Expo application login, bottom tab, reviewer fixture or mobile refresh token is created for either.
- The endpoint accepts bearer tokens from HTTP clients, not "browser fingerprint" validation. **Web-only** means supported product login surface, not a claim that a mobile HTTP client is technically unable to send requests. Role, session provenance, permission, expiry and MFA are enforced on the Rust server.
- A permanent identity is retained in `users` until explicitly disabled; an authenticated session lasts **one hour** and cannot be silently refreshed.
- No migration automatically promotes an existing user. Any first Central Admin identity remains a separate, audited production bootstrap/approval procedure.

## Role control and implementation

| Responsibility | Central Admin | Delegated Authority |
| --- | --- | --- |
| Account authentication | `POST /api/admin/auth/verify-totp` | `POST /api/authority/auth/verify-totp` |
| Session / identity | `/api/admin/auth/me`, logout | `/api/authority/auth/me`, logout |
| Delegation | `/api/control-center/authority-access` with `admin_access.manage` and MFA step-up | No ability to grant permissions or manage other Authority identities |
| Users / plants / orders | Permission-gated Control Center collections | Explicit `user.view`, `plant.view`, `order.view` grants; no global edit |
| Owner approvals / suspensions | `plant_owners.manage` / step-up | Not delegable in this slice |
| Operational support | Support, service enquiries and RFQ leads | Granted `support.view` read-only, scoped fields |
| Marketing | Existing RFQ onboarding and outreach monitoring | Lead-status **monitoring only**, not bulk messaging or sending |
| KYC | Provider-evidence-gated approval/rejection with explicit `kyc.review`, reason and fresh MFA | `kyc.view` / `kyc.review`; fresh MFA and auditable decision |
| Automation | Existing native Rust template/policy/worker-health controls | Not delegable; no template publication or dead-letter requeue |
| Payments / billing | Existing module guards; complete platform financial operations require separate acceptance | Not delegable |
| Security / reviewer accounts / sessions | Central Admin-only, named capabilities and MFA | Not delegable |

### Authority entitlement contract

Only these **six** permissions may be assigned by Central Admin: `user.view`, `plant.view`, `order.view`, `support.view`, `kyc.view`, `kyc.review`.

An existing Customer, Driver, Owner, Staff, Plant Admin or Central Admin account cannot be silently promoted to Authority. A dedicated Authority account must be created or changed using the Central Admin authenticated web session and an audit reason. Revocation or any permission change invalidates previous Authority sessions. The Authority web session requires an active, approved account and a successfully enrolled authenticator. Authority first-time authenticator enrollment uses verified work-email OTP on the existing server-bound enrollment flow. No staff/mobile authentication completion can issue an Authority session.

### Approval and evidence

KYC provider consent verification stores metadata only, not identity document bytes. Marking a customer **verified** requires an existing pending review with a provider-confirmed `customer_digilocker_sessions` record and a verified name; a user-entered or callback-only status is not evidence. Every privileged decision must be audited. KYC login and review use separate web session provenance and time-bounded step-up.

### Safety and testing checklist

Required before merge/release:

1. Rust `cargo fmt --all -- --check`, `cargo check`, strict Clippy, unit/integration tests with PostgreSQL 16 and 18.
2. `admin-web` `npm run build` and browser tests at mobile/tablet/desktop widths.
3. An approved Central Admin fixture tests grant, reject, revoke and expired-session behavior. An approved Authority fixture tests wrong-role denial, no mobile login/token refresh, KYC evidence gates, and cross-tenant/privacy restrictions.
4. Validate production migrations, email OTP delivery and authenticator enrollment **without emitting secret keys or real customer data**; verify the expected production database.
5. Review Central Admin two-factor strength and establish an independently controlled, tested recovery/bootstrap process. Email address + TOTP code alone is not two independent factors.
6. Explicit release approval. No live marketing broadcasts, payments, AWS resource changes, production database writes or production deployment occur in this PR.

### Remaining integration work

The repository contains many platform endpoints but **not every module has a complete Control Center lifecycle UI or production acceptance**. Broad marketing campaigns / opt-ins / opt-outs, operational support replies, delegated onboarding approvals, full finance actions, reviewable KYC evidence UX, and cross-module reporting require dedicated authenticated APIs, audit/consent tests and release-specific acceptance. Do not label links, cards or mocked provider responses as completed integrations.

This PR deliberately strengthens the authority hierarchy first. Additional modules should extend these server-enforced entitlements and existing Rust services rather than introducing a parallel platform administrator identity or unrestricted external automation provider.
