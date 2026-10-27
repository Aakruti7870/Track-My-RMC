const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const repo = path.resolve(__dirname,"..","..");
const read = name => fs.readFileSync(path.join(repo,name),"utf8");

test("owner onboarding selects only allowed periods; no early checkout",()=>{
  const f=read("frontend/app/plant-onboarding.tsx");
  const rust=read("backend/src/routes/plant_onboarding.rs");
  const sql=read("backend/migrations/0042_owner_plan_and_post_auth_consent.sql");
  assert.match(f,/\[1, 3, 6, 12\] as const/);
  assert.match(f,/preferred_plan_months: planMonths/);
  assert.match(f,/if \(!planMonths\) return setError/);
  assert.match(f,/No payment is due now/);
  assert.match(rust,/valid_plan_interest\(months\)/);
  assert.match(rust,/preferred_plan_months/);
  assert.match(sql,/CHECK \(preferred_plan_months IS NULL OR preferred_plan_months IN \(1, 3, 6, 12\)\)/);
  assert.doesNotMatch(f,/cashfreeCheckout|payment_session_id|create_payment_order/);
});

test("all signed-in roles and reviewers see consent after authenticated login",()=>{
  const f=read("frontend/src/permissions/PermissionProvider.tsx");
  const root=read("frontend/app/_layout.tsx");
  assert.match(f,/const account = token && user\?\.id \? user\.id : null/);
  assert.match(f,/const visible = !!account && loadedFor === account && \(needed \|\| reviewing\)/);
  assert.match(f,/const VERSION = 2/);
  assert.match(f,/camera_choice:camera/);
  assert.match(f,/We will ask again at the relevant feature/);
  assert.match(f,/camera at login/);
  assert.doesNotMatch(f,/requestCameraPermissionsAsync/);
  assert.doesNotMatch(f,/requestBackgroundPermissionsAsync/);
  assert.match(root,/<PermissionProvider>/);
});

test("camera, driver background and exit decisions remain explicit",()=>{
  const pod=read("frontend/app/pod/[id].tsx");
  const tracking=read("frontend/src/location/tripTracking.ts");
  const exit=read("frontend/src/navigation/RootBackHandler.tsx");
  assert.ok(pod.indexOf("Camera access for proof of delivery") < pod.indexOf("ImagePicker.requestCameraPermissionsAsync()"));
  assert.ok(tracking.indexOf("requestBackgroundLocationConsent()") < tracking.indexOf("Location.requestBackgroundPermissionsAsync()"));
  assert.match(exit,/Object\.values\(ROLE_ROUTES\)/);
  assert.match(exit,/BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(exit,/exit-confirm-stay/);
  assert.match(exit,/exit-confirm-exit/);
  assert.match(exit,/BackHandler\.exitApp\(\)/);
  assert.match(exit,/beforeunload/);
});
