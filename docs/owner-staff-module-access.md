# Owner-controlled module access — Dispatcher pilot

**Branch:** feat/owner-staff-module-rbac-20261019  
**Release gate:** Draft PR only. Do not merge/deploy before staging review.

## Authorization inventory validated

- Rust AuthUser resolves the current DB role and revoked sessions on every request.
- Existing check_role enforces fixed role ceilings, but navigation alone cannot authorize an API.
- plant_staff provides plant identity; its is_active flag is checked for each delegated permission.
- Existing split dispatch mutations are implemented in dispatcher_routes, staff_routes, and loads_routes; fleet/material reads and edits in business_routes; staff collections use a separate read path.
- Ordinary Plant Admin remains separate from Plant Owner and Central Admin. Only the **actual owned-plant owner** can change assignments.
- Current supported editable target role is **Dispatcher**. Other staff role changes are deliberately rejected rather than silently elevating a role.

## Matrix / guard mapping

| Key | Default V/E/A | Role ceiling | Enforced API group |
| --- | --- | --- | --- |
| dispatch_queue | 1/1/0 | 1/1/0 | dispatch queue, order/load reads, assignments, dispatch/cancel |
| fleet_availability | 1/1/0 | 1/1/0 | staff fleet/driver views and mixer status changes |
| challan_gate_pass | 1/1/0 | 1/1/0 | challan generate, load prepare and gate pass |
| material_inventory | 1/0/0 | 1/0/0 | plant material list/stock register |
| billing_ledger | 0/0/0 | 0/0/0 | hard role ceiling (Dispatcher has no billing/ledger access) |
| payroll | 0/0/0 | 0/0/0 | hard role ceiling (Dispatcher has no payroll access) |

The role ceiling is a compiled, explicit upper bound, independent of stored overrides. Owner can **revoke** or **restore** only previously legal Dispatcher capabilities; cannot give payroll/billing/approval rights. Unknown modules fail closed.

## Persistence and API

- Migration 0038: plant/user/module-scoped override table, CHECK constraints, composite FK to plant_staff, append-only audit table and database mutation-denial trigger.
- GET /api/owner/plants/:plant_id/staff/:staff_id/module-permissions
- PUT /api/owner/plants/:plant_id/staff/:staff_id/module-permissions (atomic **complete six-key replacement**, rejects duplicate/invalid/excess grants, writes audit rows)
- GET /api/staff/module-permissions (self, requires exactly one active Dispatcher plant assignment)

No migration backfills privileges: absent overrides mean code-defined Dispatcher defaults. Suspension takes effect at the next API authorization. The API does not accept a client-specified owner identity.

## UX

- Owner More → Manage Staff Module Access.
- Plant and active Dispatcher selection.
- Effective permissions, role ceiling and disabled out-of-role actions shown in a dual-theme glass screen.
- Navigation hides Dispatcher-specific links until the self-permissions read succeeds. The Rust backend remains the enforcement boundary.

## Tests and risks

- Rust policy tests: exact default matrix, impossible approval/finance grants, and cannot edit without view.
- SQLx integration: ownership, cross-plant denial, non-Dispatcher denial, invalid escalation, revocation, persistent overrides, audit immutability, inactive assignment.
- Existing Frontend CI/Backend CI must pass on the **final commit** and integration tests must be executed with PostgreSQL 16 and 18.
- Work not included: generalized role grant ceilings for the other seven staff roles; granular read permission on older legacy report endpoints; salary fields in Supervisor HR responses; signed Android physical-device testing; staging migration rollback rehearsal.
- Legacy endpoints can retain unrelated inherited access outside these six modules. Do not claim a full platform-wide least-privilege audit is complete.
