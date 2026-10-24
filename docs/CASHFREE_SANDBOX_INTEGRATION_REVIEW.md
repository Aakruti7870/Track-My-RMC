# Cashfree PG sandbox integration — review candidate

Status: **INERT CODE ONLY / NOT LAUNCH-READY**. Safe merge candidate: the sandbox adapter is hard-disabled when APP_ENV is production, and its SQL is staged outside automatic migrations at `ops/pending-migrations/cashfree_sandbox_intents.sql`. A merge automatically deploys code to production, but must not alter the production schema, merchant settings, invoices or transactions. A separate reviewed migration/staging enablement is required before any sandbox checkout can work.

## Security boundary

- Gateway host is compiled to `https://sandbox.cashfree.com/pg`, not environment-selectable. No API method accesses `api.cashfree.com`.
- All endpoints **also fail closed in APP_ENV=production**, even if flags and credentials exist; they otherwise fail closed unless `CASHFREE_SANDBOX_ENABLED=true`, `CASHFREE_MODE=sandbox`, and both `CASHFREE_SANDBOX_CLIENT_ID` / `CASHFREE_SANDBOX_CLIENT_SECRET` exist (the server verifies minimum key presence, never returns credential contents).
- These variables are **not set by this PR**. The production mode hard stop is not controlled by a client request. Add only after security review in the appropriate secret-managed staging environment; do not add to GitHub or frontend assets. The `CASHFREE_SANDBOX_*` names intentionally cannot accidentally use the existing production credential names.
- Plan checkout ALSO requires `CASHFREE_PLAN_PRICES_APPROVED=true` and a reviewed row in `cashfree_approved_plan_prices` with `is_active=TRUE`. Migration intentionally seeds **zero** plan prices. No UI quote or submitted amount is used for charge authorization.
- Schema in `ops/pending-migrations/cashfree_sandbox_intents.sql` is **not** on the sqlx migration path; there are no new production database schema writes when this patch deploys. In staging, the schema must be installed only after separate approval and verification.\n- The sandbox checkout serves both `PLAN` (authenticated and verified plant owner) and `INVOICE` (authenticated invoice customer only). The invoice amount is derived from the invoice outstanding balance, not a client amount.
- Provider creates/gets orders with Cashfree `x-api-version=2025-01-01`, server-only `x-client-id` / `x-client-secret`, HTTPS timeout and immutable server-generated gateway order ID. One payer + `idempotency_key` maps to one DB intent and a stable Cashfree `x-idempotency-key`. Different payloads with the same key are rejected.
- The public webhook has a max-size guard, verifies `x-webhook-timestamp` within five minutes, base64/HMAC-SHA256 against **raw bytes** and constant-time MAC verification. Authenticated webhooks alone never activate funds or access. Cashfree's server-side GET order must match the intended order ID, INR currency, exact amount and `PAID` before `VERIFIED`.
- Event digest uniqueness and per-intent status row lock prevent duplicate accounting of replayed events. A stale `ACTIVE` or `EXPIRED` provider response cannot downgrade a previously verified payment.
- **IMPORTANT LIMITATION:** `VERIFIED` is a **sandbox receipt only**. This patch DOES NOT credit `plant_payments`, mark an invoice paid, activate `plant_plan_subscriptions`, grant promotions, or mark a refund executed. Those effects remain intentionally blocked pending approved entitlement/reconciliation and exact-amount refund policies. The sandbox refund endpoint only creates a `REVIEW_REQUIRED` proposal and does not call Cashfree refunds API.
- No actual Cashfree provider calls or money transfers are made by installing these files. Calls are possible *only* after a separate staging enablement. This PR does not change AWS resources, secrets, active database, DNS or deployed production code.

## API routes (new, gated, not connected to the existing mobile checkout UI yet)

`POST /api/payments/cashfree/sandbox/checkout`

Authenticated payload for plan: `{"kind":"PLAN","plant_id":"<plant UUID>","sku":"STARTER","idempotency_key":"approved-unique-key-123"}`.
Requires verified owner pricing, an approved catalog row and sandbox flags.

Authenticated payload for invoice: `{"kind":"INVOICE","invoice_id":"<invoice UUID>","idempotency_key":"unique-invoice-key-456"}`.
Requires the requesting user to be the invoice customer; outstanding amount from PostgreSQL.

Returns `{"status":"PAYMENT_PENDING","order_number":"trmc_<id>","payment_session_id":"...","cashfree_environment":"sandbox","payable":...}` only after Cashfree order/session verification. Use the existing Android Cashfree SDK with this session ID after enabling staging.

`POST /api/payments/cashfree/sandbox/webhook` — raw signed Cashfree webhook; the order is independently verified through GET `/pg/orders/{order_id}` before a `VERIFIED` receipt is recorded.

`GET /api/payments/cashfree/sandbox/orders/{intent-uuid}` — requester-only provider reconciliation/status; does not post money/activate access.

`POST /api/payments/cashfree/sandbox/orders/{intent-uuid}/refund-proposals` with `{"refund_key":"unique-refund-key-123"}` — requester-only idempotent `REVIEW_REQUIRED` refund proposal; no external refund API call.

**Existing app route `POST /api/plant-plans/activate` remains unchanged and fail-closed.** Web payments remain unsupported until a separate approved UI implementation.

## Testing / required next slices

Automated Rust unit tests in `cashfree_sandbox.rs` cover raw-body signature acceptance and tampering/replay, provider order ID/amount/currency, and idempotency key validation. PR CI must pass cargo fmt/check/clippy and integration tests against PostgreSQL 16/18; migration applied against fresh isolated CI database.

Before any actual sandbox session is enabled:
1. Product owner signs final plant-premium and promotion pricing/discount/catalog rules, invoice partial payment rules, tax, receipt, refund and entitlement durations; approve `cashfree_approved_plan_prices` population.
2. Verify Cashfree merchant account identity, sandbox app ID/secret, approved webhook version, events, webhook URL, Android return behavior, and staging HTTPS domain whitelist.
3. Add synthetic provider mock (success/failed/expired, event reorder, invalid timestamps/signatures, duplicate callback, mismatched amounts, retry races); run PostgreSQL 16/18 state tests, explicitly assert NO ledger/subscription writes.
4. Implement the **next separate fulfillment PR**: atomic Cashfree-verified customer invoice ledger and plant subscription/promotion activation; immutable provider payment reference, concurrent partial payment reconciliation, safe refund authorization/reversal and settlements.
5. Run actual authorized Cashfree SANDBOX E2E success/failure/payment retry/refund/reconciliation with test identities and collect redacted evidence.
6. Only then consider any production credential/money-flow change under a separate explicit user approval.

No secrets, payments, refunds, subscriptions, or production DB were changed in this PR. The migration was explicitly removed from the automatically executed `backend/migrations` directory in response to the requested safe merge.
