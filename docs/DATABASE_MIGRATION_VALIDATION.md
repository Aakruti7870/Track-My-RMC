# PostgreSQL migration validation

Integration: PARTIAL. Production application and historical import: BLOCKED.

The embedded chain has29 files through 0032. Pending migration collision0019 was reconciled as delivery0019/0020 and Control Center0021. The <=0018 baseline is preserved. SQLx's applied checksums and legacy records are tested during upgrade; production _sqlx_migrations has not been read. The SHA-256 review manifest is a normalized-file inventory, not SQLx's checksum algorithm.

At3d913265, backend run 38791343034 passes on PostgreSQL16 and18: empty DB application, idempotent reapplication and baseline upgrade/checksum preservation. New production data was never loaded or overwritten. The upgrade fixture also preserves an old support case, backfills its case number and verifies inserts using the old writer contract remain valid.

| Migration | Persisted behavior | Validation |
|---|---|---|
|0019/0020|Trip history, stored evidence bytes, POD quantities|Actual lifecycle, evidence, ownership and replay tests|
|0021/0022|Session-bound step-up and explicit approved web sessions/grants|HTTP security tests and dedicated Admin browser|
|0023|Quantity production batches and exact stock movements|Concurrent retries, recipe snapshots, insufficient-stock rollback and dispatch pool|
|0024|Invoice payment request IDs|Invoice/payment locks, positive precision, overpayment denial and immutable retries|
|0025|Recorded payroll payments, expenses and versioned payslip snapshots|Multi-employee approval/payment/closure/export|
|0026|Customer order intent, request/price provenance and unique quote linkage|Actual mobile DTOs, own sites/KYC, repricing review and concurrent idempotency|
|0027|Last staff login TOTP step|Separate-challenge replay denial, recovery and fresh logout/login boundary|
|0028|RFQ pumping/decline and response provenance|Customer request to plant response, quote acceptance and order persistence|
|0029|Site notes/defaults and wider address/contact fields|Concurrent defaults, optional coordinates and linked deletion protection|
|0030|Payroll reopen reason/actor/time|Serialized owner reopen, immutable version1, reclosure version2 and no duplicate payment|
|0031|Receiving sample IDs and result authors/update metadata|Owned records, chronology, due state, result updates and tenant isolation|
|0032|Support case numbers, immutable escalation retry provenance and private notes|Concurrency/ownership/internal-note filtering, explicit web support grants, step-up and audit; old-writer insert compatibility|

Dashboard/project summary repairs add no extra schema. Aggregations are scoped by customer or active owned/assigned plant. Delivered quantities come from recorded POD values; missing historical delivery measurements are not replaced with planned quantities. Customer observations remain customer-recorded information, never official quality acceptance.

Production PostgreSQL18.3 and seven automated snapshots were observed through authorized metadata only. Snapshot presence is not a restore test. No production SQL, secret-value retrieval, migration, SSM command or cloud staging application was performed.

Historical MongoDB production records and an authorized backup remain unconfirmed. Development/reviewer seeds are excluded from migration acceptance. A real source export/map/import, count/financial/ownership reconciliation, isolated restore rehearsal and reviewed rollback are BLOCKED pending authorized source data and isolated infrastructure. Staging provisioning still requires separate explicit approval. Never overwrite the existing PostgreSQL database.
