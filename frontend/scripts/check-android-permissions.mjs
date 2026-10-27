#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repoRoot = path.resolve(root, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const app = JSON.parse(read("frontend/app.json")).expo;
const android = app.android || {};
const permissions = new Set(android.permissions || []);
const blocked = new Set(android.blockedPermissions || []);
assert(app.version === "1.1.2", "Expected Android release version 1.1.2.");
assert(android.versionCode === 93, "Expected Android versionCode 93.");
assert(android.package === "com.trackmyrmc.concreteking", "Android application ID must remain stable.");

for (const permission of ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]) {
  assert(!permissions.has(permission) && !permissions.has("android.permission." + permission), permission + " must not be requested.");
  assert(blocked.has("android.permission." + permission), permission + " must remain blocked.");
}
assert(permissions.has("CAMERA"), "Camera permission must be declared for proof-of-delivery photos.");
assert(permissions.has("ACCESS_COARSE_LOCATION") && permissions.has("ACCESS_FINE_LOCATION"), "Foreground location permissions are required for supported location features.");
assert(permissions.has("ACCESS_BACKGROUND_LOCATION"), "Background location permission must remain explicitly declared for active Driver trips only.");

const consent = read("frontend/src/location/BackgroundLocationConsent.tsx");
const tracking = read("frontend/src/location/tripTracking.ts");
const trip = read("frontend/app/trip/[id].tsx");
const plants = read("frontend/app/customer/plants.tsx");
const currentLocation = read("frontend/src/location/currentLocation.ts");
const workforce = read("frontend/app/workforce.tsx");
const onboarding = read("frontend/app/plant-onboarding.tsx");
const pod = read("frontend/app/pod/[id].tsx");
const push = read("frontend/src/notifications/PushNotificationBridge.tsx");
const postAuthConsent = read("frontend/src/permissions/PermissionProvider.tsx");
const pushClient = read("frontend/src/notifications/pushClient.ts");
const privacy = read("frontend/app/privacy.tsx");
const terms = read("frontend/app/terms.tsx");

assert(consent.includes("This location is collected in the background — even when the app is closed or not in use"), "Background location disclosure must state background use.");
assert(trip.includes("This app collects location data to enable live mixer delivery tracking even when the app is closed or not in use."), "Driver trip screen must disclose background location use.");
assert(trip.includes("Agree & Continue") && trip.includes("Not now"), "Driver disclosure must require affirmative consent and offer a decline path.");
assert(tracking.indexOf("requestBackgroundLocationConsent()") < tracking.indexOf("Location.requestBackgroundPermissionsAsync()"), "Driver disclosure must precede the background permission request.");
assert(plants.indexOf("requestNearbyPlantsLocationConsent()") >= 0 && plants.indexOf("requestNearbyPlantsLocationConsent()") < plants.indexOf("Location.requestForegroundPermissionsAsync()"), "Nearby Plants disclosure must precede foreground location permission.");
assert(currentLocation.includes("requestAttendanceLocationConsent") && currentLocation.includes("requestSosLocationConsent"), "Attendance and SOS location must use purpose-specific disclosures.");
assert(workforce.includes("requestFieldVisitLocationConsent") && workforce.includes("requestAttendanceLocationConsent"), "Workforce attendance and client visits must use purpose-specific disclosures.");
assert(onboarding.includes("requestPlantOnboardingLocationConsent") && onboarding.indexOf("requestPlantOnboardingLocationConsent()") < onboarding.indexOf("Location.requestForegroundPermissionsAsync()"), "Plant onboarding disclosure must precede foreground location permission.");
assert(pod.includes("Camera access for proof of delivery") && pod.indexOf("Camera access for proof of delivery") < pod.indexOf("ImagePicker.requestCameraPermissionsAsync()"), "Camera disclosure must precede the camera permission request.");
assert(pod.includes("Choose a proof-of-delivery photo"), "Photo picker must explain what selected data is attached.");
assert(postAuthConsent.includes("Enable notifications") && postAuthConsent.includes("Not now"), "Signed-in notification consent must be opt-in with a decline path.");
assert(!push.includes("setConsentVisible"), "Do not display a second notification dialog on login.");
assert(pushClient.includes("requestPermission = false") && pushClient.includes("permission.status !== \"granted\" && requestPermission"), "Push registration must not request permission without explicit opt-in.");
assert(privacy.includes("Location and live delivery tracking") && privacy.includes("Camera, photos and files") && privacy.includes("Notifications") && privacy.includes("Retention and account deletion"), "Privacy policy must cover location, camera/photos, notifications, and deletion.");
assert(terms.includes("Terms & Conditions") && terms.includes("support@goldetech.com"), "Terms must be available with a support contact.");
assert(fs.existsSync(path.join(repoRoot, "frontend/app/privacy_policy.tsx")), "Public /privacy_policy route must exist for Play Console and login links.");

if (failures.length) {
  for (const failure of failures) console.error("ANDROID PRIVACY GATE FAILED: " + failure);
  process.exit(1);
}
console.log("Android privacy/permission checks passed for TrackMyRMC 1.1.2 / vc93.");
