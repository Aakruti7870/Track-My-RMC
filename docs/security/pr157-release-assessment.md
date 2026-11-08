# PR #157 production release assessment

Assessment date: 2026-11-08. Decision: **BLOCK** pending the acceptance gates below.
This is evidence of remediation and isolated verification, not production authorization.
The existing feature branch includes main through `d9f9110e5ff5e01ed41c6fb19711088936ff239d`.
Consult the final branch commit's GitHub checks; earlier green runs do not approve later commits.

## Code-only merge safety gate (2026-11-08)

The production GitHub workflow now requires an explicit exact-SHA approval:
the repository variable `TRACKMYRMC_APPROVED_RELEASE_SHA` must equal the
40-hex-character commit currently on main. It defaults to absent and prevents
the entire AWS deployment job (including secret reads, SSM and production
migrations) from starting. Manual dispatch requires the same approval and
still checks both push CI workflows for that main SHA. This permits a code-only
merge without implicitly approving deployment.

**Keep the variable absent until this assessment is independently changed
from BLOCK after live TLS, provider, migration, restore and scoped operator
acceptance.** A matching SHA is only an operational release gate; it is
not the missing PRAS independent recovery-approval infrastructure.

## Follow-up hardening on the existing PR branch (2026-11-08)

Post-assessment work hardened all three production PostgreSQL client paths:
`ops/aws-deploy-ec2.sh` installs the AWS Mumbai RDS CA bundle and creates a
`sslmode=verify-full` plus `sslrootcert` runtime URI;
`ops/release/recover-managed-rds-credential.py` rejects TLS downgrades and
requires the pinned CA bundle for preflight; `ops/release/database_audit.py`
refuses weaker modes, missing/duplicate trust settings, and unpinned production
trust paths. Offline denial-path tests were added. Deployment now also performs an actual
read-only `psql` `verify-full` preflight before swapping binaries or writing the
runtime environment; the opt-in `ops/release/verify-rds-tls.py` gate can later
witness a positive authenticated connection plus rejected wrong-hostname and
untrusted-CA handshakes. **No live acceptance probe was executed.** These
commits are code hardening only; production deployment is still prohibited
without approval.

The previous Codex login/revocation race review thread was answered with the
row-lock implementation and PG16/PG18 concurrency regression evidence and
marked resolved. Independent security approval remains outstanding.

The external recovery trust and approval contract is documented in
[privileged-recovery-approval-contract.md](privileged-recovery-approval-contract.md).
It is **not implemented**. Identity Center currently has insufficient distinct
enrolled approvers, and the dedicated KMS signing and durable audit system is
not provisioned. No recovery endpoint has been activated. The overall decision
remains **BLOCK**. Consult latest-commit CI before attributing pass status to
this follow-up work.

## Follow-up: historical sandbox KYC status isolation

After the earlier provider-environment check on new approval endpoints,
the customer KYC read path and order creation still trusted legacy
`user_profiles.kyc_status='verified'` unconditionally. The branch now
adds a shared, read-only `LIVE_APPROVAL_SQL` policy for live mode: a
matching live-provider consent session and the **latest** independently
audited Central Admin/Authority approval with `provider_environment=live`
are required before reporting `VERIFIED`, blocking re-enrollment, or
allowing a non-draft order. Legacy/sandbox-only approvals remain visible in
existing audit history but cannot unlock live KYC. Re-enrollment can
reopen a stale profile to `pending` for fresh approval. Disposable
PostgreSQL regressions cover absent proof, sandbox proof, consent without
approval, valid live approval, and subsequent revocation. This is source
hardening, not production provider acceptance. Verify current-head CI and
independent review before merging.

## Current remediation pass

Reviewed against main `d9f9110e5ff5e01ed41c6fb19711088936ff239d`, starting from
PR head `3005c605c486a55bef462c25cdcf2671bda6ada6`. Application/database tests used
disposable local systems. A subsequent AWS audit read production resource metadata
only, as detailed below; no production application/database sessions were opened.

- **Login/revocation race fixed:** privileged login previously read the password,
  TOTP and approval before acquiring the identity lock in session issuance. A
  concurrent password replacement or approval revocation could commit between
  those operations, allowing a stale proof to issue a fresh session. Login now
  locks the identity before reading credentials, then reads approval and TOTP in
  a separate READ COMMITTED statement after the lock is acquired. This serializes
  it with existing password/access mutation transactions without using stale
  joined rows from a pre-lock statement snapshot.
