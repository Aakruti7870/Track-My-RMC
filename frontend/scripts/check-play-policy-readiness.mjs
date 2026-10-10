#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const fail = (message) => {
  console.error(`PLAY POLICY GATE FAILED: ${message}`);
  process.exitCode = 1;
};
const expect = (condition, message) => { if (!condition) fail(message); };
const expectIncludes = (content, needle, message) => expect(content.includes(needle), message);

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
]) expect(blocked.has(permission), `${permission} must remain blocked.`);
for (const permission of ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]) {
  expect(!permissions.has(permission) && !permissions.has(`android.permission.${permission}`), `${permission} must not be requested.`);
}
expect(permissions.has("ACCESS_BACKGROUND_LOCATION"), "Background location must remain limited to active Driver delivery tracking.");

const tripTracking = read("frontend/src/location/tripTracking.ts");
const tripScreen = read("frontend/app/trip/[id].tsx");
const locationConsent = read("frontend/src/location/BackgroundLocationConsent.tsx");
const customerPlants = read("frontend/app/customer/plants.tsx");
const driverHome = read("frontend/app/driver/index.tsx");
expectIncludes(tripTracking, "options: { allowBackground?: boolean }", "Background permission must have an explicit caller option.");
expectIncludes(tripTracking, "options.allowBackground === true", "Background permission must be gated by app-owned consent.");
expectIncludes(tripScreen, "This app collects location data to enable live mixer delivery tracking even when the app is closed or not in use.", "Background-location disclosure is missing.");
expectIncludes(tripScreen, "Agree & Continue", "Background-location disclosure needs affirmative consent.");
expectIncludes(tripScreen, "Not now", "Background-location disclosure needs a decline path.");
expectIncludes(locationConsent, "requestNearbyPlantsLocationConsent", "Nearby Plants consent bridge is missing.");
expectIncludes(locationConsent, "This customer feature does not use background location.", "Foreground/background location purposes must be distinguished.");
expectIncludes(customerPlants, "requestNearbyPlantsLocationConsent()", "Nearby Plants must request app-owned consent first.");
expectIncludes(customerPlants, "TrackMyRMC Play Review Plant", "The review plant must be visibly identifiable.");
expectIncludes(customerPlants, "Location is optional; choose Not now", "Nearby Plants must remain usable without location.");
expectIncludes(driverHome, "PLAY-REVIEW-001", "Driver review path must identify the review trip.");

const frontendSourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) frontendSourceFiles.push(full);
  }
}
walk(path.join(repoRoot, "frontend", "app"));
walk(path.join(repoRoot, "frontend", "src"));
const bgPermissionCallers = frontendSourceFiles.filter((file) =>
  fs.readFileSync(file, "utf8").includes("requestBackgroundPermissionsAsync(")
);
expect(
  bgPermissionCallers.length === 1 && bgPermissionCallers[0].endsWith(path.join("src", "location", "tripTracking.ts")),
  "Background-location runtime permission must be requested only by tripTracking.ts."
);

const pushClient = read("frontend/src/notifications/pushClient.ts");
const pushBridge = read("frontend/src/notifications/PushNotificationBridge.tsx");
const notificationsScreen = read("frontend/app/notifications.tsx");
expectIncludes(pushClient, "requestPermission = false", "Push registration must not request notification permission by default.");
expectIncludes(pushClient, 'if (permission.status !== "granted" && requestPermission)', "Notification prompt must require explicit caller consent.");
expectIncludes(pushBridge, "Enable notifications", "Notification disclosure needs an affirmative action.");
expectIncludes(pushBridge, "Not now", "Notification disclosure needs a decline path.");
expectIncludes(notificationsScreen, "Enable device notifications", "Users must be able to opt into notifications later.");

const reviewScreen = read("frontend/app/review-access.tsx");
const apiClient = read("frontend/src/api/client.ts");
const rustRoutes = read("backend/src/routes/mod.rs");
const rustConfig = read("backend/src/config.rs");
const servicePath = path.join(repoRoot, "backend/src/services/play_review.rs");
const migrationsPath = path.join(repoRoot, "backend/migrations");
const migrationFiles = fs.readdirSync(migrationsPath).filter((name) => name.endsWith(".sql"));
expectIncludes(reviewScreen, "6-digit reviewer OTP", "Reviewer access must clearly request the Google Play reviewer credential.");
expectIncludes(apiClient, '"/auth/play-review"', "Review UI must use the dedicated reviewer API client.");
expectIncludes(rustRoutes, '"/api/auth/play-review"', "Rust backend must implement the isolated Play reviewer login endpoint.");
expectIncludes(rustConfig, "PLAY_REVIEW_ACCESS_CODE", "Reviewer access code must be configured server-side.");
expect(fs.existsSync(servicePath), "Rust backend must provide a dedicated isolated Play review service.");
expect(
  migrationFiles.some((name) => read(path.join("backend/migrations", name)).includes("play_review_fixture")),
  "A migration must create isolated Play review fixtures and demo data.",
);
expectIncludes(rustRoutes, '"/api/account-deletion/public-request"', "Rust backend must implement the public account-deletion request endpoint.");
expectIncludes(rustRoutes, '"/.well-known/assetlinks.json"', "Android asset-links endpoint must be implemented by the Rust API.");
expect(!reviewScreen.includes('role: "authority"'), "Authority must not be exposed through mobile reviewer access.");

if (process.exitCode) process.exit(process.exitCode);
console.log("Google Play policy readiness assertions passed for TrackMyRMC v2.0.31 / vc89.");
