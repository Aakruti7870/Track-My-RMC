# PR #141 release and recovery procedure

Status: HOLD until the final head passes CI, independent code/security review,
device acceptance, operational recovery checks, and explicit production rollout approval.
Merging main can automatically deploy and run embedded SQLx migrations.

## Before approval

1. Pin the candidate head and current main SHAs. Recheck mergeability and all
   successful workflow runs against that exact candidate. Never use results from
   an earlier head. Review Smart RFQ, order, KYC, payment, Maps and role journey checks.
2. Rerun the read-only production preflight immediately before deployment. Require
   zero duplicate reserved staff slots and no failed migration entries. Record all
   applied versions/checksums and customer/order baseline counts privately.
3. Confirm the runtime database from the live service configuration without printing
   its connection string. Resolve any discrepancy with the documented intended
   database through operator review. Do not change the target automatically.
4. Obtain approval for an encrypted manual backup of the actual database instance.
   Wait until the snapshot is available. Confirm retention, encryption, recent
   point-in-time recovery, application artifacts and the deployed release marker.
5. Restore that backup to a separate, approved recovery environment. Verify schema
   and migration history, customer/order data parity, and read-only application
   smoke tests. Rehearse the recovery/failover procedure and record its owner,
   timestamp, artifact SHAs, snapshot identifier, RPO and RTO.
6. Exercise migrations 42/43 against the restored installation with migration 44
   already applied. Check original history/checksums and records before and after.
   Exercise a deliberate duplicate-role fixture separately: migration 42 must abort
   transactionally and retain both employee records.
7. Keep the PR Ready for review, open, with no auto-merge enabled until every gate
   is satisfied and the exact rollout is approved.

## Migration execution and failure

Use the approved SHA-pinned deployment pipeline; do not run production SQL manually.
SQLx applies the unapplied migrations by version even if version 44 is recorded.
Each PostgreSQL migration is transactional.

If migration 42 encounters duplicate reserved roles, stop the rollout. Confirm
rollback left no partial columns/index/audit table or successful 42/43 entries.
Owners must review and explicitly resolve each assignment conflict; never delete
employees, release suspended slots, modify migration checksums, or mark a failed
migration successful to proceed.

Migration 42 can commit before a later migration fails. Inspect exact history and
schema before retrying. Preserve its checksum and rerun only through the approved
deployment process after the root cause is fixed. Do not assume both files commit
as one transaction.

## Application rollback and database recovery

Prefer a reviewed forward fix with the additive schema retained. Reverting to
pre-session-security code can stop enforcing active JTIs and revive replaced
tokens. A rollback therefore needs a separately approved session/token revocation
and traffic containment plan; returning to an old binary alone is unsafe.

Do not drop security columns/tables/indexes or delete migration history in
production. These can destroy refresh credentials, audit history and slot guarantees.
If data restoration is required, restore to a fresh instance at the approved point,
validate schema/data and read-only application behavior, then perform only the
explicitly approved failover. Preserve the original instance and evidence.

After an approved release, verify the deployed release marker, database health,
migration entries/checksums, role-slot uniqueness, OTP/MFA/TOTP login, session
replacement, refresh replay rejection, stale logout, reviewer disablement, admin
step-up/revocation, Smart RFQ/order/payment/KYC/Maps workflows, and monitoring.
Never label the release successful before the running environment confirms it.
