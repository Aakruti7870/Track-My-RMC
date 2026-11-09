# Central Admin and delegated Authority — control plane

Status: **implemented on main; production enrollment, deployment and feature activation still require independent release acceptance**. PR #157 established the control plane; PR #159 added explicitly delegated support replies and a staff-only support notification feed.

## Boundary and deployment

- The installed production Nginx configuration serves the separately built `admin-web` bundle at `https://trackmyrmc.com/admin/` and proxies the existing Rust API to `/api/`.
- `central_admin` and `authority` are **web-only privileged roles**. No Expo application login, bottom tab, reviewer fixture or mobile refresh token is created for either.
- The endpoint accepts bearer tokens from HTTP clients, not "browser fingerprint" validation. **Web-only** means supported product login surface, not a claim that a mobile HTTP client is technically unable to send requests. Role, session provenance, permission, expiry and MFA are enforced on the Rust server.
- A permanent identity is retained in `users` until explicitly disabled; an authenticated session lasts **one hour** and cannot be silently refreshed.
- The approved AWS release reserves `support@trackmyrmc.com` as an inactive Central Admin identity. The account owner activates the reserved identity in the admin browser after verifying email and confirming authenticator setup.

## Role control and implementation

| Responsibility | Central Admin | Delegated Authority |
| --- | --- | --- |
| Account authentication | Registered email OTP at `POST /api/admin/auth/login`, then challenge-bound TOTP at `POST /api/admin/auth/verify-totp` | Email + Argon2id password + TOTP at `POST /api/authority/auth/verify-totp` |
| Session / identity | `/api/admin/auth/me`, logout | `/api/authority/auth/me`, logout |
| Delegation | `/api/control-center/authority-access` with `admin_access.manage` and MFA step-up | No ability to grant permissions or manage other Authority identities |
| Users / plants / orders | Permission-gated Control Center collections | Explicit `user.view`, `plant.view`, `order.view` grants; no global edit |
| Owner approvals / suspensions | `plant_owners.manage` / step-up | Not delegable in this slice |
| Operational support | Support, service enquiries and RFQ leads | Granted `support.view` for platform support cases; `support.reply` may additionally be delegated for staff replies, notes and own alert acknowledgements. Case status management remains Central Admin-only with fresh MFA |
| Marketing | Existing RFQ onboarding and outreach monitoring | Lead-status **monitoring only**, not bulk messaging or sending |
| KYC | Provider-evidence-gated approval/rejection with explicit `kyc.review`, reason and fresh MFA | `kyc.view` / `kyc.review`; fresh MFA and auditable decision |
| Automation | Existing native Rust template/policy/worker-health controls | Not delegable; no template publication or dead-letter requeue |
| Payments / billing | Existing module guards; complete platform financial operations require separate acceptance | Not delegable |
| Security / reviewer accounts / sessions | Central Admin-only, named capabilities and MFA | Not delegable |

### Authority entitlement contract

Only these **seven** permissions may be assigned by Central Admin: `user.view`, `plant.view`, `order.view`, `support.view`, `support.reply`, `kyc.view`, `kyc.review`. `support.reply` requires `support.view`; Authority cannot receive `support.manage` or global privileges.

An existing Customer, Driver, Owner, Staff, Plant Admin or Central Admin account cannot be silently promoted to Authority. A dedicated Authority account must be created or changed using the Central Admin authenticated web session and an audit reason. Revocation or any permission change invalidates previous Authority sessions. The Authority web session requires an active approved account, an Argon2id password and a successfully enrolled authenticator. First-time Authority enrollment requires verified work-email OTP, followed by authenticator enrollment and a one-use server-bound login challenge plus fresh TOTP at `POST /api/authority/auth/set-initial-password`. This can only replace `!web-only-no-password!` on a dedicated Authority account. No staff/mobile authentication completion can issue an Authority session.

### Approval and evidence

KYC provider consent verification stores metadata only, not identity document bytes. Marking a customer **verified** requires an existing pending review with a provider-confirmed `customer_digilocker_sessions` record and a verified name; a user-entered or callback-only status is not evidence. Every privileged decision must be audited. KYC login and review use separate web session provenance and time-bounded step-up.

### Safety and testing checklist

Required before merge/release:

