import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const roleRoutes = read("src/auth/roleRoutes.ts");
// The login route (app/login.tsx) may host the implementation inline or be a
// thin re-export of the real screen (src/screens/LoginScreen.tsx). Resolve to
// the actual implementation source so the guard always inspects the live login
// UI regardless of where the code physically lives.
const readLoginSource = () => {
  const entry = read("app/login.tsx");
  const reexport = entry.match(/from ["']@\/(src\/[^"']+)["']/);
  if (reexport) {
    const rel = reexport[1].endsWith(".tsx") ? reexport[1] : `${reexport[1]}.tsx`;
    return `${entry}\n${read(rel)}`;
  }
  return entry;
};
const login = readLoginSource();
const onboarding = read("app/plant-onboarding.tsx");
const mfaSetup = read("app/mfa-setup.tsx");
const apiClient = read("src/api/client.ts");
const reviewAccess = read("app/review-access.tsx");
const index = read("app/index.tsx");

const expectedRoutes = {
  customer: "/customer",
  plant_owner: "/owner",
  owner: "/owner",
  driver: "/driver",
  admin: "/admin",
  dispatcher: "/dispatcher",
  operator: "/operator",
  supervisor: "/supervisor",
  accountant: "/accountant",
  quality_engineer: "/quality_engineer",
  fleet_manager: "/fleet_manager",
  store_manager: "/store_manager",
};

const failures = [];

for (const [role, route] of Object.entries(expectedRoutes)) {
  const expected = `${role}: \"${route}\"`;
  if (!roleRoutes.includes(expected)) {
    failures.push(`Missing role route: ${role} -> ${route}`);
  }
}

