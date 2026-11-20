# TrackMyRMC prelaunch flow audit

Baseline main commit `96625ec51425d505ab7906b45d77c74a5c2ca899`. The local checkout and GitHub agreed on the commit. The four push workflows for that commit passed.

## Coverage

| Area | Verification |
| --- | --- |
| Login and role routing | Expo role inventory, persisted Owner alias, staff access and reviewer routing. The existing browser suites exercise login, logout, role Home screens and distinct mobile and web Admin entry points. |
| Customer | Discovery, KYC handoff, direct order and RFQ entry, saved drafts, checkout choices, tracking and delivery UI. Browser fixtures verify rendering and request wiring. Provider acceptance is a separate gate. |
| Owner, staff and driver | Home cards, tab routes, swipe rows, attendance, dispatch, workforce, payroll, roster and plant-scoped data. Followed the broken payroll and roster paths through Expo, Axum and PostgreSQL. |
| Central Admin and Authority | Vite build and existing authentication, privilege, tenant and browser regression suites. The audit did not use a production operator session. |
| Data and release | Rust route registry, static client navigation/API references, SQLx migrations, operations tests, shell syntax and the staging isolation guard. The public health endpoint returned healthy application and database status. This does not identify the live deployed SHA. |

The static inventory covered the 121 files under Expo's app directory, 62 catalog destinations across 11 mobile roles, and 404 literal API and health route registrations. Catalog resolution and literal references provide coverage of route shape. They cannot establish every runtime parameter, provider response or permission combination.

## Corrected paths

| Finding | Correction |
| --- | --- |
| Payroll opened a generic form wired to retired endpoints. A slow month change could leave old records actionable. | Redirect the old route into the payroll workflow with the selected plant. Bind evidence, mutations and closure downloads to the loaded month. Preserve draft input when a save fails. Distinguish current closed payslips from historical snapshots. |
| Monthly workforce data included estimated hours, fixed calendar length and zeroed evidence. Payroll reads and some writes did not consistently follow delegated grants. | Compute the report from plant-specific attendance, approved leave, completed scheduled visits, approved expenses and stored payroll fields. Apply the existing workforce and payroll grants to report, payroll draft, posting, closure and export access. |
| Client visit scheduling discarded the requested timestamp, and visit actions could report success without a valid transition. | Persist the supplied timestamp, preserve Owner approval, permit forward transitions and keep the saved evidence on retries. Keep the form available when a request or location lookup fails. |
| Geofence and shift settings could show success while the roster still read defaults. Roster assignments did not verify that the selected employee and shift belonged to the same plant. | Persist the radius and shift settings, check plant membership for edits, store distances and the radius at punch time, and expose out-of-radius evidence to the Owner without rejecting the punch. Existing punches without measured evidence remain unset. |
| Historical billing could show records from an earlier filter or hide a refresh failure. | Key the request to the selected filter, expose retry, and describe old plan payments without asserting current entitlement. |

## Release disposition

Hold unrestricted public launch until the release evidence is complete. The following paths remain open for acceptance.

- Overnight shifts that cross midnight need a verified checkout workflow. Attendance currently keys the open workday to the current Asia/Kolkata date. The audit did not change payroll deduction or automatic late and half-day classification rules.
- Independently verify the exact deployed candidate, production migration ledger, database TLS, restore and rollback evidence, and monitoring/on-call coverage. The new migration is additive and has not been applied to production.
- Verify signed Android artifacts on physical devices, including location permission and offline transitions. Expo bundles and desktop browser fixtures provide different evidence.
- Run approved provider acceptance for OTP/email, DigiLocker, Cashfree reconciliation, Maps and WhatsApp. Use controlled accounts and approved provider environments.
- Complete the separately scoped staging penetration test and retest confirmed findings. See the repository's [prelaunch security plan](../security/PRELAUNCH_PENTEST_PLAN.md) and [production release checklist](../PRODUCTION_RELEASE_CHECKLIST.md).
