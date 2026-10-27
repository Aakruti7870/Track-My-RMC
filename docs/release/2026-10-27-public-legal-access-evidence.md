# TrackMyRMC — Public legal route access audit (27 October 2026)

Status: **LIVE CLOUDFLARE BOT CHALLENGE / RELEASE BLOCKED**.
No production DB or payment mutation was made.

## Verified tests

| Request source | /privacy_policy | /account-deletion | /terms |
| --- | --- | --- | --- |
| AWS EC2, direct Nginx origin (Host: trackmyrmc.com, local loopback TLS) | 200 HTML | 200 HTML | 200 HTML |
| Same EC2, public https://trackmyrmc.com via Cloudflare | 403 challenge | 403 challenge | 403 challenge |
| GitHub Actions Playwright, public production URL | 403, `server: cloudflare`, `cf-mitigated: challenge` | Not tested after first failure | Not tested |
| Existing `https://trackmyrmc-preview.pages.dev` via public curl | 200 HTML (28kB SPA response) | 200 HTML (28kB SPA response) | Not tested |

Backend origin `http://127.0.0.1:8000/health` returned 200; Nginx is active and `nginx -t` passes. Cloudflare zone active and proxied. No DNS issue.

Cloudflare API `GET /zones/{zone_id}/bot_management` returned `fight_mode: true`, `enable_js: true`. Zone `security_level: medium`, `browser_check: on`. An exact GET/HEAD skip rule for Browser Integrity Check + Security Level was tested, **had no effect** on the public 403, and was **rolled back**. The default Bot Fight Mode remains enabled. Cloudflare documents that the Free-plan Bot Fight Mode does not support URL/path exceptions via custom WAF rules:
https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
https://developers.cloudflare.com/waf/custom-rules/skip/options/

## Safe acceptance alternatives

1. **Preferred without reducing main-site security**: validate an existing Cloudflare Pages `*.pages.dev` public legal host by rendering the full Privacy Policy and operational account-deletion form in a real headless browser and testing OTP request/submit with isolated review fixtures. Then align in-app legal links and Play Console public URLs to the **stable** Pages host. Production API for form POSTs must be validated separately; an HTTP 200 SPA shell is not sufficient.
2. **Only with explicit security approval**: disable the **zone-wide** Bot Fight Mode. This cannot be made path-scoped on the current setup and changes protection for all login/payment/API routes; keep other Cloudflare security protections on and evaluate abuse/rate limits if approved.
3. An upgraded tier may allow Super Bot Fight Mode plus URL-scoped bypass; **billable plan changes are prohibited without explicit approval**.
4. A new DNS-only legal subdomain may avoid the existing proxy but requires separate DNS change approval and appropriate HTTPS origin routing.

**Do not** mark the Play public-URL compliance gate green by changing CI to accept the origin direct 200. The public address must be crawled anonymously and render actual content, and the deletion form must remain usable.

## Remaining operational gates
- PR #118 stays draft and front-end policy gate stays red while canonical public URLs return 403.
- Source-verified deletion fulfillment is restricted to eligible synthetic customers, gated by Central Admin role/permission and MFA step-up. Production legal-retention/S3/provider deletion proof remains incomplete.
- Play Console Data safety, background location declaration and actual device video are prepared but **not submitted**; user/Work browser action required for actual Console entries and a physical Android device for footage.
- Do not generate or submit a public signed AAB until the release acceptance gates are explicitly approved.
