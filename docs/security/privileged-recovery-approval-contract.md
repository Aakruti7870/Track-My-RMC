# PR #157 — independently approved privileged emergency recovery contract

Status: **SPECIFIED, NOT IMPLEMENTED OR ENABLED** (2026-11-08). This is an
implementation contract, **not** production authorization. No unsigned ticket,
email OTP, root credential, self-approval, backup-code substitution, or manual
SQL update may bypass these controls.

## System of record and verification

The future **TrackMyRMC Privileged Recovery Approval Service (PRAS)** is an
independent authorization service. Its workforce identity provider will be
**AWS IAM Identity Center**, connected to PRAS through a dedicated SAML 2.0
enterprise application. The production TrackmyRMC AWS account currently has
one Identity Center identity and the `TrackmyRMC-Admins` group. This is
**not** enough identities to prove independent approvals. There is currently
no dedicated asymmetric KMS signing key or configured CloudTrail trail.
No recovery issuer, approvers, or authority boundaries have been approved.

Identity trust and separation:
- The **requester** must authenticate freshly to Identity Center, with MFA
  enforced by the identity-provider access policy. PRAS validates the SAML
  assertion signature, issuer, audience, recipient, request correlation,
  not-before, expiry, `AuthnInstant`, `InResponseTo`, and one-time assertion ID.
  An immutable workforce subject ID must be pre-bound to the target privileged
  user in an independently approved identity registry. Email/display names do
  not establish identity. If required MFA assurance cannot be established,
  recovery is denied.
- An **approver** must use a **different** pre-established workforce identity,
  freshly authenticated with enforced MFA. PRAS must verify membership of a
  separately provisioned `TrackMyRMC-Recovery-Approvers` group at decision
  time, independently of the target account and requester-controlled data.
  Do not treat the existing `TrackmyRMC-Admins` group as approval authority
  automatically.
- **Authority** recovery requires requester + one independent approver.
  **Central Admin** recovery requires requester + two distinct independent
  approvers. The requester must not approve their own recovery, and the two
  approvers must not be the same subject. Identity-store and subject IDs, not
  email addresses, are equality keys.
- PRAS service identity has a narrowly scoped, separately reviewed IAM role
  that alone may invoke `kms:Sign` on a dedicated asymmetric KMS key
  (`RSA_3072`, `SIGN_VERIFY`, `RSASSA_PSS_SHA_256`). The recovery executor
  pins the issuer, audience, production environment, signing-key ARN, and
  algorithm; it does not accept arbitrary key IDs supplied by a request.
- Tickets and evidence may be stored in an approved system, but a GitHub PR
  approval, signed PDF, screenshot, email, or ticket status **alone** is not
  an executable credential-recovery authorization. PRAS signs an assertion
  only after validating the verified identities, approval quorum and exact
  requested credential action.

## Data contract and mandatory audit fields

Store immutable or append-only records in an access-controlled audit store,
with a PostgreSQL transactional consumption ledger in the recovery executor.

`recovery_requests`:
`request_id` (UUID PK), `environment`, `target_user_id`, `target_role`,
`requested_action` (one of `RESET_PASSWORD`, `RESET_TOTP`),
`reason`, `status`, `requester_identity_store_id`,
`requester_subject_id`, `identity_binding_version`,
`requester_saml_assertion_id`, `requester_auth_time`,
`requester_mfa_assurance`, `requester_verified_at`, `created_at`,
`expires_at`, `policy_version`, `ticket_system`, `ticket_id`,
`evidence_uri`, `evidence_sha256`.

`recovery_approvals`:
`approval_id` (UUID PK), `request_id` (FK), `approver_identity_store_id`,
`approver_subject_id`, `approver_group_id`,
`approver_saml_assertion_id`, `approver_auth_time`,
`approver_mfa_assurance`, `approver_verified_at`, `decision`,
`decision_reason`, `decided_at`, `policy_version`,
`evidence_sha256`. Unique (`request_id`, `approver_identity_store_id`,
`approver_subject_id`). A denial is immutable and closes the request;
no later approval can overwrite it.

