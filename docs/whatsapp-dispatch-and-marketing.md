# TrackMyRMC — WhatsApp Dispatch Utility and Optional App Promotion

## Meta policy basis (checked 10 November 2026)

WhatsApp business-initiated messages require an approved template and prior recipient
opt-in. Transactional order status is **Utility**; app discovery, concrete booking and
pump-booking promotion is **Marketing**. Do not put marketing copy inside Utility
variables or the Utility template: Meta may recategorize it.

Sources:
- https://whatsappbusiness.com/policy/
- https://help.twilio.com/articles/360039737753-Recommendations-and-best-practices-for-creating-WhatsApp-Message-Templates

## Exact lifecycle

1. Authorized plant staff create and prepare a load. `load_lifecycle::advance("prepare")`
   validates production, TM and driver and generates a challan. Two independent
   **unsent** database outbox records are created in that same transaction:
   the per-load Utility event and the per-order optional Marketing event.
2. Plant staff issue the gate pass. No message is sent.
3. Authorized staff confirm **Dispatch Load**. `advance("dispatch")`
   validates the challan and gate pass, atomically changes the load to
   `dispatched`, then activates its unique Utility notification.
   At first dispatch, only the optional Marketing event can become eligible.
   Duplicate dispatch retries do not create or send another event.
4. The Utility worker checks explicit delivery WhatsApp consent, plant opt-in
   and approved provider template configuration. The signed trip URL resolves
   in the browser without requiring the app; status, grade, quantity, TM, driver
   and challan summary are shown. No raw customer phone, token, or document
   signatures are exposed to a public link.
5. Meta acceptance is stored as `accepted`, never `delivered`.
   Verified signed Meta webhooks transition to `sent`, `delivered`, `read`,
   or `failed`. A timeout is `uncertain` and is **not** blindly retried.
6. The marketing worker is entirely separate. Marketing requires both
   delivery and marketing consent, plant owner marketing enablement,
   separate global activation and Meta's approved Marketing template.
   It starts only after at least one Utility event was Meta-accepted.
   Marketing is restricted to once per plant + phone within 30 days.
   Customer opt-out, WhatsApp pacing, template rejection or recipient
   messaging limits can prevent marketing delivery; never imply delivery.
7. The public trip page includes a Play Store CTA regardless of whether
   marketing messages are permitted. This keeps app discovery available
   without risking transaction notifications.

## WhatsApp Manager templates

### Template A — Utility

Suggested name: `trackmyrmc_trip_dispatched`; category: **UTILITY**;
locale `en_US`; **six body parameters** in this order:

> Your concrete delivery is dispatched.
>
> Plant: {{1}}
>
> Order: {{2}}
>
> Grade: {{3}}
>
> Quantity: {{4}} m³
>
> Transit Mixer: {{5}}
>
> Track your mixer and view delivery challan: {{6}}
>
> TrackMyRMC — Built Better.

Variables:
1. Registered plant's name
2. Order reference
3. Grade
4. Load quantity (not whole-order quantity for multi-load orders)
5. TM registration
6. Signed HTTPS tracking URL

No additional promotional wording. Set meaningful Meta approval examples.
If Meta requires a URL CTA rather than a body link, update the backend sender
parameters and the approved template together and repeat acceptance tests.

### Template B — Marketing

Suggested name: `trackmyrmc_app_features`; category: **MARKETING**;
locale `en_US`; no dynamic parameters. Include an approved static
"Download TrackMyRMC" button using the fixed Play Store URL.
Sample body to submit:

> Plan your next concrete delivery with TrackMyRMC.
>
> Track transit mixers, book concrete delivery slots, place RMC orders,
> view delivery challans, and request concrete pumps.
>
> Download TrackMyRMC to explore these services. Reply STOP to opt out
> of promotional updates.

Link: https://play.google.com/store/apps/details?id=com.trackmyrmc.concreteking

Before live use, confirm both templates exist under the actual sender's WABA,
are approved in the intended categories and match the runtime parameter
schema. Do not assume storing a template name means Meta approved it.
Customer opt-out from WhatsApp must also disable the recorded marketing
consent in TrackMyRMC, not just suppress replies.

## Existing environment and activation

Reuse existing `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`,
`META_WABA_ID`, `META_GRAPH_API_VERSION` (OTP adapter remains unchanged).
The following settings are independent:

| Setting | Default | Purpose |
|---|---|---|
| `DISPATCH_WHATSAPP_ENABLED` | off | Start Utility worker |
| `META_DISPATCH_TEMPLATE_NAME` | absent | Approved Utility template |
| `DISPATCH_WHATSAPP_MARKETING_ENABLED` | off | Start Marketing worker |
| `META_MARKETING_TEMPLATE_NAME` | absent | Approved Marketing template |
| `META_APP_SECRET` | absent | Validate Meta webhook HMAC |
| `META_WEBHOOK_VERIFY_TOKEN` | absent | Meta subscription challenge |
| `META_DISPATCH_TEMPLATE_LOCALE` | en_US | Utility template locale |
| `META_MARKETING_TEMPLATE_LOCALE` | en_US | Marketing template locale |

The plant owner must separately enable each feature in Operations.
Customer/plant order consent is a different record than Android push
notification permission. No bulk upload can silently consent a recipient.

## Approval and operations

Do not merge or deploy until Rust/SQLx migrations and integration tests,
Expo web/native checks, provider sandbox tests and production release review
pass. Test invalid signatures, expiry, two-worker concurrency,
duplicate dispatch, parent/child tenant isolation, mismatched template
parameters, Meta rate limits, failed/late webhooks and opt-outs.

No live WhatsApp send should be attempted without explicit approved credentials,
recorded recipient consent and authorization from the production release owner.
