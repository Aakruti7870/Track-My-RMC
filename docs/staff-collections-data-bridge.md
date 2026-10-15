# Reference Staff dashboard data bridge (2026-10-15)

Reference: `Tracking-project/backend/routers/staff.py` (`GET /api/staff/home`, `GET /api/staff/collection/{kind}`).  
Target: `backend/src/routes/staff_routes.rs` and `backend/src/routes/staff_collections.rs`.

## Restored API contracts

The legacy Rust `GET /api/staff/home` previously returned `metrics` only; the Expo `StaffHome` expects `role`, `role_label`, `name`, `kpis` and `primary: {title,kind}`. Both the expected fields and the original metrics are now returned. Values come from PostgreSQL, not development/demo fixtures.

Added `GET /api/staff/collection/:kind`, with the original mobile response shape: `title`, `empty`, `items`, and item `id`, `icon`, `primary`, `secondary`, `meta`, `badge`, `badge_status`, `nav`, `actions`. It reads real PostgreSQL records for:

| kind | PostgreSQL source | Scope |
| --- | --- | --- |
| orders | orders, users, customer_sites | user-owned plants and active plant_staff memberships |
| dispatch | orders, users, customer_sites | approved operational roles and eligible order status |
| production | orders, users, customer_sites | active production orders |
| quality | orders, cube_tests, customer_sites | plant-scoped inspection register |
| incidents | driver_sos_alerts, order_loads, orders, plant_staff | incident tied to relevant plant or the driver's assignment |
| fleet | transit_mixers, users | scoped vehicles |
| drivers | users, plant_staff, transit_mixers | assigned drivers only |
| invoices | plant_invoices, plant_payments, users | plant-specific invoices and paid balances |
| ledger | plant_invoices, plant_payments, users | customer invoices aggregated for authorized plants |
| inventory | plant_materials | real stock and reorder levels |
| plants | rmc_plants | active owned/member plants |

The `owner` and `plant_owner` role identifiers are treated as **one Plant Owner identity**. Multi-plant owners receive records from every plant they own, without widening access to other owners.

## Security boundaries

- Every query uses a server-side scoped plant CTE; customer and driver roles cannot query these staff lists.
- The old reference `users` and `kyc` collections are **intentionally not copied** into the operational staff API. Original Central Admin and Authority permissions are distinct, and target does not yet have provenance/permissions equivalent to safely expose those directories.
- List actions are **read-only** until corresponding production/finance/stock mutation handlers are validated for plant ownership, state machines and idempotency. Dispatch navigation is available only to appropriate operational roles.
- The original data is in MongoDB; this code reads PostgreSQL target tables, **not historical MongoDB records**. Historical records require an authenticated source export, staging ETL and reconciliation.

## Verification and remaining work

- Unit checks cover role policy, disabled privileged collections and plant-scope SQL invariants.
- DB-backed integration tests validate the Expo response shape, assigned-vs-unassigned staff, customer denial, owner alias and multiple plant ownership.
- PR is based on the implementation branch of draft PR #37, which supplies migrations 0019/0020 for trip and delivery evidence. **Do not merge this stack independently of PR #37**.
- Not done: original per-row mutation workflows (production, stock, invoices), historical data transfer, WebAuthn, Central Admin web security, external provider delivery, and device-level end-to-end testing.
- `GET /api/staff/home` currently summarizes the first assigned plant; customer invoice, fleet, stock and incident counters for multi-plant owners must be aggregated in a subsequent change. Multi-plant staff collection list itself is scoped to all authorized plants.
- Production stays unchanged.
