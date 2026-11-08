# PR #159 security and production acceptance

Repository: `Aakruti7870/Track-My-RMC`. Existing branch:
`feat/native-platform-support-followups-20261108`.
Review baseline: `f080cb2aaeb722d7c169f7b5dde4200efe208010` against main
`50aaed09927ecaf51408855efd498795285de7da`.
Assessment: 2026-11-08. PR remains draft. No deployment or activation is authorized.

## Decisions and evidence binding

**Code-only gate: BLOCK until the commit containing this report has passed both
CI workflows and fresh independent Codex review with no unresolved legitimate
security findings.** Local results below are PASS. Final CI/review results belong
to the exact PR-head checks and review timeline, not a prior green commit:
<https://github.com/Aakruti7870/Track-My-RMC/pull/159/checks>.
Passing that code-only gate does not authorize marking the PR ready, merging,
deploying, migrating production or enabling either worker under this task.

**Production release: BLOCK.** The external/operator gates below remain open.
Do not set or change `TRACKMYRMC_APPROVED_RELEASE_SHA` to close these gaps.

## Permission matrix

Every privileged reader/writer requires an active role-bound web identity,
approved access, enabled authenticator and a current approved web session.

| Operation | Central Admin | Authority | Customer / plant roles |
| --- | --- | --- | --- |
| Platform support case list/details, including internal notes | `support.view` | Explicit `support.view` delegation | Denied; customer retains only their own public case history |
| Own unread support alerts and mark-read | `support.view` + `support.reply`; notification ownership | Same two explicit grants; ownership | Denied, including through generic notification APIs |
| Public staff reply or internal note | `support.view` + `support.reply` | Same two explicit grants | Denied; customer can reply only to their own open case and cannot create internal notes |
| Close, resolve, reopen or change case status | `WebAdmin` + `support.manage` + recent MFA | Always denied, even if raw database grants contain `support.manage` | Denied |
| Approve Authority / change grants | `admin_access.manage` + recent MFA + audit reason | Always denied | Denied |
| Global automation policy / Central Admin controls | Existing Central Admin-specific permissions/MFA | Always denied | No new access; existing plant-scoped permissions remain separate |

The allowlist contains seven delegable capabilities. A grant containing
`support.reply` without `support.view` is rejected. A legacy inconsistent grant
is ineffective and omitted from Authority's effective permission response.
No existing customer, owner or staff identity is promoted to Authority.

## Findings and remediation

| Finding | Resolution and evidence |
| --- | --- |
| Worker selected Authority recipients for a nondelegable reply capability, while routes were Central Admin-only | Added explicit reply delegation and narrow `WebSupport` authorization for case reads/replies/alerts. Status management retains `WebAdmin` and MFA. Positive and negative real HTTP tests cover both roles |
| Authority dashboard could not consume/respond to its reminders | Reused the existing support workspace in both role dashboards; browser regressions open each operator's own alert, acknowledge it and submit a visible reply |
| Generic notification APIs could bypass the support-specific session/permission check | Excluded `support_followup` from generic feeds, unread counts and mark-read operations. Direct and bulk-read bypass tests pass |
| Authorization extraction could precede a concurrent revocation while the request waited for its case lock | Case mutation locks case first, then rechecks current identity/session/access in a fresh statement under an identity SHARE lock through commit. Real database lock-wait regression commits revocation first and proves no staff reply is inserted |
| Approved invitations without usable credentials could consume reminders | Worker requires an Argon2id password and enabled TOTP as well as active/approved identity and both support grants. Disabled/unapproved/inactive operator tests preserve the overdue deadline and reminder budget |
| Older unread alerts and cross-account cursors/read acknowledgements | Unread filtering occurs before limit; deterministic keyset pagination validates cursor ownership. Tests traverse 55 unread alerts behind read history without duplicates and deny another account's cursor/read operation |
| Codex P2: generic logout/JTI replacement could race extraction without touching the dedicated web-session row | Preserve verified JWT JTI and issuance claims and reapply the account revocation/replacement predicates under the identity lock. Both-role regressions invoke real generic logout or the account issuance primitive while a reply waits; the old web-session row stays present but the reply is denied with no insert |
| Codex P2: post-lock MFA recheck could request a second pool connection and starve itself | Share the step-up query through a SQLx executor and run the post-lock check on the held transaction connection, using current wall-clock expiry. Concurrent status updates pass with a one-connection pool; a grant expiring during a case-lock wait cannot close the case |
| Unsent support drafts could survive operator/case changes | Clear case/composer/internal-note/MFA state on logout and when opening a case. Browser acceptance deliberately leaves a private draft before operator switching and verifies an empty composer and cleared note checkbox |
| Important support operations needed auditable handling | Case/reply/status transactions retain audit records; case reads, alert listing and idempotent first read acknowledgements are audited without conversation content |

