# TrackMyRMC — Google Play Data safety worksheet
**Draft for Play Console; not submitted or independently certified.** Prepared 27 October 2026 for `com.trackmyrmc.concreteking`, AAB candidate `1.1.2` / `versionCode 93`. This is a disclosure inventory, not permission to omit fields from Play Console.

Official classifications: https://support.google.com/googleplay/android-developer/answer/10787469

## Proposed collection answers (confirm from production and every bundled SDK before submitting)

| Play Data safety category | Data type / status to declare | Who / purpose | Transmission, sharing and confirmation needed |
|---|---|---|---|
| Personal info | Name, email, phone, user IDs — **collected** | OTP, staff/plant assignment, owner registration, billing records and support | Email/WhatsApp OTP providers; map to actual SDK/data flows |
| Personal info | Address and other info — **collected** | Customer delivery sites, plant address, driver employment information, KYC | User/plant information disclosed to authorized operational roles; check third-party processors |
| Location | Approximate and precise location — **collected when used** | Customer nearby plants, attendance/site visits and driver active-trip location; precise location can continue in background for active Driver trips | TrackMyRMC backend and authorized plant/customer delivery tracking; not for advertising |
| Photos and videos | Photos — **collected when submitted** | Driver proof-of-delivery and document imagery | Stored with operational record; check cloud/object retention and storage driver |
| Files and docs | Files/documents — **collected when submitted** | KYC, delivery proof, signatures and workforce/operational documents | Check Sandbox/DigiLocker and storage provider flows |
| Financial info | Purchase history; potentially other financial info — **conditional** | Concrete invoices and Cashfree transaction reference/status, staff payroll where enabled | **Do not mark payment-card collection unless SDK/server actually receives card numbers**; check Cashfree implementation |
| Health and fitness | Health info — **conditional** | Driver blood group stored by authorized plant for emergencies | Restricted plant personnel, confirm necessity and deletion/retention |
| Personal info | Other info — **conditional** | Driver emergency contact, employment joining date and experience | Determine whether contact data is collected by app or entered by plant |
| Messages | Other in-app messages — **conditional** | Support cases, conversations, operational notes | Verify customer support message content and vendor processing |
| App activity | App interactions and other user-generated content — **conditional** | Role actions, orders, audit events, KYC status | Determine collection purpose and whether audit/analytics SDKs transmit interactions |
| Device or other IDs | Device/other identifiers — **collected when enabled** | Device push token, authenticated session identifiers, Google/Firebase notifications | Verify Firebase/Expo notification collection and token registration |
| App info/performance | Crash logs and diagnostics — **unknown** | Bundled framework and telemetry services | Audit Expo/Firebase, web and native SDK builds; only assert if collected |
| Contacts | Contacts — **unknown/likely not phonebook read** | Emergency contacts may be manually typed (not phonebook access) | Validate no Android contact permission and whether categories differ for typed data |

**Collection vs sharing:** Google distinguishes transfer to a third-party processor acting strictly on behalf of the developer from a disclosure to a third party for its own purposes. Determine service terms before marking shared. Do not claim `No data shared` solely because personal data remains inside TrackMyRMC-owned servers.

**Purposes:** App functionality, account management, fraud prevention/security, customer support, optional delivery notifications, analytics only when real telemetry proves it.

**Required / optional:** Identify role-specific collection at onboarding and feature-time; sign-in identifiers are required, location/photos/notifications are purpose-optional, not requested globally at install.

**Transport encryption:** Validate HTTPS/TLS for production API and all KYC/WhatsApp/Cashfree/Google endpoints; native local queue is encrypted per trip-location source but must be verified on a signed build.

**Deletion:** An OTP-verified request form is present. Backend now has an admin step-up-gated, narrow erasure service for strictly eligible accounts on this candidate; unverified production account processing, vendor deletion, protected financial/employee records, deletion SLA and necessary retention exceptions remain outstanding. **Do not answer that users can already have all account/data deleted until deployed and audited.**

## Concrete Play Console answer checklist

1. App collects user data: **Yes**.
2. Account creation: **Yes**, including Plant Owner registration and role account provisioning.
3. Account deletion available: mark **Yes only after** public link, complete request processing and demonstrated retention exceptions.
4. Exact public privacy policy URL: `https://trackmyrmc.com/privacy_policy` (requires live HTTP verification).
5. Exact account deletion URL: `https://trackmyrmc.com/account-deletion` (requires live HTTP verification).
6. Security practices, encryption in transit, delete request: answer only from complete production security evidence.
7. Each listed category's collect/share/ephemeral/required/purpose: fill from tested API/SDK traces, not guesses; review once for Customer, Owner, Driver, Staff and Google Play reviewer paths.
8. Include partners: AWS/RDS/S3, Cloudflare/CDN, Google Maps/Places/Firebase, Expo Notifications, Meta WhatsApp, email service, Cashfree, Sandbox/DigiLocker (only if enabled).
9. Export/store screenshots of Play Console confirmation and each declaration answer for release issue #106.

**No Play Console submission was made by generating this document.**