1. Rust `cargo fmt --all -- --check`, `cargo check`, strict Clippy, unit/integration tests with PostgreSQL 16 and 18.
2. `admin-web` `npm run build` and browser tests at mobile/tablet/desktop widths.
3. An approved Central Admin fixture tests grant, reject, revoke and expired-session behavior. An approved Authority fixture tests wrong-role denial, no mobile login/token refresh, KYC evidence gates, and cross-tenant/privacy restrictions.
4. Validate production migrations, email OTP delivery and authenticator enrollment **without emitting secret keys or real customer data**; verify the expected production database.
5. Verify Central Admin email OTP and authenticator enforcement, OTP and TOTP replay rejection, challenge expiry, role mismatch, session replacement and recovery with a saved single-use code. Verify password and authenticator enforcement and initial enrollment for Authority separately.
6. Explicit release approval and independently verified production identity/bootstrap rehearsal. The bootstrap rehearsal uses a disposable database. Live marketing broadcasts and payments require separate activation.


## Primary Central Admin enrollment and recovery

The AWS release reserves `support@trackmyrmc.com` after backend and web health checks.
Reservation is idempotent and refuses conflicting identities. Verify the running
service database and migration state independently. The RDS initial database name
does not identify the service's active database.

1. The owner opens `https://trackmyrmc.com/admin/` privately, enters the reserved
   email and verifies the received OTP. The result is a five-minute Central Admin
   challenge. First enrollment relies on the preapproved mailbox remaining under
   the owner's control.
2. The owner adds the setup key to an authenticator app and submits its current
   code. The server confirms possession, enables the credential, activates the
   reserved account, grants the fixed Central Admin permissions and creates the
   one-hour web session in one transaction.
3. The owner stores the one-time recovery codes privately and opens the Control
   Center. After signing out, the owner verifies a new email OTP and uses a fresh
   authenticator code to confirm a subsequent login. Keep live setup keys, OTPs,
   recovery codes and tokens out of CI, remote session logs and screenshots.

If the authenticator is lost, verify a new email OTP and choose **Recover with a
saved code**. A valid single-use code opens a replacement-authenticator challenge.
Confirm the replacement authenticator to rotate all recovery codes and revoke
previous sessions. Store the new recovery codes securely. If both authenticator
and codes are lost, recovery requires independently approved operator verification
and audited credential recovery. A suspended identity is ineligible for recovery.

### Authority first-time login

1. Central Admin grants an approved subset of the seven explicitly delegable capabilities using fresh step-up
   and a written audit reason. Existing staff/customer/owner identities are never promoted.
2. The approved Authority chooses **First sign-in** on the web portal, verifies the
   registered work email via OTP and enrolls the authenticator. Existing staff MFA
   continues through its own login path.
3. The Authority sets a private 16-128 byte password through a five-minute, single-use
   challenge and current TOTP code. No web or mobile JWT is issued by enrollment.
4. Subsequent Authority sign-in requires the password and a new authenticator code.
   A change of grants or account suspension invalidates existing sessions immediately.

## Release-blocking external evidence

- Successful latest-commit PG16/18 format, check, Clippy, tests, and browser CI.
- Isolated real browser Authority first-time enrollment, password rejection and revocation.
- Provider-consented DigiLocker proof acceptance; no synthetic session may be represented as real verification.
- Production database/backup/rollback and secret-delivery verification against the exact AWS target.
- Verified account-specific recovery process and release approval. Public messaging and
  payment features remain independent gated integrations.

### Remaining integration work

The repository contains many platform endpoints but **not every module has a complete Control Center lifecycle UI or production acceptance**. Broad marketing campaigns / opt-ins / opt-outs, delegated onboarding approvals, full finance actions, reviewable KYC evidence UX, and cross-module reporting require dedicated authenticated APIs, audit/consent tests and release-specific acceptance. Do not label links, cards or mocked provider responses as completed integrations.

This PR deliberately strengthens the authority hierarchy first. Additional modules should extend these server-enforced entitlements and existing Rust services rather than introducing a parallel platform administrator identity or unrestricted external automation provider.


## Remediation verification and release decision

See [PR #157 release assessment](pr157-release-assessment.md) for findings, isolated test
results, production-only gates and unresolved recovery/integration blockers. Privileged
bearers now live only in dashboard memory; reload requires login. Enrollment, login,
step-up and rotation reject a reused privileged TOTP step, so wait for a fresh authenticator
code between proofs. A Central Admin with neither an authenticator nor a saved recovery code requires the independently approved emergency process.