`recovery_assertions`:
`issuer`, `audience`, `environment`, `request_id`, `jti` (UUID),
`nonce` (cryptographically random), `target_user_id`, `target_role`,
`requested_action`, `requester_subject_id`,
`approved_subject_ids`, `ticket_id`, `evidence_sha256`,
`policy_version`, `iat`, `nbf`, `exp`,
`signing_key_arn`, `signing_algorithm`, `signature`.
Define one unambiguous canonical byte serialization; sign its SHA-256 digest
with KMS RSA-PSS-SHA256. Verify signatures against the pinned public key or
KMS `Verify` and the persisted approval state before any credential mutation.

`recovery_consumptions`:
`jti` UNIQUE, `request_id` UNIQUE, `target_user_id`,
`executed_action`, `executor_service_identity`, `consumed_at`,
`result`, `old_credential_version`, `new_credential_version`,
`revoked_session_count`, `audit_event_id`. Request and assertion consumption
must be atomic in the **same PostgreSQL transaction** as credential mutation
and session revocation. Concurrent duplicates must result in exactly one
successful execution. Never return reusable reset secrets from the audit API.

Audit every request, verified proof, approval/denial, issuance, expired token,
invalid signature, wrong role/audience/environment, replay, failed execution,
successful reset and session revocation. Include actor and target immutable IDs,
UTC timestamp, correlation ID, environment, outcome, failure category,
assertion digest, approvals and policy version. Do not log raw credentials,
TOTP secrets, backup codes, SAML assertions, reset payloads or private keys.

## Timing, replay and scope

- Request lifetime: **30 minutes** from creation.
- Requester IdP authentication proof: at most **10 minutes old** at request.
- Approver IdP authentication proof: at most **5 minutes old** at decision.
- Signed assertion: `exp-iat <= 300 seconds`, and `nbf <= now < exp`;
  allow at most **60 seconds** bounded clock skew for checks that require it.
- Post-approval enrollment challenge: **5 minutes**, single-use and bound to
  the same requester, target user, request, action and nonce.
- Every IdP assertion ID is consumed once; every `jti` and `request_id`
  is consumed once; stale or replaced evidence, a withdrawn approval, changing
  approver membership or stale identity binding denies execution.
- Rate-limit request creation, failed proof, approval and execution paths;
  do not reset counters on failed transactions. No secret material in URLs.
- Recovery may replace **only the one approved credential factor**. It cannot
  grant/change role permissions, promote an existing user, disable MFA,
  create a Central Admin, edit another user, or mint a logged-in session.
- On success revoke every access/refresh/control-center session, active JTI
  and step-up grant, expire outstanding challenges, append audit evidence and
  require fresh enrollment plus ordinary two-factor web login.
- Where an IdP account, device, subject mapping or approval quorum is
  unavailable, deny automated recovery. An offline disaster procedure, if
  ever adopted, requires a **separately approved documented trust model**.

## Implementation phases and acceptance

1. Independently approve operator identities and enroll at least three
   distinct workforce identities if Central Admin recovery is to be enabled.
2. Create and review the recovery SAML app, enforced MFA policy, approver
   group membership rules, signing key policy, dedicated signer/executor
   identities, evidence retention and CloudTrail logging.
3. Implement isolated PRAS proof validation, approval quorum and KMS signing.
   Provide mutually authenticated, narrowly scoped verification between PRAS
   and the Rust recovery executor. No self-asserted requester subject.
4. Implement Rust database migrations, transactional single-use execution,
   narrowly scoped enrollment, expiry/throttle, full session revocation and
   tamper-evident security audit. Expose no unverified recovery endpoint.
5. Negative E2E tests: unsigned/forged assertion; wrong key/issuer/audience/
   role/environment/action; expired/replayed nonce and `jti`; missing
   consent/identity binding; requester-as-approver; duplicate approver;
   withdrawn approval; changed evidence; revoked authority; parallel
   consumption; interrupted transaction; no unauthorized role elevation.
6. Independently review and witness deployment and account/device acceptance
   before enabling any production recovery route.

**Feature gate:** `PRIVILEGED_RECOVERY_ENABLED=false` until the system above
exists and is verified. The existing branch does **not** implement PRAS, and
this document must not be mistaken for an operational reset mechanism.
