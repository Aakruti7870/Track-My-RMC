# Customer → Plant prepaid orders: Google Play and financial release gates

**Scope:** purchase of *physical ready-mix concrete and delivery/pumping services* after a verified plant accepts the order. There is no plan or digital-subscription checkout in this feature.

## Google Play policy basis (reviewed 2026-11-06)

- Google's Payments policy section 3(a) excludes payments for physical goods/services from Google Play Billing. TrackMyRMC may use an independent payment processor **only** for genuine concrete/delivery invoices. Do not bundle subscriptions, AI bots, digital services or activation fees into these payment orders.
- Accurate **Data safety** disclosures must include purchase history, any collected transaction/payment metadata, identity/location details and third-party SDK sharing as applicable. Card/UPI credentials collected entirely by Cashfree must not be captured, logged or retained by TrackMyRMC.
- Review app **Privacy Policy**, account deletion, payment/refund terms, vendor identity, GST/tax, delivery charges, amount and delivery date disclosure, customer support and Play reviewer access. Play review approval is never guaranteed.
- In Play Console, review and complete the **Financial features declaration** truthfully for the features the released app actually includes. Distinguish an ordinary merchant checkout for physical concrete from a wallet, money-transfer service, digital subscription, or lending product; do not select a category that the app does not provide.
- Reconcile the published Data safety form with collected purchase history, transaction metadata and any payment-provider data sharing. Test reviewer access, cancellation/refund support and hosted privacy/deletion links with the exact AAB.
- **Explicit exclusion:** no Plant Owner subscription purchase, recurring plan, website-activation charge, AI-bot fee, or digital entitlement may be paid through these customer-order Cashfree endpoints. Owner plans remain onboarding/request-and-manual-discussion only, with no in-app payment or subscription checkout linked from this feature.
- Sources:
  - https://support.google.com/googleplay/android-developer/answer/9858738?hl=en-IN
  - https://support.google.com/googleplay/android-developer/answer/10144311?hl=en
  - https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-EN

## Server-enforced lifecycle

1. Customer requests order and indicates FULL_ADVANCE or PARTIAL_ADVANCE. **No money is taken at request submission.**
2. Authorized plant owner reviews grade, quantity, total price, tax, transport, pumping and delivery slot; offers explicit final terms. Owner sets the exact partial amount in paise.
3. Customer approves the final offer version before checkout.
4. Sandbox-only prepaid handler verifies order ownership, plant scope, offer version/expiry, matching server-priced amount, and independently verified plant vendor mapping. Exactly one stable gateway order/offer is persisted per accepted version.
5. Cashfree sandbox order creation requests **one Easy Split vendor, 100%** of the approved prepayment to the verified physical supplier. Gateway response must confirm **order ID, INR, exact amount, vendor ID and split amount** before any payment session can be returned.
6. Signed webhook or authenticated customer status check triggers **independent server-side GET Cashfree order + payments** validation. A browser redirect or SDK callback alone never marks funds received.
7. In one SQL transaction: log provider evidence, mark intent VERIFIED, set offer READY_FOR_PRODUCTION, set order confirmed and payment_status paid or partial, append audit. Repeated verification is idempotent.
8. Failed/pending payments remain blocked. A payment arriving after cancellation, altered terms or expiry enters HOLD_REFUND_REVIEW and must not release dispatch. Refund and supplier settlement reconciliations require separate approved operational procedures.

## Critical merchant settlement dependency — NO GO FOR REAL MONEY

Google Play's exemption **does not** authorize a platform to collect funds for unrelated businesses and forward them on its own. Before any live payment, independently verify:

- Cashfree account onboarding/KYC and **Easy Split production activation** for TrackMyRMC's marketplace use case.
- Every RMC supplier is a verified ACTIVE Cashfree vendor, with current banking/identity authorization, consent and a correct plant mapping. Supplier remains seller/invoice issuer, unless separately agreed otherwise.
- Contract and payment-provider approval for direct supplier settlement, platform fee policy (current prototype = 0%), failed split handling, chargebacks, refunds including post-acceptance cancellation, and legal/tax review.
- Production provider credentials and notify URLs are independently tested, secret-safe and environment-specific. All live API order creation remains **hard-disabled in production** in this PR.
- Customer Cashfree transactions must **never** reuse plant subscription checkout, plan pricing, or subscription merchant entitlements.

Cashfree Easy Split reference: https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview

## Configuration and staged activation

Code is enabled only in nonproduction if all are true:
- `RMC_PREPAID_SANDBOX_ENABLED=true`
- `RMC_PREPAID_EASY_SPLIT_REVIEWED=true`
- `CASHFREE_SANDBOX_ENABLED=true`, `CASHFREE_MODE=sandbox`
- Valid sandbox client ID/secret
- Supplier record in `plant_cashfree_vendor_accounts` must be ACTIVE, sandbox-only, authorized/verified

Frontend test checkout additionally requires `EXPO_PUBLIC_RMC_PREPAID_SANDBOX_UI=true` in a **test build**, and is hidden in production. The Rust endpoint enforces its own gates regardless of frontend build flags.

**Do not set these flags or insert ACTIVE vendor records without separate sandbox validation and a verified provider marketplace setup.** No production gateway API host is reachable through this module.

## Blockers to any main merge / AWS deployment

Main auto-deploys and applies SQLx migrations. Do NOT merge until:
- PR #146 order acceptance state machine has been reviewed and merged (or the stacked changes are rebased onto the accepted base).
- PR #141 role/session security and its sequential migration history are reconciled; a fresh read-only production migration audit and tested backup/restore plan are supplied.
- Rust fmt, check, Clippy -D warnings, tests on PG16 and PG18, frontend typecheck/web build and real Expo/Play reviewer journey pass at exact head.
- Cashfree sandbox Easy Split provider acceptance proves vendor settlement, stable retry, wrong-vendor denial, late payment, webhook replays, refund path and partial-payment billing.
- Play Console Data safety and updated privacy disclosures are reviewed, and business/legal responsibility for physical-goods payments is signed off.

This feature intentionally **does not activate production payments, create live orders, trigger live refunds, modify payment-provider credentials, deploy AWS resources, or submit a Play bundle.**
