# PostgreSQL migration validation

Integration status: PARTIAL. Production application: BLOCKED. Historical migration: BLOCKED.

## Migration ordering and preservation

The pending 0019 collision was reconciled by retaining delivery 0019/0020 and Control Center 0021. SQLx filenames are unique and chronological. No existing applied migration was edited to absorb new work. Local normalized SHA-256 review hashes are in migration-review-manifest.json; these are not a substitute for SQLx's recorded checksum algorithm or a comparison with the actual production _sqlx_migrations table.

| New slice | Migration | Tables / behavior | Validation |
|---|---|---|---|
| Trip progress | 0019 | trip_status_history and guarded driver transitions | PostgreSQL lifecycle tests |
| Evidence persistence | 0020 | stored_files bytes, delivery quantities and POD ownership | PostgreSQL file/POD tests |
| Session step-up | 0021 | session-bound expiring step-up | PostgreSQL security tests |
| Web approval/session provenance | 0022 | control_center_access, sessions, login limits | PostgreSQL 16/18 and real browser tests |
| Production/stock | 0023 | production_batches and production_stock_movements; precise stock | Atomic rollback, concurrency, immutable retry and allocation tests |
| Payment retry | 0024 | per-invoice request IDs | Concurrent payment/overpayment and idempotency tests |
| Payroll snapshots | 0025 | expense posting, paid fields, closure versions, payslip_snapshots | Multi-employee approval/payment/closure/export tests |
| Customer orders | 0026 | immutable request/pricing provenance, unique customer retries/quote linkage, inline site coordinates nullable, customer_order_intents | Mobile DTO, KYC, saved site, rate/quote and confirmation tests; PG16/18 run 38781457530 passed |
| Staff replay | 0027 | last_login_totp_step; existing credentials retained | Separate-challenge TOTP replay and recovery tests; PG16/18 run 38781457530 passed |

The embedded chain contains 24 SQL files; numbering gaps 0007–0009 are preserved. Empty-database application and upgrading through the <=0018 baseline without changing baseline checksums/legacy records are automated. The tests apply the chain twice to confirm recorded migrations are skipped. The latest passing baseline before new order/replay additions is de950c26a3442a5264212458e4a2bac53d1fd980 (backend run 38779224040). Candidate 276122c1d103eeb589d6eadc8e6909de58a65446 passed its full chain and tests in backend run 38781457530.

## Financial and operational integrity

Production locks the parent order and material rows, records exact stock deltas and rolls back incomplete recipes or insufficient stock. Old physical batch measurements are accounted for without inventing historic consumption. Invoice and payment locks prevent duplicate financial posting and overpayment. Payroll closure serializes period changes and snapshots paid records rather than exporting mutable profiles. Order retries serialize per customer before any new site/order writes and accepted quotations can fund only one order.

These tests use isolated PostgreSQL databases and synthetic records. Existing reviewer fixtures remain labelled reviewer data and are excluded from new fixture count assertions. They are never historical customer migrations.

## Authorized infrastructure and data limits

Read-only metadata identified production PostgreSQL 18.3 and seven automated snapshots in account 260234292958, Mumbai. Production SQL, _sqlx_migrations contents, credentials and secret values were not read. Snapshot availability does not prove restoration or rollback. No migration was run against production or cloud staging, and the existing database was not overwritten.

The reference MongoDB configuration and development seed code do not establish historical production data. Approved Backup/DocumentDB inventories and artifact object metadata did not identify a MongoDB dump; no Atlas snapshot authorization/location exists. Do not import seeds as real records. Historical migration remains BLOCKED pending an authorized backup.

## Required next gates

1. After isolated staging provisioning is separately approved, create a restricted application DB role, verify the exact migration history, back up the staging database and apply the reviewed candidate.
2. Rehearse a restore in an approved isolated environment and reconcile IDs, ownership, row counts, order quantities, financial totals and evidence relationships. Never restore production records into the synthetic fixture environment without separate authorization.
3. Prepare a separately authorized MongoDB export/map/import process if a real historical backup is found. Keep privileged roles closed and preserve all source/destination records for reconciliation.
4. Rehearse application rollback with the additive schema retained. Destructive schema rollback is not presumed safe.
5. Obtain final explicit production approval only after functional, security, build, backup and restore gates pass.
