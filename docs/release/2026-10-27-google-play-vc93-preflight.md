# TrackMyRMC — Google Play pre-AAB compliance review (27 October 2026)

## Candidate (not released)
- Requested versionName: **1.1.2**; versionCode: **93**, greater than 92.
- App package: `com.trackmyrmc.concreteking` unchanged.
- The previous repository versionName is **2.0.32**, so 1.1.2 is a **displayed versionName downgrade**, even though Play's versionCode increases. Confirm desired visible label before publication.
- Release workflow now validates the app/workflow agreement, privacy rules, TypeScript, public privacy/deletion URL HTTP status, Android API 36 generated Gradle properties and the registered upload-signing fingerprint.
- **No signed AAB generated, no Google Play submission, no production deployment** from this branch.

## Code checks and observed gaps

| Gate | Evidence | Verdict |
| --- | --- | --- |
| Android app id | `frontend/app.json` | Source verified |
| Android target API 36 | Expo SDK 54 and `frontend/plugins/with-play-store-compatibility.js`; generated Gradle requires recheck | Source verified, binary not verified |
| Background GPS | `app/trip/[id].tsx`, `BackgroundLocationConsent.tsx`, `tripTracking.ts` | Source disclosure present; Play declaration video + signed-device acceptance required |
| Camera/Photos | `app/pod/[id].tsx`, photo picker and blocked broad media permissions | Source verified, merged manifest/device acceptance required |
| Notifications | PR #117 v2 post-auth choices/bridge | Not on main; full CI/mobile proof pending |
| Privacy policy | `frontend/app/privacy.tsx`, `/privacy_policy` route | Draft updated; public published HTTPS page and store listing field not verified |
| Terms | `frontend/app/terms.tsx` | Draft updated; production parity unverified |
| Account deletion | Public `/account-deletion`, OTP and pending request backend | Submission exists; end-to-end fulfillment, related user data purge and SLA not yet verified |
| Data safety form | Must disclose name/contact, identifiers, geolocation, operational/photos/signatures, employment/blood-group/emergency data, KYC and payments as applicable, SDK activities | Play Console form and SDK data flows not accessible here; **manual mandatory** |
| Store billing | Physical RMC orders vs. digital plant subscription tier | **Manual Google Play Payments policy review mandatory** |
| Reviewer login | `/review-access` and isolated OTP | Real signed-device login, authorization and screenshot/video required |
| PR #117 prerequisite | Owner-plan/consent/backend migrations on draft PR | Backend PG16/18 green at reviewed commit, frontend CI previously failed and under repair |

### High-risk policy point: digital subscription payments

Google Play Payments policy ordinarily requires Google Play Billing for digital application functionality/subscriptions purchased inside Play-distributed Android apps unless a section 3/8/9 exception or approved alternative billing program applies. Indian user-choice alternative billing requires formal enrollment and related reporting. A link or in-app flow that directs users to Cashfree for **digital owner subscriptions** may violate Play rules without enrollment, even when physical RMC invoice payments through Cashfree are allowed. The owner's initial plan-duration choice is non-billable. Do not activate an in-app Cashfree owner-premium checkout without verifying Play eligibility.

Policy source: https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
India alternative billing: https://support.google.com/googleplay/android-developer/answer/13306652?hl=en-GB

### Google Play mandatory manual data checks

1. In Play Console, verify **App content → Data safety** accurately reflects SDK collection and all app roles/versions; compare third-party flows (Google Maps, Meta WhatsApp, KYC, Cashfree, notifications) and in-app privacy policy.
2. Verify **Privacy policy** field: `https://trackmyrmc.com/privacy_policy` serves an unrestricted HTML page (HTTP 200), contains the latest policy, and is reachable outside authenticated sessions.
3. Verify **Account deletion** field: `https://trackmyrmc.com/account-deletion` serves publicly and the request can be completed; separately verify processing/irreversible deletion and legally required retention exceptions.
4. Complete **Background location** permission declaration, reviewer video, and live driver trip disclosure screenshot with temporary/declined/granted scenarios.
5. Confirm **Foreground service type location** is listed in Google Play App content if required by the current Console and works for signed Android 16 devices.
6. Confirm **Target API 36**, no broad media permissions, upload certificate SHA-1, Firebase package, deep-links, reviewer sign-in, versionCode 93 uniqueness and App Bundle manifest after signing.
7. Verify exact branch CI green, release recovery and production plan approval. Check no live payment/billing change is bundled accidentally.

This file is a preflight report, **not a claim of Play policy certification**. Do not merge signed-release workflow to main or distribute a public AAB until every mandatory gate above has evidence.
