# TrackMyRMC — Background location declaration + physical Android recording plan

Prepared 27 October 2026. **Play Console declaration is NOT submitted; video is NOT recorded.**

Official guide: https://support.google.com/googleplay/android-developer/answer/9799150

## Suggested single-feature declaration text (review before submission)

**Core feature:** Live transit-mixer delivery tracking for assigned Driver trips.

**Why background location is necessary:** TrackMyRMC assigns a transit mixer and an authenticated Driver to an RMC order. Delivery tracking must update the plant dispatcher and authorized customer while the Driver drives with the phone locked, screen off, or app in the background; a foreground-only app cannot reliably preserve the route and ETA throughout a delivery. The app requests location only during the active Driver delivery after a prominent in-app disclosure and the separate Android runtime prompt. The Driver may decline, with reduced live tracking; no background location is used by Customers, Owners, Staff browsing, or for ads. When the trip is completed, cancelled, explicitly stopped or authorization is revoked, the service must stop.

**Where the feature appears:** Driver login → assigned trip → Trip Details → Start tracking → prominent location disclosure → Agree & Continue → Android location permissions. A foreground-service notification should be visible during delivery. The authorized Customer may view the mixer location in Track Order.

**App listing copy draft:** “Authorized drivers can share live transit-mixer GPS location and delivery ETA with their assigned plant and customer during an active delivery, including while the phone is locked. Tracking ends after delivery completion.”

**Prominent disclosure must remain visible before OS permission:**
> This app collects location data to enable live mixer delivery tracking even when the app is closed or not in use.

Additional accompanying explanation: real-time ETA to assigned plant and customer; no advertising; explicit Not now choice; no background location for any other role.

## Actual Android-device video storyboard — suggested 25–30 seconds

Capture the genuine signed candidate Android device using the built-in screen recorder with notifications/identifiers redacted. **No synthetic video, simulator screenshots, static slide sequence, or source-only claims may substitute.**

| Seconds | Required footage |
|---|---|
| 0–3 | Open TrackMyRMC on actual Android phone; navigate to Play Reviewer/Driver login |
| 3–6 | Authenticate as isolated Driver review account without showing secret OTP |
| 6–10 | Open assigned review trip `PLAY-REVIEW-001`; tap delivery tracking |
| 10–15 | Hold the complete **prominent in-app background location disclosure**, legible on screen |
| 15–19 | Tap **Agree & Continue**, show Android foreground/location prompt and, where appropriate, permission settings for Allow all the time |
| 19–24 | Minimize/lock app; show persistent ongoing trip-tracking foreground-service notification or customer location updates, with private data hidden |
| 24–29 | Return to the app, complete/end the trip and show tracking stopped. Re-run decline/revoke to capture additional evidence if the 30-second limit requires a second internal QA clip |

The Google submission form accepts a publicly accessible unlisted YouTube video or accessible Google Drive MP4 link. Never paste login code or production user data in it.

## Pass/fail evidence checklist

- [ ] Reviewer credentials work for isolated Driver account and assigned active trip
- [ ] Recorded from signed candidate using Android 13–16, not Expo Go
- [ ] Disclosure before any background GPS system permission request, with affirmative and decline controls
- [ ] System prompt visible and permissions state accurately recorded
- [ ] Active delivery continues in background; foreground-service notification and customer location update shown
- [ ] Stop/revoke prevents continued backend telemetry uploads
- [ ] Google Play Console > App content > Sensitive app permissions > Location permissions: one feature description matches footage
- [ ] Uploaded video URL opens anonymously and is attached to the declaration
- [ ] Location is featured in store listing description and Privacy Policy, and app uses API 36
- [ ] No background GPS for Owner/Customer/Staff and no ad/analytics background collection

**Do not claim background-location declaration verified until this device footage and Play Console confirmation exist.**
