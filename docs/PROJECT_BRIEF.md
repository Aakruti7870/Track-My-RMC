# TrackMyRMC — product and delivery brief

**Editorial baseline: 9 November 2026.** This brief consolidates the product purpose, user journeys, technical boundaries and acceptance expectations. Implemented behavior must be checked against the candidate source and tests. Requirements below that need provider, operational or device evidence remain acceptance criteria rather than claims of completed certification.

## Purpose and value

TrackMyRMC coordinates ready-mix concrete enquiries, supplier responses, orders, plant operations and delivery evidence. Customers can discover plants and follow their requests; approved plant teams manage work within their entitlements; drivers manage assigned trips and delivery tasks. Separate privileged web workspaces support platform governance and delegated service operations.

The product combines an Expo/React Native application, a Rust Axum API, PostgreSQL and a Vite/React privileged dashboard. AWS hosts the approved production runtime. The canonical website is `https://trackmyrmc.com`; Android distribution follows a separate signed-build and Google Play acceptance process.

## User journeys and boundaries

| User | Intended journey | Boundary to preserve |
| --- | --- | --- |
| Customer | Authenticate, choose location, discover suppliers, submit an enquiry/RFQ, review offered terms, place/follow an order, inspect available delivery evidence and request support | Customer records and contact details remain scoped to the authenticated journey and approved supplier/customer disclosure rules. Provider checkout and KYC require independent acceptance. |
| Plant Owner | Complete approved plant onboarding, maintain a reviewed profile, manage plant/staff access, respond to enquiries and oversee operational modules | Ownership and approved plant scope are enforced by the API. An unapproved registration is not authority to operate a plant. |
| Plant staff | Authenticate with the approved email/MFA flow and use assigned dispatch, production, quality, inventory, finance, fleet or workforce modules | Navigation visibility is a convenience; every backend action still requires the appropriate role, module permission and plant scope. |
| Driver | Authenticate, inspect an assigned trip, use the approved trip lifecycle, share location when required and submit permitted proof of delivery | Background location requires its own active-trip disclosure/consent. A login permission card does not grant continuous tracking consent. |
| Central Admin | Authenticate through the dedicated web flow and perform explicitly permitted governance and support work | Sensitive mutations require server-enforced permissions, audit reasons and fresh MFA where specified. |
| Authority | Authenticate through the separate web identity and work only in delegated, allowlisted capabilities | Authority does not inherit Central Admin policy, privilege management, unrestricted financial actions or support case closure. |

The role/permission matrices and backend policies are authoritative for each operation. Do not create a new mobile role to expose privileged web capabilities. A successful browser sign-in does not waive approval, MFA or tenant checks.

## Experience standards

Every data view must distinguish initial loading, a successful empty response, populated results and a failed request. Loading a new workspace must remove the previous workspace's records before displaying the new title or actions. A failed page must offer a retry against that same collection and pagination offset. Only a successful empty response may say that no records were found.

Network and provider failures must use concise, actionable language. Customers should not see raw HTML, proxy diagnostics, stack traces, internal host details or build configuration instructions. For a temporary server failure use: “The service is temporarily unavailable. Please try again.” Preserve useful, controlled validation feedback from JSON API responses.

If a map cannot load, plant listings remain available. Retrying the map must not reload the entire application or discard the selected location, filters or enquiry draft. Missing or unauthorized map credentials require operator remediation; repeated retries do not grant access or replace valid configuration.

Account-specific state must end with the account session. Sign-out clears tokens, loaded private records, open governance panels, identity fields, passwords, MFA values and unsent notes. The next sign-in starts with a fresh workspace. If server revocation cannot be confirmed, the application must clearly distinguish local sign-out from confirmed server revocation.

Controls need visible labels, keyboard focus and meaningful accessible names. Errors use alert semantics; non-error loading/status updates use status semantics. Review narrow/mobile and desktop widths, large text, keyboard navigation, light/dark themes and long values. An automated layout scan is supporting evidence; actual device and assistive-technology acceptance remain separate.

## API, files and data integrity

Client API configuration accepts an HTTPS backend origin or supported API base. Local HTTP is permitted only for supported development hosts in development builds. Embedded credentials, query strings, fragments and unsupported protocols are invalid. Configuration validation must fail before a credential-bearing fetch.

Authenticated multipart uploads use the same request timeout, cookie policy, bearer handling, controlled error normalization and session-loss behavior as other protected requests. The browser/native runtime supplies the multipart boundary. Upload error and retry behavior must not imply that a failed request stored a file, linked a certificate or published a profile.

