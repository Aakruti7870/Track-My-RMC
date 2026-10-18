# TrackMyRMC Light Theme — screenshot contract (2026-10-18)

The reference image provides **exact hexadecimal colours**, not exact font metrics or responsive dimensions.
The visual mockup provides approximate hierarchy, spacing, shadows and radii. Preserve the existing
Android/web business logic, roles, map interactions, location permissions, and eligibility checks.

| UI element | Exact reference hex | Runtime usage |
| --- | --- | --- |
| Card background | `#FFFFFF` | 86% alpha over theme wallpaper |
| Card border | `#FFE2C7` | Glass Card outline |
| Main title | `#1F2937` | Display and primary text |
| Secondary text | `#4B5563` | Body-muted, location/address |
| Distance chip | `#FFF3E0` | Distance label |
| Google Maps chip | `#E0F0FF` | Google Maps listing |
| Verification chip | `#E8F5E9` | Verified listings ONLY |
| Primary button | `#FF8A00` | Light-mode brand button |
| Button border | `#FFA94D` | Outlined-action stroke |
| Disabled button | `#E2E8F0` | Disabled background |

## Screenshot element specifications

- Background: existing `Background Light Theme.png` artwork, 35% image opacity over an opaque white-grey scene.
- Heading: “Nearby” dark slate, “Plants” orange. Existing Outfit display font is retained.
- Subtitle: muted slate, visually secondary to the heading.
- Map: interactive Google Maps canvas, approximately 24 dp corner radius and a 1.5 dp peach frame.
- Map floating control: white circular GPS target with shadow, provided by map component.
- Search: pill-like elevated white input, search glyph, muted placeholder, peach outline.
- Filters: orange filled button with dark accessible text and a filter icon.
- Plant tile: white 86%-opaque glass-style surface, rounded approximately 22 dp with soft shadow.
- Plant symbol: building glyph inside a raised light tile; company title bold and wrapping.
- Address: slate text and location glyph, wrapping for long addresses.
- Status chips: orange distance, blue Google Maps, green verified ONLY, grey unverified.
- Actions: Quotation and Details are outlined; Place Order is active only for eligible registered plants.
- Disabled CTA: cool grey background with readable slate text; no action callback.
- Typography: use existing Outfit/Jakarta families, responsive sizing; screenshot pixel dimensions are not hard-coded.

## Engineering limitations and safeguards

Expo React Native + web uses `src/theme/tokens.ts` and `ThemeProvider.tsx` at runtime.
The `native-theme/TrackMyRmcLightTheme.kt` file is **not executed by Expo**. It is a portable
future-native reference. Do not replace the Expo theme provider with Kotlin without building a native bridge.

The dark theme token object is deliberately unchanged. Page components should prefer `colors.*`
instead of hard-coded colours. This commit updates the shared token layer, Card/Button primitives,
and the Nearby Plants screen; independently styled legacy screens must be audited separately.

**Accessibility:** white on `#FF8A00` is about 2.36:1 contrast and fails WCAG AA for normal text.
The light theme uses dark text `#1F2937` (approximately 6.21:1 contrast) on active orange buttons.

**Verification:** a public Google listing is not TrackMyRMC verified and must not display the green
verification appearance unless `plant.verified` is true. Never permit orders for Google-only listings.

**Glass rendering:** alpha and shadow simulate frosted glass, but do not imply true backdrop blur.
Real blur requires a supported BlurView / CSS backdrop-filter, with performance and accessibility checks.