const ownerLayout = read("app/owner/_layout.tsx");
const roleHome = read("app/role-home.tsx");
const navBlueprint = read("src/constants/roles.ts");
if (!ownerLayout.includes('user.role !== "plant_owner" && user.role !== "owner"')) {
  failures.push("Owner workspace must recognize both canonical plant_owner and legacy owner role");
}
if (!roleHome.includes('owner: "/owner"')) {
  failures.push("Role-home fallback must route existing owner aliases to the owner workspace");
}
for (const role of ["customer", "driver", "plant_owner", "admin", "dispatcher", "operator", "supervisor", "accountant", "quality_engineer", "fleet_manager", "store_manager"]) {
  if (!navBlueprint.includes(`${role}: [`)) {
    failures.push(`Missing declared role tab inventory for ${role}`);
  }
}
for (const privilegedRole of ["central_admin", "authority"]) {
  if (navBlueprint.includes(`${privilegedRole}: [`)) {
    failures.push(`Privileged role ${privilegedRole} must not receive public mobile tabs`);
  }
}
// Machine-readable snapshot of all original role screens. This inventory is
// compared with the source repository using Git SHAs; GitHub CI only validates
// the target's checked-in local files (the source repository is private).
const inventoryPath = path.resolve(root, "../docs/reference-role-module-inventory.json");
if (!fs.existsSync(inventoryPath)) {
  failures.push("Missing source-to-target role module inventory");
} else {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const ids = new Set(inventory.roles.map((role) => role.id));
  for (const role of [
    "customer", "driver", "plant_owner", "admin", "dispatcher", "operator",
    "supervisor", "accountant", "quality_engineer", "fleet_manager",
    "store_manager", "authority", "central_admin"
  ]) {
    if (!ids.has(role)) failures.push(`Missing reference role from role inventory: ${role}`);
  }
  for (const role of inventory.roles) {
    const expectedPresent = role.screens.filter((screen) => screen.sourceToTarget !== "missing");
    if (role.targetScreenCount !== expectedPresent.length) {
      failures.push(`Invalid target screen count for role ${role.id}`);
    }
    for (const screen of expectedPresent) {
      const relativeToFrontend = screen.path.replace(/^frontend\//, "");
      if (!fs.existsSync(path.join(root, relativeToFrontend))) {
        failures.push(`Ported role screen absent: ${screen.path}`);
      }
    }
  }
  for (const restricted of ["authority", "central_admin"]) {
    const role = inventory.roles.find((candidate) => candidate.id === restricted);
    if (role?.targetRoute) failures.push(`Restricted ${restricted} unexpectedly has a mobile route`);
  }
  for (const screen of inventory.sharedScreens.filter((item) => item.sourceToTarget === "missing")) {
    if (!["frontend/app/passkey-ceremony.tsx", "frontend/app/passkey-setup.tsx"].includes(screen.path)) {
      failures.push(`Missing shared reference screen requires review: ${screen.path}`);
    }
  }
}

for (const forbiddenRole of ["authority", "central_admin", "super_admin"]) {
  if (roleRoutes.includes(`${forbiddenRole}:`)) {
    failures.push(`Privileged role must not have a public mobile route: ${forbiddenRole}`);
  }
}

const directRoleRouteCount = login.split("router.replace(roleRouteFor(me.role) as any)").length - 1;
if (directRoleRouteCount < 2) {
  failures.push("Successful login flows must route using the server-provided me.role");
}

if (!login.includes('testID="login-user-tab"') || !login.includes('testID="login-plant-tab"')) {
  failures.push("Login must expose separate User Login and Plant Staff Login tabs");
}

if (!login.includes('testID="login-mobile-input"')) {
  failures.push("User Login must keep the mobile OTP input");
}

if (!login.includes('testID="login-plant-email-input"') || !login.includes('testID="login-plant-send-otp"')) {
  failures.push("Plant Staff Login must start from the approved work email");
}

if (!login.includes('testID="login-review-access"') || !login.includes('router.push("/review-access" as any)')) {
  failures.push("Google Play reviewer access must be discoverable from the login landing screen");
}
// The Google Play reviewer entry is a compact standalone action AFTER the login
// shell and BEFORE the Terms & Privacy line, on both mobile and tablet widths.
const reviewerEntry = login.indexOf('testID="login-review-access"');
const reviewerAfterShell = login.indexOf('</View>\n\n        <Pressable\n          testID="login-review-access"');
const legalStart = login.indexOf('<View style={styles.legalArea}>');
if (reviewerEntry < 0 || reviewerAfterShell < 0 || reviewerEntry >= legalStart) {
  failures.push("Google Play reviewer entry must sit below the login card and above legal terms");
}
if ((login.match(/Google Play Reviewer Access/g) || []).length !== 2 ||
    login.includes("Dedicated Customer, Plant Owner and Driver review accounts")) {
  failures.push("Reviewer action must show only the Google Play Reviewer Access title, without the old subtitle");
}
if (!login.includes('reviewAccessStandalone: {') ||
    !login.includes('width: "92%"') ||
    !login.includes('maxWidth: 470') ||
    !login.includes('minHeight: 56')) {
  failures.push("Reviewer action must retain touch-friendly responsive width under the login card");
}

if (login.includes('EXPO_PUBLIC_ENABLE_PLAY_REVIEW === "true"') || reviewAccess.includes('EXPO_PUBLIC_ENABLE_PLAY_REVIEW === "true"') || reviewAccess.includes('<Redirect href="/login" />')) {
  failures.push("Implemented Google Play reviewer access must not be hidden behind a build-time feature flag");
}
if (!reviewAccess.includes("verifyPlayReview") || !apiClient.includes('"/auth/play-review"')) {
  failures.push("Google Play reviewer access must use the dedicated server-validated reviewer login flow");
}

if (apiClient.includes("/auth/staff/passkey/") || apiClient.includes("exchangeStaffPasskeyHandoff")) {
  failures.push("API client must not call WebAuthn endpoints until Rust verification is implemented");
}

if (login.includes('testID="login-plant-passkey"') || login.includes("startStaffPasskeyAuthentication") || login.includes("completeStaffPasskey")) {
  failures.push("Staff login must not expose passkeys until backend WebAuthn verification endpoints are implemented");
}

if (!mfaSetup.includes("I Saved Them — Continue") || mfaSetup.includes("passkey-setup")) {
  failures.push("MFA setup must complete without navigating to unsupported passkey enrollment");
}

if (fs.existsSync(path.join(root, "app/passkey-setup.tsx")) || fs.existsSync(path.join(root, "app/passkey-ceremony.tsx"))) {
  failures.push("Unsupported passkey routes must not be exposed by Expo Router");
}

if (!login.includes('"login-plant-authenticator-input"') || !login.includes('testID="login-use-recovery"')) {
  failures.push("Plant Staff Login must expose Authenticator verification and recovery fallback");
}

if (!mfaSetup.includes('testID="mfa-setup-code"') || !mfaSetup.includes('testID="mfa-setup-confirm"')) {
  failures.push("First-time Plant Staff login must include Authenticator enrollment confirmation");
}

if (!login.includes('testID="login-get-onboard"') || !onboarding.includes('testID="onboarding-submit"')) {
  failures.push("Unknown Plant Staff email must have a working onboarding route");
}

if (login.includes('testID="login-google-button"') || login.includes("Continue with Google") || login.includes("startGoogleStaffLogin")) {
  failures.push("Direct Google/Gmail login must not be exposed on Plant Staff Login");
}

if (!login.includes('const fullNumber = loginPhone(mobile)')) {
  failures.push("User Login must use the validated mobile identifier before OTP request");
}
const phoneModule=ts.transpileModule(read("src/auth/phone.ts"),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {loginPhone}=await import(`data:text/javascript;base64,${Buffer.from(phoneModule).toString("base64")}`);
const phoneCases=[["1234567890","+911234567890"],["+12025550101","+12025550101"],["+12025550102","+12025550102"],["123",null],["+01234567890",null],["+1234567890123456",null],["not-a-phone",null]];
phoneCases.forEach(([input,expected],index)=>{if(loginPhone(input)!==expected)failures.push(`Mobile normalization contract failed in case ${index+1}`);});

if (login.includes("Dev mode — OTP auto-filled") || login.includes("One login for everyone")) {
  failures.push("Login must not expose development or legacy instruction text");
}

if (login.includes('router.replace("/")')) {
  failures.push("Login must not route successful authentication through /");
}

if (!login.includes("if (!hydrating && token && user)")) {
  failures.push("Login must redirect an already authenticated session");
}

if (!index.includes("roleRouteFor(user.role)") || !index.includes('href="/mfa-setup"')) {
  failures.push("Cold-start routing must enforce MFA setup before role routing for eligible staff");
}

if (!onboarding.includes("Use Current Location") || !onboarding.includes("/plant-onboarding/places")) {
  failures.push("Plant onboarding must support current GPS and server-side location search");
}

if (failures.length) {
  console.error("Auth routing regression check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Auth routing regression check passed for all operational roles, mobile OTP, implemented Plant Staff Authenticator MFA, recovery and onboarding.");
