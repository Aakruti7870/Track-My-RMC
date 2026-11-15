# TrackMyRMC — Experience redesign, conversion and visual acceptance

Date: 2026-11-15 | Scope: Expo 54 customer/plant roles and Vite Admin
Status: implementation foundation in draft PR #209; comprehensive device acceptance OPEN.

## Product thesis

TrackMyRMC is a B2B concrete ordering and operations product, not a consumer shopping catalog. The most valuable interaction is the **next safe business action**. Optimizing for more cards, more gradients or longer scroll depth would actively work against dispatchers, drivers, repeat builders and plant owners. Preserve the brand's orange/graphite tokens, make status meanings unambiguous, and let users finish a job in fewer decisions.

Relevant research:
- https://baymard.com/research-articles/current-state-of-checkout-ux (updated Nov 3, 2026): high checkout friction and optional-field pitfalls.
- https://baymard.com/research-articles/checkout-flow-average-form-fields: reduce visible field effort rather than blindly minimizing steps.
- https://developer.android.com/codelabs/adaptive-material-guidance: use adaptive width classes rather than fixed tablet/phone assumptions.
- https://support.google.com/accessibility/android/answer/7101858: 48dp touch targets are recommended for Android accessibility.

Baymard research concerns general ecommerce checkouts; it informs but does not directly establish outcomes for RMC procurement. Quantify improvements with TrackMyRMC's own funnel.

## Non-negotiables

- No color-system replacement. Primary actions remain saffron/orange; graphite surfaces remain; success green, warning amber, destructive red. Never encode status by color alone.
- Do not claim accepted order, payment completed, KYC verified, dispatch started, driver location or plant availability unless corresponding authoritative backend state confirms it.
- Preserve KYC-later provisional request capability, KYC evidence gating, role permission boundaries, UPI/Cashfree payment gating, consent disclosures and audit logs.
- Do not introduce unsupported paid subscriptions, false incentives, paywall bypasses, hidden marketing opt-ins or misleading artificial urgency.
- Minimize backend and marketing telemetry collection; log only operational event codes and coarse, non-sensitive funnel steps; no Aadhaar, OTP, contacts, exact GPS, authorization tokens or documents in analytics.
- Glassmorphism is a contrast-safe visual treatment, not an obligation to blur every Android view. Native blur may be expensive or experimental; prefer a subdued, opaque enough surface for readability.
- Respect reduced motion, Android font scaling, safe areas, keyboard navigation, screen readers, offline and low-bandwidth experiences.

## Customer journey (target)

Discovery → Compare eligible plants → Start order request → Select plant, grade, quantity → Choose date/time and pump requirement → Confirm site/contact → Choose eligible payment preference → Review all details → Save draft, send permitted provisional request, or submit KYC-eligible order → Plant review/acceptance → Confirm amount and terms through existing secure payment workflow → Production/dispatch → Track real assignment and location → POD/challan/invoice → Repeat order or request quotation.

Rules:
- Home 'New Order' must allow the draft/provisional screen even without KYC; it must not bypass server-side KYC for a real order.
- Show order status and next action only from authenticated server data.
- Don't label a requested time as an accepted delivery slot.
- Don't show upfront prices when backend has not confirmed rates; display 'Awaiting plant confirmation'.
- Keep individual form sections visible at all times initially. Progressive disclosure must not hide required fields or strand users on partial pages.
- Surface errors near the responsible control in a subsequent field-level validation phase; preserve typed values.
- Resolve date selections in the user's local calendar day, not UTC conversion.
- Verify resuming drafts after app restarts, account switches, errors and returning from DigiLocker.

## Plant-owner onboarding (target)

Entry → Explain eligibility and requested information → Owner/business/contact details → Accurate plant location, map selection or manual address (with optional foreground-location consent) → Confirm supplied details → Submit request → Show reference ID and pending state → Explain approval and next steps. Do not imply email verification or account activation happens on form submission.

The short owner registration (official email lead) and full plant onboarding are separate paths; never silently combine or approve them. A submitted request is **not** a verified plant listing.

## Operational role journeys

- Customer: contextual next action, clear order summary and honest status.
- Plant Owner: today-first KPI, orders requiring approval, drivers/dispatch, workforce, commercial data and audit-worthy actions.
- Dispatcher: unassigned loads, fleet readiness, assignment confirmations, in-transit exceptions and proof of completion.
- Driver: digital licence/contact card, assigned trip, consented tracking, safe prominent one-tap arrival/POD. Do not add distracting animation while driving.
- Supervisor/Operator: actionable production states, exceptions, shift context, no ambiguous color coding.
- Quality Engineer: test capture, missing evidence, out-of-tolerance alerts, signed records.
- Store Manager: low-stock, purchase/consumption, reconciliation states.
- Accountant: customer, order, challan, invoice, GST and ledger contexts remain linked; never invent prices or confirmations.
- Central Admin: pending onboarding, role administration, visibility hold, WhatsApp inbox, review, auditing and error recovery; all gated by existing backend authorization.

