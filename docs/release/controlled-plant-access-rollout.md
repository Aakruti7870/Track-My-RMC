# Controlled plant access: review and recovery

This change stays on PR #141. It is not permission to merge, deploy, modify
production data, send live invitations, or provision paid infrastructure.
Merging main can trigger the existing AWS deployment and startup migrations.

## Migration and compatibility contract

Existing migration files 1–45 retain their checksums. Migration 46 adds verified
work-email metadata, explicit employment states and assignment generations,
append-only staff history, bounded Manager capabilities and Create/Export flags.
It adds a case-normalized email index. Case collisions abort migration and require
operator review; no identity is deleted, merged or automatically repaired.

Pending and suspended assignments retain `removed_at IS NULL`, so migration 42's
partial unique index still reserves the role. Termination, cancellation, explicit
expiry and soft removal release that reservation transactionally. Rehire changes
the assignment generation, retains history and clears old permissions/delegations.
Email OTP verification alone never activates pending employment. Final MFA
completion activates the assignment and binds the new session in one transaction.

Legacy effective role defaults are materialized once as explicit compatibility
grants, preserving stored denials. New assignments receive no module grants;
missing rows deny access. Create and Edit are independent for new clients. Old
three-flag permission payloads retain `create=edit`, `export=false`. Export needs
separate approval and only exports the existing non-financial plant summary.
Existing UUID staff-link endpoints remain for verified work-email identities;
the UI uses invitations. Legacy lifecycle endpoints record their legacy-client
reason; the new endpoint requires a supplied reason. Manual stock reductions need
the Plant Owner. Production consumption/dispatch ledgers keep their own controls.

Owner approval/list/rejection now require the existing dedicated Central Admin
web MFA session and explicit `plant_owners.manage` capability. Mutations require
recent step-up. An operator must review/provision that capability through the
approved administrative process; it is not auto-granted by migration. Ordinary
mobile Admin/Authority roles are not aliased to Central Admin. The legacy direct
plant-creation endpoint directs clients to reviewed onboarding instead of issuing
unapproved ownership. Existing clients receive explicit authorization errors.

## Required release gates

1. Pin the candidate and current main SHAs. Require fresh Backend CI 16/18,
   Frontend CI, admin build, real browser/Expo acceptance and security review.
2. Run `ops/release/controlled-access-preflight.sql` using the approved read-only
   production identity. Compare migration checksums with the candidate files and
   investigate every nonzero collision, role/email mismatch or failed migration.
   Identify the actual database before proceeding. Do not reuse historical
   `duplicate_role_slots=0`, `assigned_slots=0`, `applied_migration_max=44` results.
3. Confirm a current approved encrypted backup/PITR window. An existing configured
   backup is not proof of recovery. Record the backup reference privately and
   perform an operator-approved isolated restore and application smoke test.
   This task does not create a billable restore instance or production backup.
4. Rehearse upgrade from production-shaped history with 44 already recorded and
   42/43/45/46 pending. SQLx tests cover that order, repeat startup, old checksums,
   application records, duplicate-slot rollback and email-conflict rollback.
5. Confirm all existing active assignments' compatibility grants and new Manager
   limits with Owners. Unverified staff identities use invitation claiming;
   suspended staff cannot be silently reactivated by linking their UUID again.
6. Verify signed-device and real delivery-provider behavior with separate
   approval. Synthetic delivery does not establish live SMTP/WhatsApp readiness.
   Reviewer identity isolation and the existing bounded legacy JWT grace remain
   unchanged; verify the actual cutover population before declaring universal
   production single-session enforcement.
7. Obtain independent review and explicit production release approval. Leave the
   PR open/Ready for review until every required gate is satisfied. Do not enable
   auto-merge or manually apply production migrations.

## Failure and rollback

SQLx applies each migration transactionally. A collision must abort startup and
roll back that migration's DDL/history. Stop promotion, retain diagnostic evidence
without credentials, and verify the last successful migration/checksums. A
reviewed manual data correction must preserve both identities and business data.
Retry the same unchanged migration only after the conflict is reviewed.

Do not delete or rewrite `_sqlx_migrations`, edit an already applied migration,
drop the slot constraint, delete staff, or run destructive down-migrations to
obtain a successful deployment. A prior artifact that bypasses session checks or
uses implicit role defaults is not a safe security rollback. Prefer a reviewed
forward fix or maintenance mode while retaining enforcement. Keep additive schema
and audit history in place when an older artifact is proven compatible.

Database restore is an operator-approved incident action: it can discard newer
orders, payments and other writes. Follow the existing recovery gate and isolate
the restored database before switching traffic. Reconcile post-backup writes and
repeat authorization, reviewer, RFQ, order, Cashfree/KYC and GPS smoke tests.

## Evidence limits

Local/CI databases contain synthetic data only. This environment has no configured
production database/AWS identity. Production preflight, backup/restore proof,
signed native devices, live providers and release approval must be reported as
blocked or unverified until actual evidence exists. No production deployment is
authorized by green CI.
