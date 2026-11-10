# TrackMyRMC operational push alerts (Android)

## Intended delivery contract

| Event | Eligible authenticated recipients | Sound/channel |
| --- | --- | --- |
| Customer submits a non-draft order | Owner of the order's active plant | Loud / `trackmyrmc_operations_loud_v1` |
| Same order | Active plant staff with effective `dispatch_queue` view grant, limited to admin, dispatcher, operator, supervisor and fleet manager | Standard / `trackmyrmc_operations_standard_v1` |
| Load assigned to a driver (new or changed driver) | Current active assigned driver only | Loud / `trackmyrmc_operations_loud_v1` |

The existing customer order service writes the owner `new_order` notification. A database trigger atomically creates staff copies, avoiding an extra notification path in each ordering API. Another trigger covers both dispatcher load insertion and owner/staff assignment updates. Only specific operational notification events enter the durable push outbox. Other notifications, e.g. customer updates, remain in-app.

**Push is not an authorization grant.** The Rust worker rechecks that the device token still belongs to the active recipient, and that the owner, plant-staff grant or assigned-driver relationship is still valid, immediately before delivery. A removed staff member, wrong plant or reassigned driver is not eligible. Android tokens are registered only through the existing opt-in and system notification permission flow. No marketing permissions or new user roles are added.

## Runtime configuration

1. Keep `PUSH_NOTIFICATIONS_ENABLED` unset/false until the production Firebase project and a device are verified.
2. Store `FCM_SERVICE_ACCOUNT_JSON` in the EC2 workload's AWS-managed secret/environment injection. It must be an **FCM-enabled Firebase service-account JSON** whose `project_id` matches the Android app's Firebase project. Never commit service-account private keys or put them in the React Native bundle.
3. Set `PUSH_NOTIFICATIONS_ENABLED=true` after independent production provider acceptance, then restart Rust backend.
4. Build a **new signed Android APK/AAB** with `expo-notifications` config-plugin sounds included. Rebuild and distribute through Play: an over-the-air JavaScript update cannot install the native WAV resources.
5. Log in on a real Android phone, opt in to notifications and allow system permission. Use Android Settings → Apps → TrackMyRMC → Notifications to confirm the two operational channels are audible.
6. Test a real new customer order for the active owner and an authorized dispatcher, plus a driver assignment to the correct plant. Also test denied permission, another plant's user, revoked staff permission, reassignment, retry and offline recovery. Do not declare live delivery verified based on CI alone.

## Operational safeguards and limitations

- Channel IDs are versioned because Android channel sound settings cannot be changed programmatically after creation; users may silence a channel. **No code can guarantee a louder result, bypass silent mode/Do Not Disturb, or override volume settings.**
- The custom standard/loud WAVs are original 16-kHz mono signed-PCM sounds; the loud pattern is more prominent, not a device-volume override.
- Outbox work is transactional. Worker claims at most 20 due rows per 10-second poll with SKIP LOCKED, returns failed deliveries to a bounded retry queue and stops retrying after eight attempts.
- Android can display duplicate push banners after a process crash during acknowledgment; the sender never creates a duplicate in-app feed record.
- Web-only Central Admin / Authority do **not** receive mobile sound alerts. Existing in-app notification feeds and the WhatsApp dispatch automation are separate.
- Never include private FCM credentials in support requests or GitHub CI logs.
