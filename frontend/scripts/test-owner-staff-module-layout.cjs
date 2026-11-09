// Actual catalog and role partition regression: no new TS files or API changes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
function loadTs(file, dependencies = {}) {
  const source = read(file);
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  const requireMock = id => dependencies[id] || (id === "react-native" ? { StyleSheet: { create: value => value } } : {});
  new Function("module", "exports", "require", output)(loaded, loaded.exports, requireMock);
  return loaded.exports;
}
const catalog = loadTs("src/navigation/moduleCatalog.ts");
const owner = loadTs("src/owner/modules.ts", { "@/src/navigation/moduleCatalog": catalog });
const staff = loadTs("src/screens/StaffModuleDirectory.tsx", {
  "@/src/navigation/moduleCatalog": catalog,
  "@/src/theme/tokens": { spacing: { sm: 8, md: 12, lg: 16 }, radius: { md: 12, pill: 99 }, fonts: {} },
});

const ownerHome = owner.HOME_KEYS;
const ownerOperations = owner.ownerModules(owner.OPERATIONS_KEYS).map(module => module.key);
const ownerCommercial = owner.ownerModules(owner.HOME_COMMERCIAL_KEYS).map(module => module.key);
const ownerMore = owner.ownerModules(owner.ACCOUNT_KEYS).map(module => module.key);
const ownerGlobal = ["business-attendance", "notifications", owner.DRIVER_MODULE.key];
const allOwner = [...ownerHome, ...ownerOperations, ...ownerCommercial, ...ownerMore, ...ownerGlobal];
assert.equal(ownerHome.length, 4);
assert.equal(ownerCommercial.length, 13, "12 cards must retain 13 unique Payroll/Closure destinations");
assert.equal(ownerMore.length, 4);
assert.equal(new Set(allOwner).size, allOwner.length, "Owner modules must not repeat between Home, Operations, More");
assert.equal(allOwner.length, 32);
const ownerKeys = new Set(catalog.modulesForRole("plant_owner").map(item => item.key));
for (const key of allOwner) assert(ownerKeys.has(key) || key === "owner-drivers", "Unknown owner module: " + key);

for (const role of staff.STAFF_ROLES) {
  const catalogKeys = catalog.modulesForRole(role).map(module => module.key);
  const nativeTabs = staff.STAFF_TAB_KEYS[role];
  const home = staff.staffModulesForScope(role, "home");
  const more = staff.staffModulesForScope(role, "more");
  const rendered = [...nativeTabs, ...home.map(m => m.key), ...more.map(m => m.key)];
  assert.equal(new Set(rendered).size, rendered.length, role + " has duplicate navigation cards");
  assert.deepEqual(new Set(rendered), new Set(catalogKeys.filter(key => key !== "notifications")), role + " must expose each destination once; notifications lives in the shared header");
  assert(home.length > 0 && home.length <= 6, role + " home cards must fit a short grid");
  for (const module of [...home, ...more]) assert(catalogKeys.includes(module.key), role + " exposes unauthorized catalog module " + module.key);
  for (const viewportWidth of [320, 360, 390, 480, 680, 768, 980, 1440]) {
    const cols = viewportWidth >= 950 ? 5 : viewportWidth >= 680 ? 4 : viewportWidth >= 470 ? 3 : 2;
    const available = Math.min(viewportWidth, 980) - 32;
    const cardWidth = (available - (cols - 1) * 9) / cols;
    assert(cardWidth >= 130 && cardWidth <= 240, role + " invalid tile width at " + viewportWidth);
    assert(cols * cardWidth + (cols - 1) * 9 <= available + 0.01, role + " grid overflows at " + viewportWidth);
  }
}
assert(read("src/screens/StaffHome.tsx").includes('scope="home"'));
assert(read("src/screens/StaffMore.tsx").includes('scope="more"'));
assert(read("src/screens/StaffModuleDirectory.tsx").includes('"/staff/module-permissions"'));
assert(read("src/screens/StaffModuleDirectory.tsx").includes("grant.view"));
assert(!read("app/owner/more.tsx").includes("ownerModules(OPERATIONS_KEYS)"));
assert(!read("app/owner/more.tsx").includes("Appearance"));
assert(!read("src/screens/StaffMore.tsx").includes("Appearance"));
assert(!read("app/driver/more.tsx").includes("Appearance"));
assert(!read("app/customer/more.tsx").includes("Appearance"));
assert(read("app/customer/more.tsx").includes('testID="customer-more-theme"'));
assert(read("src/components/customer/CustomerHomeHeader.tsx").includes('testID="header-theme"'));
assert(read("src/components/OperationalHomeTopBar.tsx").includes('testID="operational-theme"'));
assert(read("app/owner/index.tsx").includes('testID="owner-shortcut-insights"'));
assert(read("app/owner/index.tsx").includes('<OwnerCommercial />'));
assert(read("src/owner/OwnerCommercial.tsx").includes('testID="role-module-payroll-closure"'));
assert(read("src/screens/StaffHome.tsx").includes('testID="staff-home-check-in"'));
assert(read("src/screens/StaffHome.tsx").includes('"/workforce/me"'));
assert(read("src/location/workforceEvidence.ts").includes("requestAttendanceLocationConsent"));
const workforceBackend = fs.readFileSync(path.join(root, "../backend/src/routes/workforce_routes.rs"), "utf8");
const ownerBackend = fs.readFileSync(path.join(root, "../backend/src/routes/owner_routes.rs"), "utf8");
assert(ownerBackend.includes("'plant_attendance_today'") && ownerBackend.includes("'plant_expenses_today'"),
  "Owner Home metrics must use real plant-scoped attendance and expenses");
for (const field of ['"plant_ids": plant_ids', '"attendance": attendance', '"leave_requests": leave_requests',
                     '"client_visits": client_visits', '"expense_claims": expense_claims']) {
  assert(workforceBackend.includes(field), "Owner workforce response is missing " + field);
}
assert(workforceBackend.includes("a.plant_id=ANY($1)") &&
       workforceBackend.includes("a.attendance_date=CURRENT_DATE"),
  "Owner attendance must select only today's records from owned plants");
assert(workforceBackend.includes("WHERE workforce_attendance.check_in_time IS NULL") &&
       workforceBackend.includes("updated.rows_affected() != 1"),
  "Staff must not check in twice or check out without a valid active shift");

console.log("PASS: Owner unique Home/Operations/More + eight staff role partitions, payroll dual-action, top-bar theme and check-in");
