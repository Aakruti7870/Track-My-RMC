import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd(), "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const requireInvariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = JSON.parse(read("frontend/app.json")).expo;
const releaseWorkflow = read(".github/workflows/android-build.yml");
const deployWorkflow = read(".github/workflows/deploy-aws-production.yml");
const indexRoute = read("frontend/app/index.tsx");
const privacyRoute = read("frontend/app/privacy_policy.tsx");
const privacyScreen = read("frontend/app/privacy.tsx");
const permissionGate = read("frontend/scripts/check-android-permissions.mjs");

requireInvariant(app.version === "1.1.2", "Expected Expo version 1.1.2");
requireInvariant(app.android?.versionCode === 93, "Expected Android versionCode 93");
requireInvariant(app.android?.package === "com.trackmyrmc.concreteking", "Unexpected Android application id");
requireInvariant(indexRoute.includes('<Redirect href="/login"'), "Root route must start at /login");
requireInvariant(releaseWorkflow.includes("EXPO_PUBLIC_BACKEND_URL: https://trackmyrmc.com"), "Signed AAB must be pinned to https://trackmyrmc.com");
requireInvariant(releaseWorkflow.includes('VERSION_CODE: "93"') && releaseWorkflow.includes('VERSION_NAME: "1.1.2"'), "Signed AAB workflow must validate vc93 / v1.1.2");
requireInvariant(releaseWorkflow.includes('EXPECTED_PLAY_UPLOAD_SHA1: "3D:5F:80:59:1C:BA:69:1B:03:28:4D:A1:74:91:38:1D:8F:A1:32:DC"'), "Signed AAB workflow must verify the registered upload certificate SHA-1");
requireInvariant(releaseWorkflow.includes("trackmyrmc-v1.1.2-vc93-signed-aab"), "Signed AAB artifact must use the new versioned name");
requireInvariant(releaseWorkflow.includes("check:android-permissions"), "Signed AAB workflow must run the Android privacy/permission gate");
requireInvariant(deployWorkflow.includes("trackmyrmc.com"), "Production deployment must target the TrackMyRMC domain");
requireInvariant(privacyRoute.includes('from "./privacy"'), "Public /privacy_policy route must render the privacy policy");
requireInvariant(privacyScreen.includes("Location and live delivery tracking") && privacyScreen.includes("Notifications"), "Privacy policy must disclose location and notification handling");
requireInvariant(permissionGate.includes("ACCESS_BACKGROUND_LOCATION") && permissionGate.includes("Camera access for proof of delivery"), "Android permission gate must cover background location and camera disclosures");

console.log("Fresh production release invariants: PASS (TrackMyRMC 1.1.2 / vc93)");