## Visual quality rules

1. Type hierarchy: one display font family (existing Jakarta), readable headings, 14sp normal text baseline, accessible font scaling; never shrink essential content merely to fit a card.
2. Spacing: use the shared 4/8/12/16/24/32 scale. A consistent vertical rhythm matters more than an extra divider.
3. Buttons: flexible width, 48dp+ effective touch target, multiline localization safety, disabled/busy state and explicit action copy. Avoid duplicate primary buttons.
4. Cards: auto-height by default, minWidth 0 in flex containers, 14–20dp radius where appropriate; 0.94+ alpha surfaces over wallpaper for contrast; never make all cards identical in emphasis.
5. Status chips: green only for successful/approved, amber for pending/review, red for failed/rejected, orange for active process; always show a readable label.
6. Forms: stable top labels, required/optional clarity, correct keyboard, address suggestions reachable by touch, validation beside the field, and no discarded values on error.
7. Navigation: a back button must return to a logical parent when no history exists; deep links, provider returns and Android hardware Back must be tested individually.
8. Consent: scrollable content on short screens, full unchanged disclosure, clearly different Allow and Not now choices, and no OS prompt before the explicit app-owned disclosure.
9. Empty/loading/error: no silent blank pages. Prefer a truthful next action and retry affordance; loading placeholders should not jitter layout.
10. Visual polish: purposeful microfeedback, iconography, pressed/hover/focus states, theme coherence; respect reduced-motion and low-power devices.

## Revenue pathway candidates — only with existing supported business actions

A. More completed concrete requests: recover saved drafts, expose next action on Home, show plant-acceptance requirements.
B. Better quotation conversion: make request-quotation entry contextually visible from plants, preserve supplier onboarding lead status and explicit approval.
C. Pump service lead generation: use the existing Request a Pump Quote enquiry, never claim an instant booking or rate.
D. Supply/workforce leads: route to existing enquiry APIs, clearly identify them as enquiries requiring follow-up.
E. Repeat demand: after delivery, surface 'Start a new request' and past orders. Never silently reorder or reuse a price without supplier confirmation.

Do not add advertising cards or unapproved paid plans until lead quality, conversion and supplier operations are measured. Sales value comes from completed and serviced transactions, not card count.

## Instrumentation (design proposal, not implemented)

Measure non-PII events in aggregate:
- home_next_action_view/activate by journey state;
- order_form_started, draft_saved, request_submitted, provisional_created, server_validation_failed;
- kyc_started, returned, status_verified_or_review (no document data);
- onboarding_submitted, plant_review_decision, lead_followed_up;
- quotation_submitted, pump_enquiry_submitted, order_accepted, dispatch_completed.

KPIs: successful first request rate, draft recovery rate, median task time, invalid field error rate, KYC return completion, plant onboarding approval turnaround, RFQ-to-accepted-order conversion, repeat-order intent rate, and support contacts per successful request. Compare improvements using role- and device-aware A/B or staged measurement when capacity permits.

## Release acceptance matrix

### Visual screens
Capture and review each of the 113+ Expo app routes and Admin pages on 320, 360, 393, 412 and 600+dp widths; light/dark; 100/150/200% text scale, safe-area and keyboard open. Inspect clipping, off-screen touch controls, empty/loading/error/offline states, long Indian names/addresses and translations.

### Functional journeys
Customer home → order → KYC-later request; draft restoration; KYC redirect/return; quotation → order; plant owner onboarding + authority review; driver delivery + POD; plant dispatch; invoice print/preview; admin sign-in and visibility hold; location and WhatsApp consent choices.

### Tests and release gates
- Source inventory via `node frontend/scripts/audit-ui-elements.cjs --json` (after cd frontend).
- Source regression suite `node --test scripts/test-uiux-foundation.cjs`.
- `npm run typecheck`, `npm run lint`, Expo Doctor, Android responsive checks and full GitHub Frontend/Backend/Security CI.
- Browser screenshots using existing Playwright fixtures; **native signed Android test APK** and manual accessibility checks still required.
- Explicit QA evidence is required to close each screen. CI success is necessary, not sufficient.

## Phasing and ownership

P0 (this PR): shared foundation + navigational/consent defects + customer context + order review/onboarding trust + inventory.
P1: first-run/onboarding friction and all high-traffic customer routes; visual tests and field-level errors.
P2: all plant staff roles and Admin forms, tables, workspace isolation, responsive breakpoints.
P3: polished operational empty states, low-end performance, accessible motion and comprehensive on-device audit.
P4: measure results and evaluate optional commercial entry points; add only validated supported workflows.

**Completion state**: P0 implementation only, CI/device verification pending. No claim of full UI/UX perfection until P1–P4 have evidence.
