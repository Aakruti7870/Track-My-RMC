import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const passkeySetup = read("app/passkey-setup.tsx");
const passkeyCeremony = read("app/passkey-ceremony.tsx");
const webauthnClient = read("src/auth/webauthn.ts");
const index = read("app/index.tsx");

const expectedRoutes = {
  customer: "/customer",
  plant_owner: "/owner",
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

if (!login.includes('testID="login-plant-passkey"') || !login.includes('testID="login-use-authenticator"')) {
  failures.push("Plant Staff Login must prefer passkey verification and keep Authenticator fallback");
}

if (!login.includes("startStaffPasskeyAuthentication") || !login.includes("completeStaffPasskey")) {
  failures.push("Plant Staff passkey login must use the one-time WebAuthn handoff flow");
}

if (!login.includes('"login-plant-authenticator-input"') || !login.includes('testID="login-use-recovery"')) {
  failures.push("Plant Staff Login must expose Authenticator verification and recovery fallback");
}

if (!mfaSetup.includes('testID="mfa-setup-code"') || !mfaSetup.includes('testID="mfa-setup-confirm"')) {
  failures.push("First-time Plant Staff login must include Authenticator enrollment confirmation");
}

if (!mfaSetup.includes("Add Passkey") || !passkeySetup.includes('testID="passkey-setup-totp"') || !passkeySetup.includes('testID="passkey-setup-create"')) {
  failures.push("Passkey enrollment must follow Authenticator setup and require fresh TOTP confirmation");
}

if (!passkeyCeremony.includes("getBrowserPasskey") || !passkeyCeremony.includes("createBrowserPasskey") || !passkeyCeremony.includes("trackmyrmc://auth/passkey")) {
  failures.push("Canonical browser WebAuthn ceremony and secure app return must remain wired");
}

if (!webauthnClient.includes("navigator.credentials") || !webauthnClient.includes("PublicKeyCredential")) {
  failures.push("Passkey client must use the browser WebAuthn credential API");
}

if (webauthnClient.includes("react-native-passkey") || webauthnClient.includes("@simplewebauthn/browser")) {
  failures.push("Passkey client must not silently add an unreviewed frontend credential dependency");
}

if (!login.includes('testID="login-get-onboard"') || !onboarding.includes('testID="onboarding-submit"')) {
  failures.push("Unknown Plant Staff email must have a working onboarding route");
}

if (login.includes('testID="login-google-button"') || login.includes("Continue with Google") || login.includes("startGoogleStaffLogin")) {
  failures.push("Direct Google/Gmail login must not be exposed on Plant Staff Login");
}

if (!login.includes('const fullNumber = `+91${mobile}`')) {
  failures.push("User Login must normalize the fixed India prefix before OTP request");
}

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

console.log("Auth routing regression check passed for all operational roles, mobile OTP, Plant Staff Passkey + Authenticator MFA, recovery and onboarding.");
