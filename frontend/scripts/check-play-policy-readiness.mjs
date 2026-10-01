#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const frontendRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(frontendRoot, "..");
function read(relativeToRepo) {
  return fs.readFileSync(path.join(repoRoot, relativeToRepo), "utf8");
}
function fail(message) {
  console.error(`PLAY POLICY GATE FAILED: ${message}`);
  process.exitCode = 1;
}
function expect(condition, message) {
  if (!condition) fail(message);
}
function expectIncludes(content, snippet, message) {
  expect(content.includes(snippet), message);
}

const app = JSON.parse(read("frontend/app.json"));
const expo = app.expo || {};
const android = expo.android || {};
const permissions = new Set(android.permissions || []);
const blocked = new Set(android.blockedPermissions || []);

expect(expo.version === "2.0.31", "Expo version must be 2.0.31 for vc89.");
expect(android.versionCode === 89, "Android versionCode must be 89.");
expect(android.package === "com.trackmyrmc.concreteking", "Android package identity changed unexpectedly.");

for (const permission of [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
]) {
  expect(blocked.has(permission), `${permission} must remain blocked.`);
}
for (const permission of [
  "READ_MEDIA_IMAGES",
  "READ_MEDIA_VIDEO",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
]) {
  expect(
    !permissions.has(permission) && !permissions.has(`android.permission.${permission}`),
    `${permission} must not be requested as an app permission.`,
  );
}

expect(
  permissions.has("ACCESS_BACKGROUND_LOCATION"),
  "Background location is expected only for active Driver delivery tracking and must remain policy-gated.",
);
const tripTracking = read("frontend/src/location/tripTracking.ts");
const tripScreen = read("frontend/app/trip/[id].tsx");
const locationConsent = read("frontend/src/location/BackgroundLocationConsent.tsx");
const customerPlants = read("frontend/app/customer/plants.tsx");
expectIncludes(tripTracking, "options: { allowBackground?: boolean }", "Background permission must be gated by an explicit caller option.");
expectIncludes(tripTracking, "options.allowBackground === true", "Background permission may run only after app-owned consent.");
expectIncludes(
  tripScreen,
  "This app collects location data to enable live mixer delivery tracking even when the app is closed or not in use.",
  "Prominent background-location disclosure text is missing.",
);
expectIncludes(tripScreen, "Agree & Continue", "Background-location disclosure requires affirmative consent.");
expectIncludes(tripScreen, "Not now", "Background-location disclosure must offer a decline path.");
expectIncludes(
  tripScreen,
  "assigned plant and the authorized customer tracking view",
  "Disclosure must explain who receives active-trip location data.",
);
const backgroundConsentIndex = tripTracking.indexOf("requestBackgroundLocationConsent()");
const backgroundPromptIndex = tripTracking.indexOf("Location.requestBackgroundPermissionsAsync()");
expect(
  backgroundConsentIndex >= 0 && backgroundPromptIndex > backgroundConsentIndex,
  "Background runtime permission must be requested only after TrackMyRMC prominent consent.",
);
expectIncludes(locationConsent, "requestNearbyPlantsLocationConsent", "Nearby Plants must expose an app-owned location consent bridge.");
expectIncludes(locationConsent, "Use your location to find nearby RMC plants?", "Nearby Plants foreground-location disclosure title is missing.");
expectIncludes(locationConsent, "This customer feature does not use background location.", "Nearby Plants disclosure must distinguish foreground-only use from Driver background tracking.");
expectIncludes(locationConsent, "You can choose Not now and still browse all registered plants", "Nearby Plants disclosure must explain the no-location fallback.");
expectIncludes(locationConsent, "Read the TrackMyRMC Privacy Policy", "Location disclosures must link to the Privacy Policy.");
const nearbyConsentIndex = customerPlants.indexOf("requestNearbyPlantsLocationConsent()");
const nearbyPromptIndex = customerPlants.indexOf("Location.requestForegroundPermissionsAsync()");
expect(
  nearbyConsentIndex >= 0 && nearbyPromptIndex > nearbyConsentIndex,
  "Nearby Plants must show TrackMyRMC disclosure before the OS foreground-location prompt.",
);

const frontendSourceFiles = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) frontendSourceFiles.push(full);
  }
}
walk(path.join(repoRoot, "frontend", "app"));
walk(path.join(repoRoot, "frontend", "src"));
const backgroundPermissionCallers = frontendSourceFiles.filter((file) =>
  fs.readFileSync(file, "utf8").includes("requestBackgroundPermissionsAsync("),
);
expect(
  backgroundPermissionCallers.length === 1 &&
    backgroundPermissionCallers[0].endsWith(path.join("src", "location", "tripTracking.ts")),
  "Background-location runtime permission must be requested only by tripTracking.ts.",
);

const pushClient = read("frontend/src/notifications/pushClient.ts");
const pushBridge = read("frontend/src/notifications/PushNotificationBridge.tsx");
const notificationsScreen = read("frontend/app/notifications.tsx");
expectIncludes(pushClient, "requestPermission = false", "Push registration must not request notification permission by default.");
expectIncludes(pushClient, 'if (permission.status !== "granted" && requestPermission)', "Android notification prompt must require explicit caller consent.");
expectIncludes(pushBridge, "Stay updated on your work", "App-owned notification disclosure is missing.");
expectIncludes(pushBridge, "Enable notifications", "Notification disclosure needs an affirmative action.");
expectIncludes(pushBridge, "Not now", "Notification disclosure needs a decline path.");
expectIncludes(notificationsScreen, "Enable device notifications", "Users must be able to opt into notifications later.");

const privacy = read("frontend/app/privacy.tsx");
const privacyAlias = read("frontend/app/privacy_policy.tsx");
const deletion = read("frontend/app/account-deletion.tsx");
const deletionAlias = read("frontend/app/account-deletion-public.tsx");
const terms = read("frontend/app/terms.tsx");
const kycReturn = read("frontend/app/kyc/return.tsx");
const loginScreen = read("frontend/src/screens/LoginScreen.tsx");
const routes = read("backend/src/routes/mod.rs");
expectIncludes(privacy, "even when the app is closed or not in use", "Privacy policy must disclose background location.");
expectIncludes(privacy, "support@goldetech.com", "Privacy policy must identify a support/privacy contact.");
expectIncludes(privacyAlias, 'export { default } from "./privacy"', "Canonical /privacy_policy frontend route is missing.");
expectIncludes(deletion, "request deletion without signing in", "Public deletion flow must remain available outside an authenticated session.");
expectIncludes(deletionAlias, 'export { default } from "./account-deletion"', "Legacy deletion route must resolve to the canonical frontend screen.");
expectIncludes(terms, "Terms & Conditions", "Frontend terms route is missing.");
expectIncludes(kycReturn, "KYC consent received", "Frontend KYC return page is missing.");
expect(!loginScreen.includes("/review-access"), "Do not advertise a reviewer-only login until its backend and isolated review fixtures are implemented.");
expect(!fs.existsSync(path.join(repoRoot, "frontend/app/review-access.tsx")), "Unsupported reviewer-only screen must remain removed.");
expectIncludes(routes, '"/api/auth/otp/whatsapp/send"', "Rust backend WhatsApp OTP route is missing.");
expectIncludes(routes, '"/api/auth/otp/email/send"', "Rust backend staff email OTP route is missing.");
expect(!routes.includes("passkey_register"), "Passkey handlers must not be advertised until cryptographic verification is complete.");

if (process.exitCode) process.exit(process.exitCode);
console.log("Play policy readiness checks passed for release version 2.0.31 (vc89), location/notification consent, and the implemented Rust API contract.");
