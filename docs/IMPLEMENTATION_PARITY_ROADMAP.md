# Tracking-project → TrackMyRMC Parity Implementation Plan

Baseline source: `Aakruti7870/Tracking-project` (FastAPI/MongoDB).
Target: `Aakruti7870/Track-My-RMC` (Rust/Axum/PostgreSQL).
Baseline target commit: `2baacca7e3f7a7fa564bfb0e78359ba7dd32d5a2`.
This plan is a delivery checklist; it is not evidence that any feature or data migration is complete.

## Non-negotiable release rules

- Keep TrackMyRMC's Rust/PostgreSQL target architecture; port business behavior, not the original Python runtime.
- Preserve the existing role model and least-privilege checks. Do not add roles just to mimic implementation details.
- Do not expose incomplete authentication, admin, passkey, KYC, payment, or deletion endpoints.
- Do not run destructive migrations or change the production database target until live DB identity, backup/PITR, migration history, and data parity are verified.
- Do not deploy real WhatsApp OTP changes until Meta template/payload and a controlled authorized-recipient delivery plus status-webhook flow are verified.
- Do not copy secrets, provider credentials, production data, or original MongoDB documents into source control.
- Every phase requires CI, API contract tests, role-isolation tests, and staging verification before production rollout.

## Phase 0 — Inventory and safe baseline (blocker)

- [ ] Freeze and record source/target commit SHAs.
- [ ] Build a route-to-route contract inventory for every original router and frontend API call.
- [ ] Compare entity fields, constraints, state machines, role checks, audit events, and side effects.
- [ ] Verify live production DB host/name and applied SQLx migration version without printing credentials.
- [ ] Confirm backup/PITR and prepare read-only count/relationship reconciliation against the original source DB.
- [ ] Capture baseline health, TLS, logs, current deployment SHA, and rollback release.

## Phase 1 — Client/API contract and compliance essentials

- [ ] Align frontend auth client calls with actual Rust handlers.
- [ ] Implement staff MFA method discovery without identifier-only MFA bypass.
- [ ] Implement account deletion status/request/cancel and public request only after authorization, verification, retention, and audit semantics are specified.
- [ ] Implement Play review access only with dedicated non-privileged, scoped test identities and explicit configuration; never expose demo login in production.
- [ ] Implement public policy and Android App Links/asset links endpoints with correct production signing fingerprint.
- [ ] Verify customer/driver WhatsApp OTP and staff email OTP end-to-end with authorized tests.

## Phase 2 — Plant, customer and order lifecycle parity

- [ ] Plant discovery, eligibility/visibility and onboarding.
- [ ] Business profile, plant staff membership, access controls and plans/promotions.
- [ ] Customer KYC gating and verification/recovery lifecycle.
- [ ] Order quotations, project/site support, authoritative state machine and event history.
- [ ] Dispatch/load lifecycle, multiple loads, mixer/driver assignment and scoped live tracking.
- [ ] Challan/POD uploads, signatures, evidence retrieval and retention.

## Phase 3 — Production, quality, fleet and inventory

- [ ] Operator production lifecycle and batch/production records.
- [ ] Quality testing, cube-test follow-up, acceptance/rejection and audit trail.
- [ ] Fleet/mixer/driver management, availability/maintenance and tracking history.
- [ ] Store/inventory master data, stock movements and over-issue guards.
- [ ] SOS/incidents/support-case lifecycle.

## Phase 4 — Finance, HR and payroll

- [ ] Invoices, payments, ledger and billing history with idempotent payment handling.
- [ ] HR/employee master and staff actions.
- [x] Initial read-only monthly workforce report endpoint (attendance counts + persisted payroll closure summary; plant/role scoped).
- [ ] Full workforce reports, employee master, payroll workflow, closure, payslips, concurrency and audit parity.
- [ ] Payroll calculation, closure, period guards, concurrency and audit evidence.
- [ ] Role/plant scoping and reconciliation tests for all financial records.

## Phase 5 — Notifications, integrations and platform operations

- [ ] In-app notification feed/read/read-all and push delivery status.
- [ ] Map/route/geocoding adapter with safe provider configuration.
- [ ] DigiLocker/KYC provider integration and callback security, only with verified provider contract/credentials.
- [ ] Automation scheduler/worker, heartbeat, retry/idempotency and provider adapters.
- [ ] Assistant workflows with server-side authorization and explicit safe actions.
- [ ] Storage provider, upload validation, access-scoped downloads and cleanup/retention.

## Phase 6 — Admin/security parity

- [ ] Admin/control-center workspaces, account/plant access management and audit views.
- [ ] Challenge-bound email OTP → TOTP/recovery for privileged staff.
- [ ] Session revocation, account-state checks, rate limits, request security and security audit events.
- [ ] Passkeys only after full WebAuthn challenge, origin, RP-ID, signature, user-verification and counter checks.
- [ ] Public/admin route isolation and authorization tests for every action.

## Phase 7 — Migration, release and acceptance

- [ ] Read-only reconcile MongoDB source counts and relationships with PostgreSQL target.
- [ ] Produce a signed-off mapping/exception report before any data cutover.
- [ ] Test restore/PITR and rollback in staging.
- [ ] End-to-end tests for every supported role and critical workflow.
- [ ] Verify mobile Android release artifact, package/signing fingerprint, reviewer flows and Play policy endpoints.
- [ ] Canary deploy, monitor errors/latency/provider delivery, then complete production rollout only after release gates pass.

## Current confirmed route-surface gaps

The current Rust router does not register equivalents for these original router domains: account deletion, automation, assistant, control center, finance operations, HR master, KYC recovery, maps, notifications, operator operations, payroll closure/guards/concurrency, permanent access, plant discovery, plant onboarding, plant plans, Play review, public policy, staff management, storage, workforce reports, and workforce roster beyond the limited current roster/attendance routes.

This list indicates missing route registration in the inspected router, not proof that every domain has zero partial implementation elsewhere. Each item must be checked against Rust services, schemas, migrations, and frontend consumers before coding.

## Implemented on `feat/original-module-parity-phase-1` (pending CI)

- Added `GET /api/workforce-reports/monthly?plant_id=<uuid>&month=YYYY-MM`.
- Requires a bearer-authenticated role; supports owner/admin/accountant/supervisor with plant scoping for non-admin users and owner-plant verification.
- Returns monthly attendance aggregates and the existing persisted payroll closure summary; it does not infer salary from attendance or mutate payroll.
- Existing WhatsApp OTP send/verify handlers and implementation files were not modified in this slice.

## Definition of done per module

A module is complete only when its route contract, schema/migration, service logic, authorization, audit/side effects, frontend integration, unit/integration tests, staging verification, monitoring and rollback behavior are all reviewed. Compilation alone is not completion.
