# Customer Home tracking card

The Home response selects a customer's active delivery first (including active loads), then a pending order. When neither exists, the UI displays the most recent real order; only customers with zero orders see the presentation-only demo. No demo records are inserted.

## Relationships and reused APIs

- `orders.customer_id -> users.id`, `orders.site_id -> customer_sites.id`, `orders.plant_id -> rmc_plants.id`.
- `order_loads.order_id -> orders.id`, `order_loads.mixer_id -> transit_mixers.id`, `order_loads.driver_id -> users.id`.
- GPS is selected from `gps_telemetry` using **load + mixer + driver** together, never mixer-global coordinates.
- `challans.load_id -> order_loads.id`; the existing `/challan/:orderId` screen fetches the issued customer document.
- Reuses `GET /api/customer/home`, `GET /api/customer/orders/:id/tracking`, and `GET /api/customer/orders/:id/challan`. Tracking adds `plant_phone` and `challan_available` after existing ownership authorization. No migration, new table or endpoint.

## Maps and freshness

Original SVG schematic demo artwork has an 800×400 viewBox with responsive 2:1 sizing. It uses no Google tiles, key, GPS coordinates, phone numbers, or persisted order. DEMO remains visible alongside the requested reference badge. Pending orders do not show a demo route. Terminal orders retain a truthful summary.

Real tracking reuses LiveMap, with real Google markers and an orange Directions route requested at most once per minute per map mount. Invalid GPS is rejected; samples older than 90 seconds, future timestamps and fetch errors never receive the LIVE label. The last valid position and timestamp remain visible during stale/error states. No ETA is invented when the API returns no route ETA. Directions failure leaves legitimate markers and recorded details intact.

Production workflow already injects EXPO_PUBLIC_GOOGLE_MAPS_KEY from trackmyrmc/app-runtime. No secret value is accessed by this change. Cloud-side API enablement, billing and referrer restrictions require production verification; iframe/WebView referrer authorization remains a deployment consideration. Authentication, script error and timeout failures show a map fallback; recorded coordinates remain outside the map.

Home refreshes on focus and every 15 seconds while foregrounded, with cleanup on blur/unmount and overlap protection. Tracking polling stops for terminal orders; Home discovery continues so another order can take priority. Driver calls use only the selected active load's authorized phone. Plant calls use the assigned plant contact, with plant discovery when absent. Demo print explains availability; real print opens the existing issued-challan screen.

## Release

Shared Expo JS changes require a new Android build (or an independently configured compatible OTA release). A web deployment does not change installed Android apps. No new permissions or native dependency changes.