Existing controls remain: two reminders per response cycle; unique
`(case_id,cycle,reminder_number)` delivery events; case-first row locking and
`SKIP LOCKED`; bounded batches; separate `next_attempt_at` backoff; exact original
`due_at` preserved through failed delivery and both reminders. Repeated customer
messages do not defer a pending deadline. A public staff reply satisfies it;
an internal note does not. Closing cancels follow-up, audited reopening creates
a fresh cycle. No automatic resolution, customer reply, financial action,
WhatsApp/email send or plant-tenant assignment was introduced.

## Executed isolated verification

| Check | Observed local result |
| --- | --- |
| `cargo fmt --all -- --check` | PASS |
| `cargo check --all-targets` | PASS |
| Strict Clippy on all targets/all features | PASS |
| Full Rust/SQLx suite on PostgreSQL 16 | PASS: 253 tests, zero failures |
| Full Rust/SQLx suite on PostgreSQL 18 | PASS: 253 tests, zero failures |
| Targeted authorization/concurrency regressions | PASS: six real HTTP/SQLx tests, including worker-to-Authority-inbox-to-reply flow, generic logout/JTI revocation during a lock wait, and one-connection status/MFA expiry checks |
| Migration suite on both PostgreSQL versions | PASS: nine tests, including existing-main upgrade and preserved ledger/checksums/history |
| Admin TypeScript + production build | PASS |
| Expo typecheck + production web export | PASS; customer application source unchanged |
| Real Rust/PostgreSQL admin/Authority browser regression | PASS: owned alerts, acknowledgement, public replies, Authority status denial, existing Owner governance and logout |
| Offline operations/security gates | PASS: 76 Python tests; deployment/recovery shell syntax |

Required remote jobs are `Rust Check, Clippy & Test (PostgreSQL 16)`, the same
PostgreSQL 18 job (including real admin/Authority and Expo role/security browser
steps), `typecheck`, and `Admin dashboard build`. A skipped or pending required
step is not a pass. The independent reviewer must inspect the complete PR diff,
including the original worker, migration and flag wiring.

All fixtures were synthetic and restricted to disposable local PostgreSQL.
Both application worker switches were explicitly OFF for dashboard acceptance;
worker concurrency tests directly invoked the Rust service against isolated data.
No production identity, ticket, message, credential or database row was changed.
Temporary RAM-backed build artifacts avoided local disk exhaustion; this did
not alter source behavior or test expectations.

## Migration and rollback

The only PR migration is additive
`20261108090000_native_support_followups.sql`, ordered after main's payment-offer
and prepaid-gateway migrations. Its content is unchanged from the reviewed SHA.
SHA-256: `ca7b15aadc3e7e8ae1498d60329f9e3a7ea607f34c176068afdd9775ab17ec2f`.
No earlier migration or SQLx checksum was rewritten.

Isolated upgrade verification installs main's entire migration chain, records
its ledger/checksums and a historical case, applies the new migration, then
proves the old ledger/case remain intact, historical cases are not enrolled,
reminder-count/unique-event constraints hold, and a second migrator run is a no-op.
Older application case columns remain usable. This is compatibility evidence,
not a production migration or full application rollback rehearsal.

A scoped release operator must verify the actual runtime database name, exact
ledger/checksums, migration ordering, data parity, backup and independent restore
before any approved rollout. Startup applies pending migrations; feature OFF
alone does not prevent schema changes, so exact-SHA release approval remains
mandatory. Do not repair parity by deleting ledger rows or editing checksums.

Rollback begins with separately approved worker disablement and a reviewed
SHA-pinned application rollback/forward revert. Preserve the additive tables and
event history; there is no automatic destructive DOWN migration. Existing S3
artifacts and versioned backend binaries are implementation support, not proof
of a rehearsed rollback. The workflow requires current-main and exact approved
SHA, so an arbitrary older SHA must not be substituted to bypass that gate.
Database restore is a separate approved operation with post-backup ticket/order/
payment reconciliation. No restore, snapshot creation or rollback was performed.

## Read-only production assessment

Fresh successful STS, RDS Describe and IAM Get/List calls on 2026-11-08 confirmed:

