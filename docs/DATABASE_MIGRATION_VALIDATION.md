# Database migration validation

Status: PARTIAL. Production migration execution: BLOCKED.

## Ordered integration chain
0017 and 0018 retain their original checksums. Pending integration migrations are 0019 trip history, 0020 delivery evidence, 0021 session-bound step-up, and 0022 dedicated web session/access/login-rate-limit tables. No users are promoted or approved by these migrations.

The SQLx upgrade test creates the baseline through 0018, inserts a historical metadata-only file, applies the complete chain twice, compares every original version/checksum, verifies the file's original size and NULL bytes, and asserts versions 19/20/21/22. That test passed in CI for ec62a3392a5ad47247a84fc945f4a2d29a88410f. New CI matrix covers PostgreSQL 16 and production-major 18.

## Production evidence
RDS metadata confirms PostgreSQL 18.3, encrypted/private instance, seven-day backups, deletion protection and seven available automated snapshots. This does not prove a restore or the application's SQLx migration history. No production SQL was run. The local AWS CLI has no credentials; the TrackMyRMC connector can read metadata. Safe runtime secret resolution and an isolated restored copy are required before querying migration history or upgrading production.

## Historical source data procedure
Status: BLOCKED pending an authorized MongoDB backup and document/object manifest. No source data export or transfer occurred.
1. Obtain read-only source backup access; record snapshot identity and checksums without exposing personal data or credentials.
2. Validate collections/fields and quarantine invalid or duplicate records.
3. Build an explicit source-document-ID to PostgreSQL UUID map; preserve customer, plant, user and order ownership.
4. Import parent entities before dependent loads, GPS, finance, payroll and evidence, in an isolated staging database.
5. Compare per-collection counts, foreign-key coverage, delivered quantities, invoice/payment totals and payroll totals.
6. Verify evidence object existence, permissions and retention separately from database metadata.
7. Rehearse backup restore and failed-import rollback. Do not reset the existing production database.
8. Only after reviewed staging reconciliation and explicit approval, execute the approved production data migration. Historical data migration must remain unclaimed until those steps succeed.