- **Concurrent enrollment throttle fixed:** Authority initial-password enrollment
  previously checked the challenge budget before verification and incremented it
  only after failure. Parallel requests could all enter proof verification with
  the same budget. A conditional atomic UPDATE now reserves each attempt before
  verification. The last permitted attempt can still succeed; exhausted,
  expired, consumed, wrong-purpose and revoked challenges remain rejected.
- **Formatting blocker fixed:** formatted the bootstrap example that caused both
  backend matrix jobs at the starting PR head to fail and skip later gates.
- Added regression tests that observe a real PostgreSQL row-lock wait before
  committing credential/access revocation, for both privileged roles. Added a
  twelve-request concurrent enrollment budget test and last-allowed-attempt
  success coverage. Both PostgreSQL versions pass these tests.

The user selected the **existing external security approval process** for
emergency recovery. Its identity verification, independent approver verification,
approval artifact validation, audit fields, expiry and replay contract have not
been supplied. No self-approved recovery route, unsigned-ticket override, manual
role promotion or replacement trust model was introduced. Completing and testing
this workflow remains a code/integration blocker, not production-only acceptance.

The current local source passes format, check, strict Clippy, **239 Rust tests on
PostgreSQL 16 and 239 on PostgreSQL 18**, both frontend typechecks/production builds,
the real bootstrap PTY harness, and admin/Authority browser E2E. Bootstrap output
was suppressed by the harness, including failure paths. The earlier full test
attempt exhausted local disk during linking; the final successful runs used
temporary RAM-backed artifacts with debug symbols/incremental compilation disabled.
This changes build storage only, not source, test assertions or security controls.
Remote CI must be checked on the pushed commit; local results are not CI results.
Both CI workflows now include `docs/security/**` in their PR path filters so a
security release-assessment update receives checks on its own commit SHA.

## Read-only AWS metadata audit

Observed 2026-11-08 through the TrackmyRMC AWS connection in `ap-south-1`.
Successful STS, RDS Describe, EC2 Describe and IAM Get/List API results established
the following configuration. These reads neither executed an SSM command nor
retrieved a secret value. They do not establish application runtime health, SQL
migration parity, restore success, effective organization-wide authorization or
provider acceptance.

| Area | Observed evidence | Release implication |
| --- | --- | --- |
| Audit connection | Correct account `260234292958`; caller ARN ends in `:root` | Replace the audit/operator connection with a scoped IAM identity before privileged production operations; no root provisioning was performed |
| RDS | `trackmyrmc-postgres`, PostgreSQL 18.3, available, not publicly accessible, encrypted, deletion protection enabled | Basic configuration confirmed; actual database identities/ledger remain uninspected |
| Network | RDS ingress is TCP 5432 from the production EC2 security group only; EC2 exposes 80/443 publicly and SSH to one /32 | No public database ingress rule was found in the inspected groups; routes, NACLs and effective reachability were not tested |
| Transport settings | In-sync `default.postgres18` group reports `rds.force_ssl=1`, `ssl=1`, minimum TLS 1.2 | Server configuration requires encryption; this does not prove client peer authentication |
| Client transport gap | Deployment URI uses `sslmode=require`; credential-recovery preflight also uses `PGSSLMODE=require` | **Unresolved hardening gate:** enforce certificate-chain and hostname verification with a reviewed RDS trust bundle and negative TLS tests before release. No live TLS setting was changed |
| Backups | Retention 7 days; latest restorable time 2026-11-08 10:20:09 IST; latest available automated snapshot 2026-11-08 02:30:04 IST; available encrypted manual snapshot from 2026-10-16 | Backup metadata exists, but no fresh release snapshot, independently witnessed restore or measured RPO/RTO was established |
| Availability | RDS `MultiAZ=false`; production is one running `t3.micro` EC2 instance | Single-instance availability/capacity needs explicit operational acceptance. No scaling or new billable service was enabled |
| EC2 | Root EBS volume encrypted; IMDSv2 tokens required | Positive configuration evidence, without host inspection or application load evidence |
| Deployment trust | GitHub OIDC audience `sts.amazonaws.com`; subjects restricted to this repository's main ref (name and numeric-identity forms); session duration 3600 seconds | Branch trust confirmed from live role metadata; GitHub environment approvals and effective organization/session restrictions remain unverified |
| Deployment permissions | SSM RunShellScript targets the named production instance; S3 writes target its artifact bucket; runtime secret read/write is scoped to the app secret name; `secretsmanager:CreateSecret` has `Resource: "*"` | **Least-privilege review remains PARTIAL:** remove or tightly constrain unneeded secret creation through a separately approved IAM change. No IAM policy mutation or simulation was performed |
| Runtime permissions | Inspected inline secret/KMS/artifact reads and both attached managed-policy default versions; SSM and CloudWatch agent managed policies remain attached | Review broad managed-policy parameter/log permissions and redundant secret statements. No `iam:PassRole` or IAM policy-edit action was present in the inspected deployment/runtime identity policy documents; this is not proof of all effective permissions |

