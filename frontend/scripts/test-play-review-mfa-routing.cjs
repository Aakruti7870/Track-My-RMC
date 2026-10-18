const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const repo = path.resolve(root, "..");
const get = file => fs.readFileSync(path.join(repo, file), "utf8");

test("review fixtures are excluded from staff MFA enrollment routing at /me", () => {
  const handler = get("backend/src/routes/auth_routes.rs");
  assert.match(handler, /play_review::is_review_fixture/);
  assert.match(handler, /"mfa_configured":!review_fixture/);
  assert.match(handler, /"mfa_enabled":mfa_enabled/);
});

test("MFA setup does not pass a logged-in JWT as the first-factor challenge", () => {
  const screen = get("frontend/app/mfa-setup.tsx");
  assert.ok(screen.includes("user.mfa_configured === false"));
  assert.ok(screen.includes("startStaffMfaEnrollment()"));
  assert.ok(screen.includes("confirmStaffMfaEnrollment(code)"));
  assert.ok(!screen.includes("startStaffMfaEnrollment(token)"));
  assert.ok(!screen.includes("confirmStaffMfaEnrollment(token, code)"));
});

test("dedicated reviewer code and ordinary staff MFA remain separate", () => {
  const review = get("backend/src/services/play_review.rs");
  const auth = get("backend/src/services/auth_service.rs");
  assert.match(review, /play_review_access_code/);
  assert.match(auth, /Play review accounts must use the dedicated reviewer access flow/);
});
