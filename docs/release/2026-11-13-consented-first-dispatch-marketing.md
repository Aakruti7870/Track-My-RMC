# TrackMyRMC — consented one-time dispatch-linked promotion

## Scope and policy
This patch covers only **dispatch-linked** TrackMyRMC platform introductions, not
marketing CRM campaign launches or the separate WhatsApp Admin Inbox media branch.

An approved Meta Marketing template is NOT recipient consent. Meta's WhatsApp
Business Messaging Policy (September 23, 2026) requires permission before
first-time promotional messages. A STOP footer is a revocation mechanism, not
a substitute for that permission.

## Updated production flow
1. New plant: Plant Owner opens Operations and switches on Automatic WhatsApp
   Dispatch. The *initial* saved preference also prepares the optional
   first-dispatch introduction. Subsequent owner choices (including OFF)
   are preserved. Plant Owner can turn the promotion OFF independently.
2. Customer order detail: Utility WhatsApp delivery updates and the **one-time
   app introduction** require separate positive button taps. No prechecked
   marketing consent or inferred consent from placing an order.
3. Actual mixer dispatch + challan: dispatch Utility event must be accepted
   by Meta, and the promotion waits at least 2 minutes. Two hours maximum
   from actual dispatch. Consent is rechecked before provider IO.
4. First-touch ledger is keyed by E.164 phone across **all plants**; only
   one automatic introduction attempt per phone, ever. Unknown Meta
   responses are not blindly retried. This ledger never authorizes
   consent by itself.
5. Send only Meta-approved `trackmyrmc_app_features` Marketing template,
   language `en_US`, via the existing configured Meta sender. Existing
   30-day cooldown and per-plant preference checks remain additional limits.
6. A verified inbound `STOP`, `UNSUBSCRIBE`, `OPT OUT`, or
   `STOP PROMOTIONS` writes durable phone-level suppression, cancels
   unsent dispatch-linked and CRM promotions, and revokes consent for all
   linked orders. Transactional order/dispatch Utility messages continue.
   `STOP ALL` additionally revokes queued dispatch Utility notifications.
7. A customer must deliberately re-enable marketing on their authenticated
   order screen to withdraw suppression for dispatch promotions. Admin
   CRM may only withdraw it through a separately authenticated, MFA-gated,
   evidence-recorded positive consent. Merely importing contacts or
   toggling delivery updates cannot undo STOP.
8. Old marketing attempted/sent records and CRM opt-outs are backfilled;
   no additional "first" message on migration.

## Deployment / acceptance
- Migrate PostgreSQL using normal SQLx release tooling. Do not apply
  migration alone to an older backend release.
- Verify CI on PostgreSQL 16 & 18, Rust fmt/clippy, mobile typecheck,
  security checks, and the actual review diff.
- Confirm no outbound queue has unexpected eligible rows before enabling
  `DISPATCH_WHATSAPP_MARKETING_ENABLED=true`. This worker is **currently OFF**
  and the PR must not silently activate it.
- Before activating the worker, verify Meta Marketing template approval,
  customer opt-in evidence, owner preference, webhook signed receipts,
  STOP with both 10-digit Indian and international E.164 numbers, and
  provider result/state reconciliation.
- Run controlled consented first-dispatch test followed by STOP, then
  a second order/new plant: no more marketing should be sent to the
  opted-out number. Check that Utility dispatch messages still work
  after ordinary STOP; STOP ALL suppresses both.
- Check user account-deletion flow: first-touch FK references are nullable
  with SET NULL so old orders/plant rows remain deletable. Phone-level
  suppressions must follow privacy retention policy.

**Do not activate** live dispatch promotions until release acceptance. CRM
campaign sending and existing operator replies remain independently gated.