The complete inspected policy set comprised three deployment inline policies,
five runtime inline policies and two attached runtime managed policies. No role
permissions boundary appeared in the returned role metadata. Resource policies,
KMS key policies, SCPs, session policies and artifact bucket configuration were
not audited, so overall least privilege cannot be marked complete.

## Completed remediation

| Finding | Correction | Evidence |
| --- | --- | --- |
| Login and step-up tracked TOTP reuse separately; Central Admin step-up allowed reuse | Login, enrollment, bootstrap, step-up and password rotation share the credential replay counter; login consumes it atomically with session issuance | Both-role cross-surface replay tests; concurrent login accepts exactly one proof |
| RFQ writes accepted a read-only grant; legacy routes admitted ordinary plant administrators | Both RFQ write routes require WebAdmin, `support.manage` and recent MFA; global RFQ reads require WebAdmin and `support.view` | Read-only, missing-step-up, customer and plant-admin negative tests; authorized writes and customer note privacy still tested |
| Mobile menu advertised global RFQ administration | Removed global module; retained deep link displays a web-portal explanation without making API calls | Module-discovery and explicit absent-module/no-mobile-request guards |
| Privileged bearer persisted in session storage shared by same-origin pages | Dashboard tokens stay in page memory; old stored tokens are removed; reload requires authentication | Real browser login and authorized requests work while storage remains empty |
| Dashboard deployment lacked CSP and source throttling | Admin-only CSP, anti-framing, no-referrer, nosniff and HSTS; shared Nginx source limit for privileged auth routes; no-store auth responses | Real isolated TLS Nginx response and combined admin/Authority HTTP 429 test; `nginx -t` |
| Production CORS accepted wildcard or malformed origins | Production configuration rejects wildcard, HTTP, credentials, paths, queries, fragments and empty allowlists | Production-origin policy unit test; local test origins remain supported |
| Password hashing blocked asynchronous request workers | Login performs bounded Argon2 work in `spawn_blocking`; missing identities use dummy password work and cannot authenticate | Password and role negative tests; full Rust suite |
| Bootstrap could run in CI with a pseudo-terminal | Explicit CI/GitHub Actions refusal; collision preflight before credential generation; transactional collision checks retained | Real executable PTY lifecycle test against an isolated loopback database |
| Logout UI could imply revocation despite network failure | Separate confirmed server revocation from local sign-out | Browser confirms server rejection after successful logout |
| Cargo lock did not resolve the branch's declared dependencies | Committed resolved lockfile, including terminal password input and JWT crypto dependencies | Format, all-target check, strict all-feature Clippy and tests |

The existing role-bound web sessions, one-hour server expiry, no privileged mobile refresh,
Argon2id plus authenticator, approved Authority enrollment, six-capability delegation allowlist,
provider-evidence KYC guards, audit reasons and atomic Authority revocation remain enforced.
No marketing broadcast, live payment mode or new AWS service was enabled.

## Isolated verification

