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
const businessRoute = read("app/business/[kind].tsx");
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
    if (kind === "payroll") {
      assert.ok(businessRoute.includes('kind === "payroll"') && businessRoute.includes('pathname: "/workforce-reports"'),
        "The Payroll card must open the workforce payroll flow");
    } else {
      assert.ok(business.includes(`  ${kind}: `) || business.includes(`  ${kind}: {`),
        `Business module implementation absent: ${kind}`);
    }
  } else {
    // Expo Router supports JSX as well as TSX pages. Require a real page in either format.
    const candidates = [".tsx", ".jsx"].flatMap(ext => [
      path.join(root, `app${m.route}${ext}`),
      path.join(root, `app${m.route}/index${ext}`),
    ]);
    assert.ok(candidates.some(candidate => fs.existsSync(candidate)),
      `Missing Expo page for ${m.key}: ${m.route}`);
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
const homeLinks = read("src/navigation/customerHome.ts");
const plan = read("app/customer/plan.tsx");
const supply = read("app/customer/supply.tsx");
const layout = read("app/customer/_layout.tsx");
assert.deepEqual([...layout.matchAll(/label: "([^"]+)"/g)].map(match => match[1]),
  ["Home", "Orders", "Plan", "Supply", "Account"]);
assert.match(layout, /hideCenterAction/);
assert.match(customerHome, /homeShortcuts\.map/);
assert.match(homeLinks, /key: "new"[^\n]*route: "\/new-order"/);
assert.match(homeLinks, /planningLinks\(\["saved-sites", "free-tools"\]\)/);
assert.match(homeLinks, /label: "Concrete Pump"/);
assert.match(homeLinks, /label: "Pour Planner"/);
assert.match(customerHome, /router\.push\(enquiryRoute\("bulk"\)\)/);
for (const key of ["projects", "saved-sites", "pour-planner", "free-tools", "compare-plants", "receiving-guide", "cube-tests"]) {
  assert.ok(plan.includes('"' + key + '"') && modulesForRole("customer").some(module => module.key === key && module.symbol),
    "Missing Plan route or vector: " + key);
}
assert.match(supply, /route: "\/customer\/plants"/);
assert.match(supply, /materialPreview, \.\.\.moreMaterials/);
const orders = read("app/customer/orders.tsx");
assert.match(orders, /router\.push\("\/customer\/quotations"\)/);
assert.match(orders, /router\.push\("\/customer\/documents"\)/);
const serviceForm = read("app/customer/service-enquiry.tsx");
for (const kind of ["CEMENT", "LABOUR_CONTRACTOR", "BUILDING_MATERIAL", "PUMP_RENTAL", "BULK_CONCRETE"]) {
  assert.ok(serviceForm.includes(`service_type: "${kind}"`), `Missing enquiry schema: ${kind}`);
}
assert.ok(serviceForm.includes('"/customer/service-enquiries"'), "Enquiry API integration missing.");

// Account keeps identity and settings separate from order records.
const customerMore = read("app/customer/more.tsx");
const moreKeysBlock = customerMore.match(/const CUSTOMER_MORE_KEYS = \[([\s\S]*?)\] as const;/);
assert.ok(moreKeysBlock, "Customer More must declare an explicit settings shortlist.");
const moreKeys = [...moreKeysBlock[1].matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
assert.deepEqual(moreKeys, [
  "customer-support", "account-deletion",
], "Account must keep support and deletion links.");
const customerRoleModules = modulesForRole("customer");
for (const key of moreKeys) {
  assert.ok(customerRoleModules.some(module => module.key === key),
    "Customer More destination must exist and be customer-authorized: " + key);
}
assert.ok(customerMore.includes("CUSTOMER_MORE_KEYS.flatMap(key => customerModules.filter(module => module.key === key))"),
  "Account must render its selected role-authorized catalog entries.");
assert.ok(customerMore.includes('testID="role-module-directory"'),
  "Customer More destination container must remain covered by role browser tests.");
assert.ok(!customerMore.includes("<RoleModuleDirectory") && !customerMore.includes("All Customer Modules"),
  "Customer More must not render the generic module directory heading, count, or groups.");

const connected = [
  "app/customer/index.tsx", "app/customer/more.tsx",
  "app/owner/index.tsx", "app/owner/more.tsx",
  "app/driver/more.tsx",
];
for (const file of connected) {
  const source = read(file);
  assert.ok(source.includes("moduleCatalog") || source.includes("navigation/customerHome") || source.includes("<RoleModuleDirectory"),
    `Shared module catalog not connected: ${file}`);
}
assert.ok(read("app/driver/index.tsx").includes("<OperationalHomeTopBar") &&
  !read("app/driver/index.tsx").includes("<RoleModuleDirectory") &&
  read("app/driver/more.tsx").includes('<RoleModuleDirectory role={user?.role}'),
  "Driver Home removes duplicate module tiles; More retains the role-aware directory.");
for (const file of ["app/role-modules.tsx", "src/screens/StaffMore.tsx"]) {
  assert.ok(read(file).includes("<StaffModuleDirectory"),
    `Staff module catalog not connected through staff-only directory: ${file}`);
}
const staffDirectory = read("src/screens/StaffModuleDirectory.tsx");
assert.ok(staffDirectory.includes('modulesForRole(role)') &&
  staffDirectory.includes('"/staff/module-permissions"') &&
  staffDirectory.includes('testID={"role-module-" + module.key}') &&
  staffDirectory.includes('testID="role-module-directory"'),
  "Staff modules must use catalog, server-effective permissions and stable UI IDs.");
assert.ok(read("src/components/RoleModuleDirectory.tsx").includes('testID={`role-module-${module.key}`}'),
  "Existing Driver module cards must retain their stable UI test identifiers.");
console.log(`PASS: ${MODULE_CATALOG.length} unique module routes; Home/More discovery connected; privileged mobile roles excluded`);
