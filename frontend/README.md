# TrackMyRMC — Expo client

This is the established TrackMyRMC Expo SDK 54 / React Native client, not a disposable create-expo-app starter project. **Do not run reset-project on the production branch.**

## Responsibilities

The app implements Customer, Plant Owner, Driver and scoped staff workflows. The separate Central Admin and Authority identities are **web-only** and must not be introduced into this app's login role selector. Authentication/session policy is enforced by the Rust API, not merely by client navigation.

Most screens are in app/; shared components, API client and authentication helpers are in src/. The native Android background-trip-location implementation is under modules/trip-location. Keep existing role navigation, consent gates, privacy/Play reviewer paths and backend API contracts intact when changing UI layout.

## Local setup

Use Node.js 20+ (the CI toolchain uses Node 20). Install locked packages:

~~~bash
cd frontend
npm ci
~~~

Set EXPO_PUBLIC_BACKEND_URL (or EXPO_PUBLIC_API_URL) in a local environment file. The production API origin is https://trackmyrmc.com; local HTTP is accepted only for supported development hosts. **Never place API secrets, OTP peppers or provider secret tokens in EXPO_PUBLIC_ variables.**

Run:

~~~bash
npm run start
npm run typecheck
npm run check:auth-routing
npm run check:modules
npm run check:single-font
npm run check:vector-symbols
npm run check:android-layout
npm run check:android-permissions
npm run check:play-policy
npm run test:maps
npm run build:preview
~~~

The web preview is not a substitute for testing on a signed Android build. Native location services, background permissions, Google Maps Android SDK, notification delivery and Cashfree SDK require dedicated device/build checks. Signed AAB production workflows are defined under ../.github/workflows/.

## Release safeguards

- Follow the existing Play reviewer flow, privacy/deletion policies and scoped user sessions. Do not add Central Admin/Authority to Expo.
- Keep customer-to-plant payment checkout disabled unless sandbox/provider acceptance and Play disclosures are complete. Never add owner plan/subscription payment flows inadvertently.
- Validate iOS/Android permission consent and background-location behavior on real devices before Play submission.
- Production web deployments require the exact release SHA and the repository's independent AWS approval workflow.

See the [root README](../README.md), [Customer API contracts](../docs/API_CONTRACT_PARITY.md), [Owner/staff role policy](../docs/ROLE_PERMISSION_MATRIX.md), [payments acceptance](../docs/payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md) and [production release checklist](../docs/PRODUCTION_RELEASE_CHECKLIST.md).


## Android post-login permission cards

After successful account authentication (customer WhatsApp OTP, plant-owner/staff
email OTP plus MFA, or the dedicated Google Play reviewer code), the native
Android app displays the same orange-and-graphite TrackMyRMC permission-card
flow. It is implemented centrally in `src/permissions/PermissionProvider.tsx` and
uses existing AppText, Button, Card, theme, and spacing tokens. There is no
second notification modal or reviewer-only consent bypass.

- Every mobile role reviews foreground location and optional notifications.
  Drivers additionally review camera access for proof of delivery. Background
  location is **never requested at login**: the active Driver trip retains its
  mandatory, separate Google Play prominent disclosure and consent.
- The cards offer **Allow** and **Not now**, then hand off only an affirmative
  action to Android's native permission dialog. A denial does not prevent
  signing in. Staff attendance, SOS, plant onboarding, and POD retain their
  purpose-specific disclosures when the feature is used.
- No call, broad storage/media-library or unrelated Android permission is
  requested or advertised. Photo selection uses Android's system picker.
- Completion and actual choices are saved per account and role under a
  versioned **local** key; they are not mistaken for Android permission
  grants. Customer discovery requires its separate server-side opt-in and
  an actual foreground location grant.
- Notifications register a device only after the new per-account opt-in and
  actual Android grant. A Not now choice revokes an existing registered device
  token where Android allows token retrieval. Permission settings remain
  available later from each role's More/settings screen.

The web app does not display Android-specific OS consent cards. Central Admin
and Authority remain web-only. Run `npm run check:android-permissions`,
`npm run check:play-policy`, `npm run typecheck`, and the
Android real-device reviewer/driver trip tests before a final signed AAB.

Notification choices made later in App permissions or Notifications update the
same account/role preference as the welcome cards. Both initial push registration
and every token rotation require the current preference and Android grant.
The permission regression suite (`node --test scripts/test-permission-consent.cjs`)
checks relogin persistence, rotation after opt-out, listener cleanup, and delayed
customer-location hydration; Frontend CI runs it before the build.
