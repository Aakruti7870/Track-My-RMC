# TrackMyRMC — Database Specification & MongoDB-to-PostgreSQL Mapping

This document details the relational PostgreSQL schema design replacing legacy MongoDB document collections.

---

## 1. MongoDB Collection to PostgreSQL Table Mapping

| MongoDB Collection | PostgreSQL Normalized Table | Primary Key | Foreign Keys / Relationships |
|---|---|---|---|
| `users` | `users` | `id` (UUID) | None |
| `user_profiles` | `user_profiles` | `id` (UUID) | `user_id` → `users(id) ON DELETE CASCADE` |
| `plants` | `rmc_plants` | `id` (UUID) | `owner_id` → `users(id)` |
| `plant_staff` | `plant_staff` | `id` (UUID) | `plant_id` → `rmc_plants`, `user_id` → `users` |
| `customer_sites` | `customer_sites` | `id` (UUID) | `customer_id` → `users(id)` |
| `fleet` | `transit_mixers` | `id` (UUID) | `plant_id` → `rmc_plants`, `driver_id` → `users` |
| `orders` | `orders` | `id` (UUID) | `customer_id`, `plant_id`, `site_id` |
| `orders.loads` (array) | `order_loads` | `id` (UUID) | `order_id` → `orders(id)`, `mixer_id`, `driver_id` |
| `challans` | `challans` | `id` (UUID) | `load_id` → `order_loads(id) UNIQUE` |
| `pods` | `proof_of_deliveries` | `id` (UUID) | `load_id` → `order_loads(id) UNIQUE` |
| `cube_tests` | `cube_tests` | `id` (UUID) | `order_id`, `load_id`, `tested_by` |
| `workforce_shifts` | `workforce_shifts` | `id` (UUID) | `plant_id` → `rmc_plants` |
| `attendance` | `workforce_attendance` | `id` (UUID) | `plant_id`, `user_id`, `shift_id` |
| `payroll_closures` | `payroll_closures` | `id` (UUID) | `plant_id`, `closed_by` |
| `payroll_records` | `payroll_records` | `id` (UUID) | `closure_id` → `payroll_closures`, `user_id` |
| `gps_telemetry` | `gps_telemetry` | `id` (BIGSERIAL) | `mixer_id`, `driver_id`, `load_id` |
| `otp_sessions` | `otp_verifications` | `id` (UUID) | None (Stores hashed OTPs) |
| `totp_credentials` | `user_totp_credentials` | `id` (UUID) | `user_id` → `users(id) UNIQUE` |
| `passkeys` | `user_passkeys` | `id` (UUID) | `user_id` → `users(id)` |
| `webauthn_challenges` | `passkey_challenges` | `id` (UUID) | `user_id` → `users(id)` |

---

## 2. High-Throughput Telemetry Strategy

- Table: `gps_telemetry`
- Partitioning & Indexing:
  - Indexed via composite B-tree: `(mixer_id, recorded_at DESC)` and `(load_id, recorded_at DESC)`.
  - Retention policy: Telemetry data older than 90 days can be moved to cold storage or pruned via weekly partitions.

---

## 3. Concurrency & Integrity Protections

- **Order Loads**: Resolved MongoDB race conditions by enforcing `UNIQUE(order_id, load_number)`.
- **Challans & PODs**: Exactly 1 challan and 1 POD per delivery load via `load_id UNIQUE` foreign keys.
- **Attendance**: Prevented duplicate daily check-ins with `UNIQUE(plant_id, user_id, attendance_date)`.
- **Payroll Lock**: Locked against retroactive edits with `UNIQUE(plant_id, month, year)`.
