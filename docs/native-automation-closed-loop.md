# Closed-Loop Operations Engine — Phase 1

Status: **stacked draft PR** on top of #153; **not merged or deployed**.

## Scope
First-party Rust/Tokio/SQLx/PostgreSQL implementation. No third-party
workflow runner, Redis, queue service, AI-provider dependency, payment mutation,
automatic dispatch assignment, or production DB write.

Existing Admin + Plant Owner governance remains required. All native templates
start unpublished and paused; each owner must explicitly opt in. The worker
still requires `NATIVE_AUTOMATION_WORKER_ENABLED=true` and remains OFF by default.

## Case lifecycle

- `OPEN`: internal review task created with owner, source record and due SLA.
- `ACKNOWLEDGED`: owner has seen the issue; **not resolved or approved**.
- `RESOLVED`: source record was verified under a tenant-scoped PostgreSQL
  share lock after the authorized operational endpoint changed the business data.
- `CANCELLED`: source was explicitly cancelled/rejected (not marked successful).
- `SLA_ESCALATED`: append-only event and notification if still unresolved,
  with at most two owner escalations per case, each separated by the configured
  `sla_minutes` (15–1440).

The worker never writes operational source records. It only updates its own
tasks, alerts and audit events. An action and its event commit atomically;
`FOR UPDATE SKIP LOCKED` prevents concurrent duplicate notifications.
Lifecycle event UPDATEs are rejected by a database trigger, except the nested
foreign-key scrub of an actor identifier on account deletion. Events are
retained **while their parent task and plant exist**; parent deletion cascades
are intentional for data-deletion compliance, not permanent legal audit retention.

Only the current active owner of the same active plant can receive escalations;
global pause, unpublished templates, and plant opt-out prevent new escalation.
The event history endpoint checks owner role and plant isolation.

## Verified source outcomes

| Domain | Resolved | Cancelled | Remains open |
|---|---|---|---|
| Dispatch | Load has both a driver and mixer assigned | Load/order cancelled or rejected | Missing records, unassigned loads |
| RFQ | Supplier authorized response is `QUOTED` or `DECLINED` | Explicitly cancelled RFQ | Pending/unrecognized statuses |
| Inventory | `current_stock > minimum_stock > 0` (including an authorized threshold adjustment) | — | Still below minimum, absent records |
| Workforce | Leave state `APPROVED` or `REJECTED` | Explicitly cancelled request | Pending/unrecognized statuses |
| Quality | Not automatically resolved | Not automatically cancelled | Explicit failed engineer assessment |

**Quality caution:** A failed test must remain open until a separately designed
quality non-conformance / corrective and preventive action (CAPA) process
provides an authorized, auditable engineer verification. A later PASS or edited
legacy record does *not* prove an original failure has been corrected.

Reconciliation is scheduled for due tasks (1-minute cadence) and bounded to
25 tasks per tick; processing shares the already-disabled-by-default native
worker. Previously acknowledged cases have their old pseudo-resolution
timestamps migrated to `acknowledged_at`, not `resolved_at`.

The scanner prevents parallel outstanding cases for the same source, plant and
template even across daily inventory event keys.

## Interfaces

- Existing owner `GET .../automation/tasks` includes acknowledgement, escalation
  count and resolution reason.
- Existing owner `PUT .../automation/rules/:template_key` accepts
  `sla_minutes` for *domain* templates only; an owner cannot alter Central Admin
  policy or edit an order template's domain SLA.
- New owner `GET .../automation/domain-tasks/:task_id/events` returns the
  tenant-scoped lifecycle timeline without exposing actor identifiers or PII.
- Existing Admin `GET /api/control-center/automation/health` returns aggregate
  task statuses and unresolved escalations, no other plant's case contents.
- Existing owner `POST .../domain-tasks/:task_id/acknowledge` sets only
  `ACKNOWLEDGED`, actor and timestamp; idempotent replays do not duplicate audit.

Migration **0054** adds the event ledger, SLA settings, next checks, acknowledgement
metadata and verified-resolution reason. Existing migrations 0049–0053
remain untouched.

## Release gates

1. Pass `cargo fmt --all -- --check`, Cargo Check, Clippy and integration tests
   against both PostgreSQL 16 and 18; complete Expo and Admin build checks.
2. Review race safety, migration checksum parity, source-to-plant joins,
   escalation impersonation prevention, and business-state transition semantics.
3. Validate owner opt-in, pause/disable, concurrent workers, backoff and
   actual UI role journeys with synthetic data.
4. Leave #153 and this stacked PR as drafts until security and release approval.
   Never merge, migrate production, publish templates, or enable the worker
   merely because CI passes.
5. Later phases: event outbox, dispatch ETA/optimization, dedicated quality
   CAPA verification, inventory forecast, POD reconciliation, simulation.

The initial phase implements **closed-loop internal cases for verifiable domains**
rather than a general autonomous business-action engine.
