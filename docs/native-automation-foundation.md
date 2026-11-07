# TrackMyRMC Native Automation — Rust/PostgreSQL Controlled Foundation

Status: **draft PR only; no merge, rollout, or production worker activation**.

## Source and architecture
This is an independently maintained TrackMyRMC module built with Rust, Tokio, SQLx,
Axum and the existing PostgreSQL database. Marketing-API-Rust was inspected for
design ideas only. No Marketing-API-Rust runtime, HTTP server, database, third-party
workflow platform, Redis, n8n, Zapier or Vapi is required. The entire internal
execution path is contained in TrackMyRMC.

### Deliberate security design
- **Central Admin**, through the approved, dedicated MFA web session and explicit
  `automation.manage` permission, publishes/pauses predefined templates,
  edits strictly typed conditions and retries dead letters only after fresh
  authenticator step-up.
- **Active Plant Owner** can only opt into centrally approved templates for an
  owned active plant, set bounded reminder windows and read their own task/inbox
  and execution history. Manager/Staff delegation does not grant automation
  administration.
- **Authority** is not an alias for Central Admin. Broadcaster/Authority user
  interface and promotional outreach belong to a separate controlled module.
- No automation action accepts SQL, scripts, HTTP URLs, arbitrary code, financial
  mutations, order approvals, payroll actions or operational impersonation.
- Every worker tick checks live template publication/pause and plant opt-in.
  Row share locks ensure policy changes cannot overtake execution mid-transaction.
- Live orders, staff login, MFA, payment and existing push/login routes are unchanged.

## Built-in templates (all unpublished, paused and plant-disabled by default)

| Key | Event source | Native action |
|---|---|---|
| `ORDER_SUBMITTED_TASK` | New pending customer order | Owner's internal review task |
| `ORDER_ACCEPTED_NOTICE` | Authorized order acceptance | Customer in-app notification |
| `ORDER_REJECTED_NOTICE` | Authorized order rejection | Customer in-app notification |
| `ORDER_PENDING_REMINDER` | Pending order older than a configured 15..1440 minutes | Owner in-app reminder |

## Additional native domain workflows (all off by default)

| Template key | Source condition | Internal effect |
|---|---|---|
| `DISPATCH_UNASSIGNED_LOAD` | Planned load remains without mixer/driver for 15 minutes | Owner review task and in-app alert |
| `RFQ_PENDING_PLANT` | Approved plant quotation request is pending at least 15 minutes | Owner review task and in-app alert |
| `QUALITY_INSPECTION_FAILED` | Quality Engineer records explicit `FAIL` with validated inspection provenance | Owner review task and in-app alert |
| `INVENTORY_BELOW_MIN` | Material at/below positive minimum stock for 15 minutes | Owner review task and alert, at most once per material per day |
| `WORKFORCE_LEAVE_PENDING` | Active assigned employee's leave request pending for 15 minutes | Owner review task and in-app alert |

Only the current, active Plant Owner receives these alerts. There is no automatic
dispatch assignment, supplier outreach, quotation decision, quality certification,
purchase order, payroll action, attendance edit, or leave authorization.

A bounded, compiled SQL source scanner inserts unique durable jobs (up to 150
per scan). `FOR UPDATE SKIP LOCKED` claims up to 25 domain jobs per worker
tick. Under transaction locks, source eligibility, active owner identity,
central publication, plant consent and fixed action type are checked **again**.
The task + owner notification + completed job state commit atomically.
Stale/disabled jobs record `SKIPPED` without an effect. Failed attempts have
bounded retry/backoff and dead-letter states.

Domain templates never accept arbitrary custom conditions, webhooks, scripts
or external messaging adapters. An arbitrary rule editor does not change these
fixed, reviewed handlers. The five source scanner queries are first-party code.

### Owner acknowledgement

The owner Operations page shows domain tasks in the existing Automation Center.
`POST /api/owner/plants/:plant_id/automation/domain-tasks/:task_id/acknowledge`
requires a currently active **owner of that exact plant**, performs a locked,
audited transition `OPEN → ACKNOWLEDGED`, and is idempotent.

**Acknowledged means only that the alert was viewed/reviewed.** It does not
change the underlying dispatch load, quotation, material stock, quality record
or leave request. The owner must use the existing protected operational screens
for any actual decision. Owners cannot acknowledge other plants' tasks.

