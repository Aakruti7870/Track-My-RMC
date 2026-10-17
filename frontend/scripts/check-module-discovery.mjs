import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const catalog = read("src/navigation/moduleCatalog.ts");
// Transpile only the pure role catalog; type-only Expo imports are erased.
const compiled = ts.transpileModule(catalog, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { MOBILE_ROLES, MODULE_CATALOG, modulesForRole, customerHomeModules } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const requiredRoles = [
  "customer", "plant_owner", "driver", "admin", "dispatcher", "operator",
  "supervisor", "accountant", "quality_engineer", "fleet_manager", "store_manager",
];
assert.deepEqual([...MOBILE_ROLES], requiredRoles);
assert.ok(MODULE_CATALOG.length >= 50, "The directory must cover the existing module surface.");
assert.equal(modulesForRole("authority").length, 0, "Authority requires a separate approved workspace.");
assert.equal(modulesForRole("central_admin").length, 0, "Central Admin must remain in the secured web portal.");
assert.equal(modulesForRole("super_admin").length, 0);
assert.deepEqual(modulesForRole("owner").map(m => m.key), modulesForRole("plant_owner").map(m => m.key));

const keys = new Set();
const validGroups = new Set(["Operations", "Commercial", "Workforce", "Tools", "Account"]);
const business = read("src/screens/BusinessModule.tsx");
for (const m of MODULE_CATALOG) {
  assert.ok(!keys.has(m.key), `Duplicate module key: ${m.key}`);
  keys.add(m.key);
  assert.ok(m.label && m.description && m.icon, `Missing module metadata: ${m.key}`);
  assert.ok(validGroups.has(m.group), `Invalid group for ${m.key}`);
  assert.ok(Array.isArray(m.roles) && m.roles.length, `Missing authorized role mapping for ${m.key}`);
  for (const role of m.roles) {
    assert.ok(requiredRoles.includes(role), `Unexpected mobile role ${role} on ${m.key}`);
  }
  assert.ok(typeof m.route === "string" && m.route.startsWith("/") && !m.route.includes("?"), `Invalid route for ${m.key}`);
  if (m.route.startsWith("/business/")) {
    assert.ok(fs.existsSync(path.join(root, "app/business/[kind].tsx")), "Generic business route missing");
    const kind = m.route.slice("/business/".length);
    assert.ok(business.includes(`  ${kind}: `) || business.includes(`  ${kind}: {`),
      `Business module implementation absent: ${kind}`);
  } else {
    const p = path.join(root, `app${m.route}.tsx`);
    const index = path.join(root, `app${m.route}/index.tsx`);
    assert.ok(fs.existsSync(p) || fs.existsSync(index), `Missing Expo page for ${m.key}: ${m.route}`);
  }
}

const mustInclude = {
  customer: ["new-order", "orders", "plants", "projects", "pour-planner", "receiving-guide", "cube-tests", "saved-sites", "compare-plants", "quotations", "documents", "free-tools"],
  plant_owner: ["owner-orders", "owner-production-dispatch", "owner-billing", "owner-quotation-requests", "business-profile", "business-rates", "business-mixes", "business-inventory", "business-suppliers", "business-purchases", "business-fleet", "business-diesel", "business-staff", "business-attendance", "workforce", "payroll-closure"],
  driver: ["driver-trips", "driver-attendance", "driver-sos", "workforce", "shift-roster", "my-payslip"],
  admin: ["admin-orders", "admin-fleet", "admin-onboarding", "business-rates", "business-inventory", "business-staff"],
  dispatcher: ["dispatcher-queue", "dispatcher-fleet", "workforce", "shift-roster"],
  operator: ["operator-production", "workforce", "shift-roster"],
  supervisor: ["supervisor-operations", "supervisor-incidents", "workforce", "shift-roster"],
  accountant: ["accountant-billing", "accountant-ledger", "business-payroll", "employee-master", "payroll-closure"],
  quality_engineer: ["engineer-quality", "business-mixes", "workforce"],
  fleet_manager: ["fleet-manager-fleet", "fleet-manager-drivers", "business-diesel"],
  store_manager: ["store-manager-stock", "business-inventory", "business-suppliers", "business-purchases"],
};
for (const role of requiredRoles) {
  const entries = modulesForRole(role);
  const ids = new Set(entries.map(m => m.key));
  assert.equal(ids.size, entries.length, `Duplicate link for ${role}`);
  for (const key of mustInclude[role]) assert.ok(ids.has(key), `Module ${key} not visible for ${role}`);
  assert.ok(entries.length >= mustInclude[role].length, `Empty role directory for ${role}`);
  console.log(`PASS: ${role} -> ${entries.length} declared, existing Expo routes`);
}
assert.equal(customerHomeModules().length, 8, "All eight customer Home-eligible modules remain available in the full directory.");

const customerHome = read("app/customer/index.tsx");
const homeKeysBlock = customerHome.match(/const HOME_MODULE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(homeKeysBlock, "Customer Home must declare an explicit six-module shortlist.");
const homeKeys = [...homeKeysBlock[1].matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
assert.deepEqual(homeKeys, [
  "projects", "pour-planner", "receiving-guide", "cube-tests", "compare-plants", "free-tools",
], "Only the six requested customer modules must appear on Home.");
assert.ok(customerHome.includes("customerHomeModules().filter(module => HOME_MODULE_KEYS.has(module.key))"));
assert.equal(customerHome.split("contentContainerStyle={styles.moduleGrid}>").length - 1, 2,
  "Normal and error-state Home modules must be in a single horizontally scrollable row.");
assert.ok(customerHome.includes("name={ACTION_SYMBOLS[action.key]} size={44}"),
  "Quick Actions must use 44 px vector symbols.");
assert.equal(customerHome.split("name={module.symbol} size={34}").length - 1, 2,
  "Home module vectors must retain the existing 34 px symbol size.");
assert.ok(!customerHome.includes(">Your Modules</AppText>"), "Remove the old Home section heading.");

const connected = [
  "app/customer/index.tsx", "app/customer/more.tsx",
  "app/owner/index.tsx", "app/owner/more.tsx",
  "app/driver/index.tsx", "app/driver/more.tsx",
  "src/screens/StaffHome.tsx", "src/screens/StaffMore.tsx",
];
for (const file of connected) {
  const source = read(file);
  assert.ok(source.includes("moduleCatalog") || source.includes("<RoleModuleDirectory"),
    `Shared module catalog not connected: ${file}`);
}
assert.ok(read("src/components/RoleModuleDirectory.tsx").includes('testID={`role-module-${module.key}`}'),
  "Each module needs a stable UI test identifier.");
console.log(`PASS: ${MODULE_CATALOG.length} unique module routes; Home/More discovery connected; privileged mobile roles excluded`);
