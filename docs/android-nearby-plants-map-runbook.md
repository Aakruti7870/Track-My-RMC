# TrackMyRMC — Android Nearby Plants blank-map release runbook

## Symptom and distinction

The web Nearby Plants map uses the Maps JavaScript API and works under
`EXPO_PUBLIC_GOOGLE_MAPS_KEY` and browser HTTP referrer restrictions.
The installed Android app uses `react-native-maps` + the **Maps SDK for
Android**, configured from `GOOGLE_MAPS_ANDROID_KEY`. Plant listings are
obtained separately through the backend Places integration and can continue to
work even when native map tiles fail. A visible Google logo alone does not
prove that the native map key is authorized.

## Code / CI safeguard

The Expo prebuild upserts `com.google.android.geo.API_KEY` into the app
manifest from the Android-specific environment variable. The signed AAB
workflow fails if the generated Android manifest does not contain exactly one
entry with the expected value; the key is not printed. Map tile timeouts show
retry and a safe external Maps option without blocking the list.

## Mandatory Google Cloud and Play Console validation

1. In Google Cloud Console, open **APIs & Services > Library** in the project
   that owns the key provided as `GOOGLE_MAPS_ANDROID_KEY`. Enable **Maps SDK
   for Android** and confirm project billing is active.
2. In **APIs & Services > Credentials**, select the **Android-specific** key,
   not the browser-referrer-restricted JavaScript key or the server Places key.
   Apply the **Android apps** application restriction with package
   `com.trackmyrmc.concreteking` and the correct certificate SHA-1. Restrict
   the API to Maps SDK for Android.
3. In **Play Console > Release > Setup > App integrity > App signing**, copy
   the **App signing key certificate SHA-1**. Register this SHA-1 in the
   Android key restrictions for Play-installed app versions. If testing an
   upload-signed APK outside Google Play, separately allow its upload-key
   SHA-1 (currently checked by the AAB workflow as
   `3D:5F:80:59:1C:BA:69:1B:03:28:4D:A1:74:91:38:1D:8F:A1:32:DC`).
   **Do not assume those certificates match**. Debug builds use a third
   signing certificate and may require a separate allowed entry.
4. Rebuild/release a new signed Android binary (a website redeploy cannot
   replace a native SDK key baked into an installed APK/AAB). Distribute using
   the same channel that reproduces the fault, ideally a Play internal test,
   and reinstall/update the device.
5. With the failing map open, gather native diagnostics with
   `adb logcat -e "Google Maps Android API"`. Look for authorization
   failures, wrong key, API-disabled/billing, and a package/fingerprint
   mismatch. Keep API key values out of shared logs.

## Acceptance

- On the signed Play-installed build, Nearby Plants shows Google map tiles,
  legible geography and the same nearby markers as the site for the same GPS
  position, query and radius.
- Tapping markers selects the correct plant; moving/zooming the map remains
  interactive; listings, Google attribution, location consent, and map
  search/filter logic remain intact.
- Offline or blocked maps display a non-blocking retry and external Maps
  option while the plant list remains usable.
- Verify on the actual affected Android device; static tests and successful
  compilation are **not** evidence of Maps SDK authorization in Google Cloud.
