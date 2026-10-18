# TrackMyRMC: Dark Graphite / Amber Glassmorphism Contract

Reference: user-approved Nearby Plants dark-theme artwork (October 2026).

## Source of truth and supported platforms

The live shared UI uses `frontend/src/theme/tokens.ts`, `ThemeProvider.tsx`, and the reusable UI components. Changes to these tokens apply to Expo Android and Expo Web. `frontend/native-theme/TrackMyRMCDarkTheme.kt` is the equivalent native Android palette for future Kotlin-native screens; it **is not loaded by Expo**. Do not replace the TypeScript theme provider with Android-only Kotlin: doing so would leave Web and shared React Native screens unthemed.

## Exact swatches from the supplied art

| Role | RGB hex | Effective treatment |
| --- | --- | --- |
| Card graphite | `#1A1F26` | Artwork suggests 35–40% alpha over blur; use 78% on unblurred surfaces for text contrast |
| Amber perimeter and glow | `#FF9A3D` | 20–30% border on ordinary cards; stronger on active controls |
| Heading | `#FFFFFF` | Solid; never inherit surface opacity |
| Secondary text | `#B8C1CC` | Solid |
| Orange button/distance | `#FF8A00` | Solid for primary action, 18% alpha for chips |
| Google Maps source badge | `#2563EB` | 18% background only; not the app's brand accent |
| Pending/unverified badge | `#64748B` | 18% background; plain shield outline, never green |
| Disabled button | `#94A3B8` | 30–40% grey-surface treatment, legible disabled text |

## Visual specification

- **Root scene:** `#0E1116` opaque background; the relevant dark wallpaper asset is shown at 35% opacity. Do not make navigation scenes transparent: they can reveal the previous route's Home screen.
- **Page title:** Outfit Bold, 30px in shared tokens; white "Nearby" and orange "Plants" on the Plants screen. Supporting sentence uses Jakarta, 12–14px, `#B8C1CC`.
- **Map region:** existing real Google Map, not a static screenshot; 20px radius, thin amber glass border with restrained orange shadow. Preserve Google logo and map attribution.
- **Search field:** dark graphite surface, readable light text, silver placeholder, 46px minimum height. Search icon can keep its existing SVG.
- **Filter:** orange `#FF8A00` fill and white label/icon; 46px or more touch height. Existing State/District/Taluka/City logic is unchanged.
- **Plant card:** rounded 20px dark glass rectangle, `#FF9A3D` perimeter and subtle shadow, 16px interior padding. Provide an opaque-enough fallback for unsupported blur.
- **Plant glyph:** 48px dark frosted square, silver factory/building symbol and amber edge.
- **Name:** Jakarta Bold 17–20px white, line wraps as needed. Address: Jakarta Medium 13px, silver, with location glyph.
- **Chips:** distance orange, Google Maps blue only for the listing source, verification state grey when not verified and green only after true verification. 28px minimum height, pill/rounded 9px.
- **Request Quotation:** transparent amber-tinted outlined glass button, quotation icon and white text on dark.
- **Plant Details:** matching amber-outlined glass button and document icon. It must open the existing details modal.
- **Place Order:** orange if `order_enabled`; otherwise grey disabled with `accessibilityState.disabled=true`. Never enable Google-only listings.
- **Details modal:** opaque dark root, dark glass contents, readable labels and dividers.
- **Bottom navigation:** dark graphite `surfaceSecondary` frosted glass and understated amber border; preserve active tab and tap targets.
- **Accessibility:** minimum 44px press targets, sufficient contrast, dynamic text scaling; do not fade a parent view because doing so also fades text.
- **Performance:** reuse the existing 35% compressed wallpapers; avoid piling multiple BlurView layers into a scrolling list of plants.

## Safety / behaviour unchanged

Do not change geolocation permissions, live Google Places data provenance, KYC verification semantics, backend API contracts, booking/order gating, or analytics to match this aesthetic. Code review must verify the light theme remains unchanged.

## How to verify

Run from `frontend/`: `npm run typecheck`, `npm run lint`, `npm run check:modules`, `npm run check:auth-routing`, `npm run test:maps`, `npm run build:preview`. Manually inspect both themes on Android and Web, including a Google-only business, a verified plant, a disabled order button, and the modal.
