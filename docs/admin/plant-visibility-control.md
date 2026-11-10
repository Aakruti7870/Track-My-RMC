# Central Admin — Plant Visibility

The web-only Central Admin dashboard exposes a **Plant Visibility** section. Search registered plants by name, code or linked Google Place ID, filter by held/no-hold, and select a plant to **Hold Visibility** or **Restore Visibility**.

The existing governance API (`POST /api/control-center/plants/:plant_id/governance`) accepts `kind: "visibility"` with `value: "HOLD"` or `"VISIBLE"`. Mutations require the dedicated Central Admin `WebAdmin` session, `plant.view` and `plant_owners.manage` permissions, recent TOTP step-up, and a printable reason of 10–500 characters; every decision is audited. No separate mobile admin login is created.

The additive SQLx migration adds `plant_admin_controls.discovery_visible BOOLEAN NOT NULL DEFAULT TRUE`, preserving existing plant publication by default. A held plant is excluded on the server from registered customer lists, geo searches (regardless of km radius), comparisons, customer-home nearby plants, and Google Places results **when the Google Place ID is linked to a registered plant**. New customer direct orders and RFQs are rejected even when the customer submits a stale saved plant ID or Google Place ID.

**This is not operational suspension.** Plant owner and staff authentication, pre-existing orders, dispatch, challans, invoicing and delivery records remain unaffected. Restoring visibility does not bypass onboarding approval or order restrictions. Unlinked third-party Google businesses and third-party Google Maps pages cannot be hidden by TrackMyRMC. An existing mobile map cache may need a fresh query to discard stale entries.

Acceptance: migration on PostgreSQL, admin permission/TOTP audit checks, hold/restore regression, customer geo search, Google linked listing suppression, direct order rejection, RFQ rejection, existing-order continuity and admin web build. Deployment and Android AAB generation require separate release authorization.

## Exact Google Place ID hold (including unregistered listings)

The same Super Admin section also offers **Hold Google Listing / Restore Google Listing** using an exact Google Place ID and a fresh MFA step-up. The operator can find IDs in **Plant Master → Discover Google-listed RMC plants**. The `google_plant_visibility_exclusions` table keeps only the exact ID, decision, actor, reason and timestamp (not the Google business profile). `GET/POST /api/control-center/plants/google-visibility` require the same Central Admin privileges.

The Google nearby API excludes held IDs from live provider results; direct Place ID interest and RFQs are rejected. An exact Google ID hold also suppresses a registered plant subsequently linked to that Place ID. It cannot hide an external Google Maps page, and cannot automatically suppress an unlinked duplicate listing with a different Place ID. A new lookup or app refresh removes stale device results.
