# Central Admin and delegated Authority — control plane

Status: **implemented on main; production enrollment, deployment and feature activation still require independent release acceptance**. PR #157 established the control plane; PR #159 added explicitly delegated support replies and a staff-only support notification feed.

## Boundary and deployment

- The installed production Nginx configuration serves the separately built `admin-web` bundle at `https://trackmyrmc.com/admin/` and proxies the existing Rust API to `/api/`.
- `central_admin` and `authority` are **web-only privileged roles**. No Expo application login, bottom tab, reviewer fixture or mobile refresh token is created for either.
- The endpoint accepts bearer tokens from HTTP clients, not "browser fingerprint" validation. **Web-only** means supported product login surface, not a claim that a mobile HTTP client is technically unable to send requests. Role, session provenance, permission, expiry and MFA are enforced on the Rust server.
- A permanent identity is retained in `users` until explicitly disabled; an authenticated session lasts **one hour** and cannot be silently refreshed.
- No migration automatically promotes an existing user. Any first Central Admin identity remains a separate, audited production bootstrap/approval procedure.

## Role control and implementation

| Responsibility | Central Admin | Delegated Authority |
| --- | --- | --- |
| Account authentication | Email + independently hashed Argon2id password + TOTP at `POST /api/admin/auth/verify-totp` | Email + Argon2id password + TOTP at `POST /api/authority/auth/verify-totp` |
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
5. Verify password + TOTP enforcement including wrong-password, missing-password, stale challenge, role mismatch, session replacement and initial Authority enrollment. Account recovery requires controlled operator verification, never email-only self-service. The independently approved privileged recovery lifecycle is not implemented; see `pr157-release-assessment.md`.
6. Explicit release approval and independently verified production identity/bootstrap rehearsal. No live marketing broadcasts or payments are automatically enabled, and no AWS production write or deployment is performed by CI.


## Production bootstrap runbook (operator-controlled)

There is no seeded root account, default password, email allowlist bypass, or public registration
route for Central Admin. The bootstrap example exists only as an explicit operator command.
**Never use CI, production startup, an automated deployment hook, or a remote logged terminal
to provision privileged credentials.**

1. Obtain two-person approval of the named Central Admin identity and exact production
   database. Verify current DB name, account, network path, migration checksums and
   current backups separately. Do not infer the database name from the RDS instance name.
2. From a trusted interactive terminal with secure secret-handling controls, run the
   SHA-pinned source's `backend/examples/bootstrap_central_admin.rs` using:
   `cargo run --release --example bootstrap_central_admin -- --apply --expected-database <VERIFIED_DATABASE> --email <APPROVED_EMAIL> --name <APPROVED_NAME>`
   with `DATABASE_URL` supplied securely outside shell history.
3. The tool requires a private terminal, validates the current database, refuses any
   existing Central Admin identity or email collision, accepts a hidden password,
   generates a new authenticator, checks a live code **before** a single transactional
   account creation, hashes backup codes and writes an audit event.
4. Store the printed authenticator provisioning URI and single-use recovery codes securely,
   separate from the password. Do not allow shell/SSM/CI session output capture, helpdesk
   screenshots or centralized transcript logging of these secrets.
5. Validate a separate browser login using password + authenticator; verify account
   permissions, wrong-role denial and logout/session replacement before enabling operational
   modules. Use only consented real accounts for live acceptance.

**Existing root account:** This first-account command intentionally refuses to overwrite
existing Central Admin identities. An old TOTP-only root record has no usable password
and must not be silently upgraded. Recovery requires an independently approved
out-of-band identity verification and audited database credential rotation by authorized
operators. There is no unverified email-only password recovery API or backdoor.

### Authority first-time login

1. Central Admin grants exactly the required six-capability subset using fresh step-up
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
code between proofs. Neither the bootstrap command nor generated backup codes constitute
an implemented independently approved emergency recovery flow.