The backend remains responsible for file ownership, validated metadata, size limits, supported evidence and authorization to link or retrieve documents. A client timeout does not prove the server rolled back a completed write: inspect the resulting record before retrying a financial or other non-idempotent mutation. Never automatically replay a payment, approval or dispatch action merely because the client lost the response.

Delivery, billing and workforce workflows must preserve their existing state transitions, audit history and separation of duties. Test both authorized success and forbidden/cross-plant cases. Migrations require review of an upgrade path and representative existing data, not only successful creation of an empty database.

## Consent and provider readiness

Mobile post-login cards offer the existing foreground-location and optional-notification choices; driver camera access remains purpose-specific. “Not now” must not prevent authentication. Native grants, app preferences and server-side customer-discovery consent are separate facts. Background tracking must retain its active-trip disclosure and consent.

DigiLocker verification requires provider-selected Test/Live routing, verified provider results and recorded consent. A browser return URL supports navigation; it is not proof of identity verification. Cashfree callbacks do not independently mark an invoice paid, activate a subscription or authorize a refund. Server reconciliation and the approved financial contract remain necessary.

Provider sandbox success, UI mocks and successful compilation are development evidence. Activation requires the applicable provider entitlement, controlled tests, approved operations and release evidence. Keep general automation and support-follow-up switches disabled unless their separate acceptance is recorded.

## Build, test and release process

Use the tracked lockfiles and the repository's supported CI toolchain. Local PostgreSQL and integration fixtures must be isolated from production. Build the Expo web export and privileged dashboard separately; run client guards, request regressions, responsive browser checks and the Rust/PostgreSQL suite for the final candidate.

The review package contains the exact source SHA, change summary, test results, dependency reports and unresolved risks. Required CI and dependency-security checks must correspond to the candidate, rather than an earlier green commit. An approved release uses immutable SHA-pinned artifacts, the existing AWS workflow and a matching independent release approval.

Production verification should identify the running artifact/SHA and test API, Expo and privileged-dashboard routing through the intended origin and public edge. Record results rather than assuming success from a process restart. Application startup applies pending SQLx migrations, so deployment review must include database compatibility and a recovery plan.

A successful AWS deployment does not establish signed Android acceptance, payment-provider activation, live KYC entitlement, restored-backup validation or a complete security assessment. Those approvals have their own evidence and owners.

## Acceptance record

For each release, complete the following record using actual evidence. “Not verified” is an acceptable assessment; an invented PASS is not.

| Field | Required content |
| --- | --- |
| Candidate | Full commit SHA, branch/PR, artifact names and cryptographic digests |
| Scope | Changed journeys, roles, providers, schema and operational settings |
| Functional evidence | Test run links, environment, actual results and failed/waived cases |
| Security evidence | Permission/tenant denial cases, session tests, dependency findings and dispositions |
| Device evidence | Signed artifact/version, device/OS, permission, background-location, offline/reconnect and reviewer results |
| Data evidence | Migration parity/compatibility, TLS tests and relevant restore/rollback results |
| Operational readiness | Approved scoped operator, monitoring, escalation contact and incident/recovery procedures |
| Provider activation | Exact mode, approved entitlement and controlled provider acceptance |
| Decision | PASS / FAIL / NOT VERIFIED / NOT APPLICABLE, accountable owner and independent reviewer |

Commercial targets, availability objectives, supported device policy, retention periods and recovery objectives must be agreed with the accountable product/operations owners. This brief does not invent customer commitments or declare these values approved.

## Support and incident reporting

A useful defect report includes the role, route, exact build/SHA, device/browser, reproduction steps, expected result, actual result and a sanitized timestamp/correlation reference. Do not include tokens, OTPs, recovery codes, customer records, database URLs or provider secrets.

Investigate loss of access, unexpected record visibility, financial inconsistency and delivery-state corruption with the relevant security or operational owner before retrying mutations. Preserve audit evidence and use the approved recovery path. Support staff can acknowledge a problem without claiming a payment, delivery or verification succeeded before the server evidence confirms it.

Engineering setup and commands are in the [root README](../README.md). The [production checklist](PRODUCTION_RELEASE_CHECKLIST.md), [quality audit](audits/2026-11-09-project-quality-audit.md), [role matrix](ROLE_PERMISSION_MATRIX.md) and [payment contract](payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md) provide the linked implementation and acceptance details.
