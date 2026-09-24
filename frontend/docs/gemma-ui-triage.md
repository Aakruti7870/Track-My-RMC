# Gemma UI Audit Triage

This note records which Gemma full-application findings are accepted, rejected, or require additional evidence before code changes. The goal is to prevent an AI review from overriding TrackMyRMC's intended role model or working business flows.

## Locked product boundary

- Central/Super Admin control-plane access is web-only through the dedicated Control Center after restricted MFA bootstrap and re-authentication.
- Authority remains an operational Plant Staff role and continues through the approved Plant Staff email/MFA authentication flow. Authority is not a Central Admin and does not receive Control Center provenance.
- Mobile must not add a `central_admin` route/directory or expose Authority as a Google Play reviewer identity. Authority operational authentication is preserved even though former public Authority control-plane pages are not restored to the mobile route tree.
- Plant-side `admin` and `accountant` are legitimate operational mobile roles and must not be removed merely because their names sound privileged.
- Authentication, six-digit OTP, KYC/DigiLocker, payments, orders, tracking, role routing and Play policy behavior remain protected.

## Rejected / corrected Gemma findings

1. **Do not delete `frontend/app/admin` or `frontend/app/accountant`.** `frontend/src/auth/roleRoutes.ts` intentionally routes plant `admin` to `/admin` and `accountant` to `/accountant`. `frontend/app/admin/index.tsx` renders the plant `StaffHome`; this is not the Central/Super Admin control plane.
2. **The shared `trackmyrmc:free-tools:v1` storage key is intentional.** `customer/projects.tsx` reads locally saved Free RMC Tool calculations so they can be associated with project sites. It is not a data-key collision.
3. **`support.tsx` is complete.** The audit saw a bounded excerpt and incorrectly classified it as truncated.
4. **`passkey-ceremony.tsx` already guards browser-only APIs.** `readFragment()` checks both `Platform.OS === "web"` and `typeof window !== "undefined"`, and the effect returns early on native.
5. **Any other 'truncated' finding from the audit is not actionable unless the complete repository file or a failing build/test confirms it.** The Gemma workflow intentionally supplied bounded source excerpts.

## Accepted direction

- Continue the shared token/component system instead of screen-by-screen ad-hoc styling.
- Preserve the mobile/admin boundary in CI without removing Authority's approved email/MFA operational login.
- Continue touch-target, accessibility-label and reduced-motion audits.
- Improve theme startup behavior only after validating the storage implementation and without introducing a new persistence dependency unnecessarily.
- Add `Linking.canOpenURL`/error handling where external-map or external-app launches are not already guarded.
- Apply stricter role guards to genuinely sensitive workforce/payroll/owner operations after checking the backend role contract.
- Continue premium polish through shared buttons, inputs, cards, tabs, feedback states, loading states, maps and motion rather than duplicating styles in screens.

## Required review sequence

1. Sync feature branch with current `main`.
2. Run Mobile UI Quality Gate on the synchronized head.
3. Validate confirmed behavior-sensitive findings with Laguna XS before code changes.
4. Apply minimal production-safe fixes.
5. Run Kimi architecture/regression review.
6. Run full mobile/admin quality gates again.
7. Open the final feature PR to `main` only after the branch is current and required checks are green.
