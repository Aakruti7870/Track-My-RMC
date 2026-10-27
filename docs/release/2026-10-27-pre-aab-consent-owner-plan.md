# TrackMyRMC — Pre-AAB Owner Onboarding, Permissions and Exit Acceptance

Status: **Feature branch / PR #117**, not production launch acceptance. Production `main` automatically starts AWS deployment after the required CI runs succeed; do not merge this migration without the independently approved recovery plan.

## Implementation and provenance

- Plant owner self-onboarding: `frontend/app/plant-onboarding.tsx`, `backend/src/routes/plant_onboarding.rs`. Owner chooses **1 / 3 / 6 / 12 months**. The application stores an unpriced plan preference and pending request; it does **not** activate subscriptions, send a priced quote or open checkout. Email outreach is a separate commercial operation. Existing clients without this field retain legacy compatibility.
- Authorized plant reviewer: `frontend/app/admin-plant-onboarding.tsx` displays preferred duration. Do not represent approval as paid entitlement.
- Post-OTP/MFA introduction: `frontend/src/permissions/PermissionProvider.tsx` uses consent version 2 per authenticated account, including isolated Google Play reviewer identities. No device-global pre-login location prompt. Camera and driver background GPS are described here but OS permissions are only requested by their purpose-specific flows.
- Single notification consent: `PushNotificationBridge.tsx` no longer independently opens a duplicate modal. Push tokens are registered after OS permission grant.
- Back navigation: `RootBackHandler.tsx` blocks Android hardware-back exit from the home route of every mobile role, displays **Stay in App / Exit App**, and preserves login if user exits. Nested screens retain standard back behavior. Browser `beforeunload` is browser-controlled and cannot guarantee a custom dialog.
- Migration `0042_owner_plan_and_post_auth_consent.sql` must be sequenced after pending `0041_plant_challan_templates.sql` from PR #116 before a production merge.

## Must-test manual matrix on signed Android release build

| Role / route | First login disclosure | Location purpose | Home back |
| --- | --- | --- | --- |
| Customer /customer | Customer consent v2, all optional | Nearby Plants foreground only | Stay or Exit |
| Plant Owner /owner | Consent v2, no onboarding payment | Plant mapping only when requested | Stay or Exit |
| Staff admin /admin | Consent v2 | Scoped work action only | Stay or Exit |
| Dispatcher /dispatcher | Consent v2 | Trip/work only if authorized | Stay or Exit |
| Operator /operator | Consent v2 | Scoped work only | Stay or Exit |
| Supervisor /supervisor | Consent v2 | Scoped work only | Stay or Exit |
| Accountant /accountant | Consent v2 | None at login | Stay or Exit |
| Quality Engineer /quality_engineer | Consent v2 | Scoped work only | Stay or Exit |
| Fleet Manager /fleet_manager | Consent v2 | Scoped work only | Stay or Exit |
| Store Manager /store_manager | Consent v2 | Scoped work only | Stay or Exit |
| Driver /driver | Consent v2 | Active-trip foreground, separate background disclosure | Stay or Exit |
| Review Customer /customer | Same flow on isolated reviewer account | Verify Nearby Plants disclosure | Stay or Exit |
| Review Owner /owner | Same flow on isolated reviewer account | No GPS at login | Stay or Exit |
| Review Driver /driver | Same flow, distinct active-trip disclosure | GPS starts only after reviewing PLAY-REVIEW-001 | Stay or Exit |

## Additional acceptance scenarios

1. Fresh login must show version-2 modal only **after** OTP or staff MFA completion; never before account verification. Review accounts use the same behavior.
2. “Not now” for camera, location and notifications must never open OS permission prompts. Check backend saved choices on `/api/me/permission-consent`.
3. Customer can browse by city or PIN with no location. Permission revoke in Android Settings must be respected, with a re-prompt only when a feature is requested.
4. Driver active-trip foreground/background GPS still requires existing two-step, purpose-specific prominent disclosure; no background tracking after trip/POD.
5. POD camera request follows its own disclosure immediately before the OS prompt; gallery uses Android photo picker without broad media access.
6. Owner application rejects unselected/invalid durations on the UI and rejects unsupported numeric values at the API. Authorized admin sees 1, 3, 6, 12 month interest for review. Owner cannot be charged as an onboarding side effect.
7. All role Home back presses show **Stay** and **Exit**, repeated back does not stack multiple dialogs; Cancel/Stay preserves app and sign-in. Nested screens navigate back normally. Browser tab exit remains browser-controlled.
8. Google Play review OTP/MFA route cannot be bypassed. Android permission rationale and data-safety disclosures must match actual app behavior.
9. No SMS/email payment link, Cashfree live charge, provider credentials, production DB mutation or new paid AWS resources may be created in this feature PR.

## Still outstanding before an AAB submission

- Signed candidate AAB from the accepted commit with matching versionCode and verified Play policy declarations.
- Physical Android 13–16 device screenshots and testing: first-install, login, foreground GPS, background GPS during a trip, camera allow/deny, review OTP, return-to-home exit behavior, and settings revocation.
- Independent isolated snapshot restore / production migration safety acceptance from launch issue #106.
- Plan quotation and payment release gating: approved rate card, authenticated paywall activation only when quote accepted, webhook and ledger reconciliations. **Plan duration capture alone does not complete the Cashfree module.**
