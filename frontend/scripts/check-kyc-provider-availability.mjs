// Static release guard: a disabled KYC provider must never offer a DigiLocker
// start button that can only fail with HTTP 409. Keep the existing status intact.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kyc = fs.readFileSync(path.join("app", "kyc.tsx"), "utf8");
const login = fs.readFileSync(path.join("src", "screens", "LoginScreen.tsx"), "utf8");
assert(kyc.includes('data?.provider === "unavailable"'), "KYC screen must honor backend provider availability");
assert(kyc.includes('if (!token || providerUnavailable) return;'), "KYC initiation must not call a disabled provider");
assert(kyc.includes('testID="kyc-unavailable"'), "KYC unavailable state needs explicit feedback");
assert(kyc.includes('testID="kyc-refresh-availability"'), "KYC unavailable state needs a safe retry");
assert(kyc.includes('!providerUnavailable && status === "IN_PROGRESS"'), "KYC must not duplicate disabled-provider actions");
for (const file of ["TrackMyRMC_Login_Top_Banner_light.webp", "TrackMyRMC_Login_Top_Banner_Dark.webp"]) {
  assert(fs.existsSync(path.join("assets", "images", file)), `Missing login image: ${file}`);
  assert(login.includes(file), `Login screen does not use ${file}`);
}
assert(!login.includes("login-hero-light.jpg") && !login.includes("login-hero-dark.jpg"), "Deleted login JPG references remain");
console.log("KYC provider availability and current login asset guard passed.");