| Check | Local evidence |
| --- | --- |
| `cargo fmt --all -- --check` | PASS |
| `cargo check --all-targets` | PASS |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --all`, PostgreSQL 16 | PASS: 239 tests, zero failures, current remediation pass |
| `cargo test --all`, PostgreSQL 18 | PASS: 239 tests, zero failures, current remediation pass |
| Admin TypeScript and production build | PASS: `npm run build --prefix admin-web` |
| Expo TypeScript and production web export | PASS: `npm run typecheck`, `npm run build:preview` |
| Privileged browser E2E against real Rust/PostgreSQL | PASS: Central Admin login, collections, Owner approval/suspension, logout; Authority login, scoped collections, cross-role denial and logout |
| Bootstrap real executable | PASS: missing apply, CI with PTY, wrong database, password mismatch, invalid TOTP, no writes on failure, successful Argon2id/TOTP enrollment, hashed backup codes, consumed enrollment step, audited creation, no JWT, duplicate bootstrap and existing-user promotion denied |
| Authority enrollment failures | PASS: expired, exhausted, consumed, revoked and wrong-purpose challenges leave password sentinel unchanged; valid enrollment is single-use |
| Credential/session security | PASS: password rejection and rotation, cross-role denial, replay, concurrent proof use, throttle, replacement, database expiry and revocation |
| Offline operational gates | PASS: 65 Python tests, deployment shell syntax |
| Mobile navigation and security guards | PASS locally: routing, modules, vector assignment, font, permissions, policy, responsive layout and MFA routing |

All credentials used for these tests were disposable synthetic fixtures. No real identity,
provider consent, live payment, AWS write or production database access was used. Bootstrap
PTY output stays in process memory and is never printed or persisted by the test harness.

## Code and acceptance blockers

1. **Privileged emergency recovery is incomplete.** Backup-code generation and ordinary
   staff recovery are implemented, but privileged login accepts only six-digit TOTP.
   Stored backup codes therefore do not provide a complete Central Admin/Authority lost-device
   recovery flow. There is no implemented independently approved privileged password/device
   reset lifecycle. Do not route these accounts through ordinary staff recovery or manually
   relabel email OTP as independent approval. Define and implement the approved recovery trust
   model, distinct requester/approver enforcement, single-use expiring requests, throttling,
   transactional credential replacement, comprehensive session revocation and audited denial/
   success paths; then test it independently. First-admin bootstrap intentionally cannot recover
   or overwrite an existing identity. **This is a code/workflow blocker, not just missing credentials.**
2. Provider-backed Authority first-enrollment browser acceptance needs a consented email delivery
   environment. The real browser tests exercise pre-enrolled synthetic accounts; database/HTTP
   tests exercise enrollment contracts. Neither proves real provider delivery.
3. Complete finance operations and marketing consent/opt-out/broadcast lifecycles lack approved
   control-plane API contracts and acceptance. Current support/RFQ monitoring and manual outreach
   records must not be described as complete finance or campaign integration.
4. Independent security review must cover the complete PR against current main, including
   recovery design, shared-origin threat model, credential storage, concurrent policy revocation,
   MFA throttles, audit access/retention, KYC evidence and legacy route inventory. This engineering
   pass does not substitute for independent approval.

## Provider and production acceptance requiring credentials

- Confirm current runtime database, deployed SHA and migration ledger with an
  authorized scoped operator. Account, region and named EC2/RDS configuration
  were checked through metadata APIs above; the live database/host were not inspected.
  Staging template evidence is not proof of production state.
- Review the GitHub OIDC trust subject/audience; restrict the deploy role to intended S3 artifacts
  and SSM targets and runtime access to required secret ARNs. Verify no root credentials, wildcard
  PassRole, policy-edit privilege escalation or cross-environment access. Check actual attached
  policies and permissions boundaries rather than inferring them from a workflow role name.
- Confirm private/encrypted RDS, TLS database connections, application/migration role separation,
  backup retention, recent restorable point, encrypted manual snapshot and independently witnessed
  isolated restore with measured RPO/RTO. Run existing read-only recovery/parity gates using current
  evidence. A successful offline gate test is not a production backup or restore.
- Review the full migration ledger, including main's payment-offer and prepaid-gateway migrations.
  The remediation adds no new database migration; tests cover fresh schema and existing backfill
  cases. Confirm production checksums and data parity before startup applies pending migrations.
  Do not rename the live database or edit SQLx checksums to force parity.
- Independently approve first-admin identity and database, rehearse the terminal bootstrap,
  configure separate Authority identities and least grants, and validate real email/TOTP and
  consented DigiLocker evidence. Do not put production credentials in CI or terminal recordings.
- Rehearse SHA-pinned application rollback on isolated restored data. An older build that restores
  TOTP-only or mobile/global administrator access is not a safe rollback. Disable privileged traffic
  and revoke affected sessions before an emergency rollback; prefer a reviewed forward fix. Database
  restore is a separately approved action with reconciliation of post-backup orders/payments.
- Review production Nginx compatibility, trusted proxy topology and source-limit behavior behind
  the actual ingress, then verify CSP/CORS, secret-free logs, no-store responses and token expiry
  on the exact approved release.

## Explicit production change approvals

**None.** This task authorized code fixes, isolated tests and pushes to PR #157's existing
branch. No real privileged identity, credential rotation, migration against production,
backup/restore resource, AWS service, payment, broadcast, merge or deployment was authorized
or performed.

The repository's existing AWS workflow automatically deploys qualifying successful **main**
commits. Pushing this feature branch does not invoke that production path. A future merge
must therefore include a separate release/deployment decision and verification of the actual
production approval gate; green CI alone is not deployment authorization.