Unregistered Google-listed suppliers are excluded; their enquiries remain in
the existing Central Admin lead workflow, never sent externally by automation.


The existing new-order owner notification is retained. The native task simply
offers a secondary structured inbox; **it cannot approve or reject orders**.
An authorized owner decision automatically resolves any existing review task in
the same transaction. An order status transition and its unique event enqueue
commit atomically. No additional payments or external messaging.

## Controlled condition engine
Central Admin may edit the conditions of **paused** templates only, with an MFA
step-up and an immutable revision snapshot. Supported fields:
`min_quantity_m3`, `max_quantity_m3`, `grade_in`. Conditions are parsed
into the strict Rust `OrderConditions` type, validated, and evaluated only
against the scoped order row. Unknown keys fail closed. Published templates
are versioned and changes are written to `audit_logs` plus
`native_automation_template_revisions`. No generic node execution is exposed.

## Reliability
- PostgreSQL `FOR UPDATE SKIP LOCKED` serializes processing of each job across
  concurrent Tokio workers without Redis or another AWS service.
- Each internal action and job completion is atomic. Logical event keys are
  unique, so duplicate API retries cannot create duplicate effects.
- Scheduled pending-order scan is bounded to 50 eligible orders per tick and
  uses a plant-specific opt-in and bounded interval.
- Retries have exponential backoff, a maximum attempts budget and a dead-letter
  state; only an MFA-approved Central Admin can request a retry.
- Heartbeats report actual worker execution, not merely queue availability.
- Historical attempts, template revisions, and governed policy changes are
  retained for diagnostics. The original migration 0018/queue is preserved.

## Additive interfaces

Central Admin:
- `GET /api/control-center/automation/templates`
- `POST /api/control-center/automation/templates/:template_key/policy`
- `PUT /api/control-center/automation/templates/:template_key/conditions`
- `GET /api/control-center/automation/templates/:template_key/revisions`
- `GET /api/control-center/automation/jobs`
- `POST /api/control-center/automation/jobs/:job_id/requeue`
- `GET /api/control-center/automation/health`

Plant Owner:
- `GET /api/owner/plants/:plant_id/automation/rules`
- `PUT /api/owner/plants/:plant_id/automation/rules/:template_key`
- `GET /api/owner/plants/:plant_id/automation/tasks`
- `GET /api/owner/plants/:plant_id/automation/history`

## Database changes
New append-only migrations 0049 through 0053: template catalog, plant
settings, job queue, attempts, worker heartbeat, bounded reminders, human
tasks, safe conditions, five tenant-scoped domain templates, review acknowledgements and policy revisions. All previous migration files remain
untouched. Changes are applied to disposable PostgreSQL 16 and 18 CI databases;
**production migration is not authorized by this PR**.

## Required release gates and remaining development
1. Finish Rust fmt, Cargo Check, Clippy, SQLx integration/negative security
   tests, PostgreSQL 16/18 migration parity and web/mobile regression.
2. Complete a security review for scoped owner reads, global pause races,
   step-up enforcement, stale jobs, dead-letter retry and revoke/disable.
3. Integration UI is now included in the **existing** Admin dashboard
   (`admin-web/src/main.tsx`) and Plant Owner Operations page
   (`frontend/app/owner/operations.tsx`). Admin can inspect health, review
   template policies, perform MFA-protected controls and check job states.
   Owner sees own-plant templates, opt-in controls, bounded reminder settings,
   review tasks and history. Neither UI can bypass its API permissions.
4. Provision `automation.manage` only through **explicit, audited Control
   Center access administration** after reviewing the recipient's identity.
   It is deliberately NOT automatically granted by migration or by logging
   in with the Central Admin role. `system.view` alone only supports read
   access; `audit.view` grants access to redacted job summaries. Until a
   dedicated authorization ceremony is approved, keep policy management
   inaccessible, not silently elevated.
5. Add further typed, vetted action handlers for dispatch, RFQ, quality,
   inventory and workforce only after each domain's role authorization audit.
6. **Do not activate `NATIVE_AUTOMATION_WORKER_ENABLED=true`, publish
   templates, merge or deploy** without release review and owner opt-in.
7. No real WhatsApp marketing or external messaging is implemented here.
   Broadcasting to plant owners requires separate consent, template approvals,
   Authority/Control Center permission review, and provider-compliance checks.

The current build is a **controlled advanced foundation**, not a dynamic
arbitrary-node workflow editor or a completed production deployment.