- Account `260234292958`, region `ap-south-1`; the audit connection authenticates
  as `:root`. Only metadata reads were performed. Privileged production changes
  require a separately scoped operator; none were attempted.
- `trackmyrmc-postgres` is available on PostgreSQL 18.3, private, encrypted,
  deletion-protected, single-AZ, with seven-day backup retention. Latest
  restorable time observed was 2026-11-08 19:40:10 IST. Available encrypted
  automated snapshots and the older 2026-10-16 manual snapshot exist. No fresh
  independent restore, consistency, RPO/RTO or release snapshot evidence was obtained.
- Deployment role OIDC trust restricts audience to `sts.amazonaws.com` and this
  repository's main ref. Inspected inline policies restrict SSM's target to the
  production instance and S3 writes to its artifact bucket, but include
  `secretsmanager:CreateSecret` on `*`. Least-privilege/effective-policy review
  remains incomplete and any IAM correction requires separate approval.
- Current main's deployment/credential-recovery source requires PostgreSQL
  `verify-full` with the RDS trust bundle. Offline TLS/release gate tests pass.
  This task did not execute a live positive certificate/hostname check or the
  wrong-host/untrusted-CA negative checks against production. Resource metadata
  does not establish client TLS acceptance.
- Existing workflow source requires nonempty, exact matching
  `TRACKMYRMC_APPROVED_RELEASE_SHA` before AWS credentials/deployment and rechecks
  current main. Reading that repository variable returned GitHub App HTTP 403;
  its actual value and approval governance remain unverified. It was not changed.
- Runtime migration ledger, installed SHA, enrolled operator readiness, actual
  worker environment flags and production inbox UX were not inspected. No
  Secrets Manager values or host environment files were fetched, and no SSM
  command was executed.

## Outstanding external/operator approvals

1. Independent final-head Codex review and closure of legitimate findings with
   test evidence; final-head complete CI matrix.
2. Scoped operator identity and least-privilege review; independent sign-off on
   release/activation, without using root for privileged changes.
3. Live readonly database ledger/parity, trustworthy TLS positive/negative
   evidence, witnessed restore and SHA-pinned rollback rehearsal.
4. Approved, separately enrolled web support operators with password/TOTP and
   explicit grants; production notification/inbox/reply acceptance using an
   approved test case and no real customer messaging.
5. Confirm both live worker switches OFF, then obtain distinct authorization
   before any activation. Default source values remain false for both switches;
   the support worker requires both true. No activation or live flag edit occurred.
6. Confirm the approval variable's actual value and access governance through an
   authorized repository administrator. Do not set it merely because CI is green.

**Explicitly approved production changes: NONE.** No merge, ready-state change,
deployment, migration, production identity change, resource creation, secret
retrieval, customer message, live payment or automation activation occurred.

## Correction file inventory

- Authorization: `backend/src/auth/staff_support.rs`, `backend/src/auth/mod.rs`,
  `backend/src/auth/authority.rs`, `backend/src/routes/authority_governance.rs`.
- Support handlers/state: `backend/src/routes/assistant_routes.rs`,
  `backend/src/routes/notifications.rs`, `backend/src/routes/control_center_routes.rs`,
  `backend/src/services/support_cases.rs`,
  `backend/src/services/native_support_automation.rs`.
- Existing web UI/browser regression: `admin-web/src/main.tsx`,
  `admin-web/scripts/verify-control-center.mjs`.
- Fixtures/regressions: `backend/tests/support_authorization_tests.rs`,
  `backend/tests/migration_tests.rs`,
  `backend/tests/fixtures/control_center_browser.sql`.
- Documentation: `docs/native-support-automation.md` and this report.

The original migration, worker flag wiring and production approval guard were
reviewed but not rewritten by these corrections. No Expo customer source or new
TypeScript file was introduced.

## Independent review remediation record

The fresh Codex review of `64c0cd1325de2e9c333a155946a1537d034389d6`
raised two legitimate P2 findings, both addressed above:

- Account-session revalidation: <https://github.com/Aakruti7870/Track-My-RMC/pull/159#discussion_r4506587439>.
- Transaction-connection MFA check: <https://github.com/Aakruti7870/Track-My-RMC/pull/159#discussion_r4506587443>.

The new regressions are `in_flight_support_revalidates_generic_logout_and_account_jti_replacement`
and `support_status_uses_one_connection_and_expires_step_up_after_lock_wait`.
Account revocation correctly returns 401 before any policy denial; no existing
security assertion was weakened. A further final-head review and CI pass are
required after these corrections. Earlier green CI on `64c0cd1` did not close
these security findings or authorize release.
