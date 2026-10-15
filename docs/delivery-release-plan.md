# Delivery workflow release and rollback plan

This is a draft plan, not deployment authorization. Full application parity remains incomplete.

## Staging gates
1. Use a disposable PostgreSQL 16 database and synthetic accounts. Apply the complete migration chain, then run cargo test including delivery_lifecycle_tests.
2. Separately upgrade a representative database snapshot through migrations 0019 and 0020. Assert original rows/counts and migration checksums are retained. Legacy stored_files metadata must remain present with NULL bytes; no fabricated historical content.
3. Exercise dispatcher-to-driver workflow in Android and admin web: assigned load, dispatch, start, arrival, unloading, upload, POD and customer order completion. Test multiple loads, cancelled siblings, partial delivery, retries and concurrent actions.
4. Verify customer/plant/driver access boundaries and deny foreign order, trip and file IDs. Verify existing admin authenticator policy and staff/customer authentication against approved providers.
5. Confirm file size limits, PostgreSQL storage capacity/backups, and retrieval of real uploaded JPEG bytes.
6. Resolve all critical entries in remaining-blockers.md. CI alone does not satisfy acceptance.

## Deployment, only after separate approval
- Capture database backup and verify restore to an isolated instance.
- Review migration locks and apply additive schema changes before deploying code that reads the new columns.
- Retain existing production secrets and infrastructure. Do not reset schemas, rotate credentials or modify unrelated services.
- Deploy the reviewed commit using the established deployment procedure; monitor API errors, PostgreSQL pool saturation, POD conflicts, GPS ingestion and file storage growth.
- Run synthetic smoke checks with authorized test accounts before exposing the workflow broadly.

## Rollback
- Stop rollout if migrations fail or authorization, data integrity or delivery recording regresses.
- Prefer a reviewed forward fix. If reverting application code, assess compatibility with en_route load status first: the previous application omits that status in several queries.
- Do not blindly roll back to code that discards upload bytes or permits invalid transitions. Use a reviewed compatibility release that retains en_route reads and evidence persistence.
- Keep additive tables/columns and recorded delivery data. Do not execute destructive down migrations or delete evidence.
- Database restoration is an exceptional separate approval because it can discard post-backup writes; plan reconciliation before any restore.
