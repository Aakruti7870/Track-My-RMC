# Customer Support → Native Rust Automation integration

Scope: platform Customer Support cases, not plant-scoped order/dispatch jobs.
No third-party automation engine, AI response model, external messaging, payments,
credential recovery, auto-resolution or customer profile changes.

## Existing audited flow

- Mobile support widget offers safe scripted guidance and optional escalation.
- Customer `POST /api/assistant/support/cases` writes `support_cases`, first reply
  and audit in a transaction; retries are case-idempotent.
- Customer/privileged reply endpoints enforce row-level case ownership and
  internal notes isolation; privileged status transitions require web MFA step-up.
- Central Admin/Authority web roles have a support queue and approval-scoped replies.

## Missing connection implemented here

The native automation worker's prior tables require a real plant ID and order/
domain source. Customer Support cases belong to the PLATFORM. The new migration
adds `native_support_followups` and compact event history without rewriting
old migrations or inventing a plant assignment.

An escalated support case arms a platform follow-up in the SAME transaction.
Customer replies trigger follow-up cycles without postponing an existing SLA
deadline; a public staff reply satisfies the outstanding response requirement,
but an internal note does not. An authorized close/resolution cancels the timer;
a later audited reopening creates a new cycle.

An explicitly enabled first-party worker checks at most ten due cases per tick,
locks the case before the follow-up, and atomically records at most two internal
reminders, a technical event and generic notifications. The notifications go
only to currently active, separately approved Central Admin/Authority web
accounts with BOTH `support.view` and `support.reply`. The native
`support_followup` notification rows are exposed by a dedicated, authorized
`GET /api/assistant/support/staff/alerts` feed in the existing web
Support workspace; staff can open a case and mark their own alert read.
The inbox deliberately does not imply a staff response or case resolution. Case content, phone
numbers, order data, OTPs and documents never enter the reminder payload.
Without an eligible operator, the case stays open and retryable rather than
impersonating or fabricating a delivery.

## Internal target windows

High priority 30 minutes; normal 2 hours; low 8 hours. These are staff
follow-up targets, NOT promises of resolution times or customer-facing SLAs.
After one reminder, next reminder may occur an hour later. After two, no
further automatic notification in the same pending-response cycle. The
original `due_at` remains the response deadline; a separate
`next_attempt_at` tracks delivery backoff so missing operators never mask
an overdue case. Authorized
manual follow-up remains possible indefinitely.

## Activation and policy

Requires BOTH `NATIVE_AUTOMATION_WORKER_ENABLED=true` and
`NATIVE_SUPPORT_AUTOMATION_ENABLED=true`. The new support switch defaults to
`false` in the existing runtime secret and deployment script. Keep it disabled
until independently approved acceptance, a live migration-ledger verification,
audit/notification QA, and an actively enrolled web support operator exist.
Existing historical cases are not automatically enrolled; they remain
available to manual support staff.

Service enquiries (cement, labour contractors, building materials) remain
separate platform leads. Their third-party outreach cannot be silently
triggered by this support queue; it requires an approved consent and contact
process. No plant owner receives a platform-wide support ticket.

## Verification

- Cargo fmt/check/Clippy and PostgreSQL 16/18 tests.
- Creation and reply/status transitions atomically change only the support
  follow-up state.
- Concurrent workers yield a single reminder event and staff notification.
- Repeated customer replies cannot defer the first response; internal notes
  cannot satisfy it.
- Revoked/unapproved/incorrect-role staff do not receive reminders.
- Reminder count is bounded; no external API call or autonomous case closing.
- Frontend/admin builds and all existing Play-review role checks remain intact.

Release mode: **feature OFF; PR only; no merge or production deploy on CI alone.**
