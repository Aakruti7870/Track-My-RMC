# TrackMyRMC UI/UX foundation review — 2026-11-15

Scope: Existing React Native/Expo 54 customer/staff application and Vite admin web. The brand colors, role permissions, KYC evidence rules, API contracts and payment workflows are unchanged.

## Implemented foundation

- Contrast-safe translucent card variant and improved card border visibility on light surfaces.
- Multiline buttons and status badges with responsive sizing and accessible touch targets.
- Status color mappings for DigiLocker document failures, in-progress and review states.
- Scrollable, opaque-background prominent location disclosure with explicit Allow/Not now and existing policy text.
- KYC back button with deterministic customer-home fallback for deep links; verified CTA returns home.
- Reduced-motion support for Admin web.
- Read-only source inventory of every Expo route and shared UI module, uploaded as a CI artifact.

## Required acceptance before calling the entire UI/UX complete

1. Download the `uiux-screen-inventory` CI artifact and review flagged files; static heuristics do not prove runtime bugs.
2. Device-test 320/360/393/412/600+ dp widths, Android font scaling 100%/150%/200%, portrait, light/dark themes.
3. Verify Customer Home, New Order, Plants, Order Details, KYC, KYC Return, all staff tabs, workforce forms, Admin dashboard and billing flows.
4. Test each back button both after normal navigation and via deep-link entry; test Android hardware Back on role roots and open consent dialogs.
5. Test consent on compact screens and with large text, Not now, Android Back, privacy link, and OS permission requests. Do not modify disclosure content without privacy/compliance review.
6. Test form dropdowns with empty/many options, keyboard, loading/error, validation, accessibility and long labels.
7. Validate status colors with semantic text labels (not color alone), reduced motion, card clipping and smooth scrolling on low-end devices.
8. Use a signed test APK and authorized user roles for native acceptance. Static checks and web browser tests alone cannot verify native rendering or Live KYC.

## Release decision

The implementation above is a first foundation pass, **not final UI/UX acceptance**. Merge only after CI, review and device QA. Do not bundle this UI change with the DigiLocker production rollout.
