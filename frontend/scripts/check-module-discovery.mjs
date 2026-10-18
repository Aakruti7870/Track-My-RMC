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
const homeKeysBlock = customerHome.match(/const HOME_MODULE_KEYS = \[([\s\S]*?)\](?: as const)?;/);
assert.ok(homeKeysBlock, "Customer Home must declare an explicit eight-module shortlist.");
const homeKeys = [...homeKeysBlock[1].matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
assert.deepEqual(homeKeys, [
  "projects", "pour-planner", "receiving-guide", "cube-tests",
  "saved-sites", "customer-support", "compare-plants", "free-tools",
], "Customer Home must show eight shortcuts in the requested order.");
for (const key of homeKeys) {
  const module = modulesForRole("customer").find(entry => entry.key === key);
  assert.ok(module && module.symbol, `Customer Home must use a registered vector symbol for ${key}`);
}
assert.ok(customerHome.includes('const DIRECTORY = modulesForRole("customer");'));
assert.ok(customerHome.includes("const CUSTOMER_MODULES = HOME_MODULE_KEYS.flatMap(key => DIRECTORY.filter(module => module.key === key));"));
for (const name of ["home-quick-actions", "customer-module-grid", "home-other-services"]) {
  assert.ok(customerHome.includes(`testID="${name}"`), `Missing grouped Home card: ${name}`);
}
assert.ok(customerHome.includes('<HomeCarousel />'), "Preserve existing carousel component.");
assert.ok(customerHome.includes('<KycBanner status={data.kyc_status} />'), "Preserve KYC state machine.");
assert.ok(customerHome.includes('<ActiveTransitMixerCard'), "Preserve real order and demo tracking.");
assert.ok(customerHome.includes('width: "23.5%"'), "Quick Actions and RMC Tools must be a four-column responsive grid.");
assert.ok(customerHome.includes('width: "31.5%"'), "Other Services must be a three-column responsive grid.");
// Newly uploaded Other Services SVG masters must render on the actual home cards.
for (const [key, symbol] of [
  ["cement", "cement"],
  ["labour", "labour-contractor"],
  ["material", "building-material"],
]) {
  assert.ok(
    customerHome.includes(`{ key: "${key}", label: `) && customerHome.includes(`symbol: "${symbol}"`),
    `Missing Other Services SVG assignment for ${key}`,
  );
}
assert.ok(customerHome.includes('<VectorSymbol name={service.symbol} size={42} />'), "Other Services must render the uploaded artwork.");
assert.ok(!customerHome.includes('<Ionicons name={service.icon}'), "Do not regress to generic service icons.");
assert.ok(customerHome.includes('<VectorSymbol name={action.symbol} size={42} />'), "Quick Actions must render a visible assigned vector.");
assert.ok(customerHome.includes('<VectorSymbol name={module.symbol} size={42} />'), "Tools must render assigned vector artwork.");
assert.ok(!customerHome.includes('contentContainerStyle={styles.moduleGrid}'), "Remove old horizontal shortcut strip.");
const serviceForm = read("app/customer/service-enquiry.tsx");
for (const kind of ["CEMENT", "LABOUR_CONTRACTOR", "BUILDING_MATERIAL"]) {
  assert.ok(serviceForm.includes(`service_type: "${kind}"`), `Missing enquiry schema: ${kind}`);
}
assert.ok(serviceForm.includes('"/customer/service-enquiries"'), "Enquiry API integration missing.");

// The customer More page intentionally surfaces only these five routes, in order.
const customerMore = read("app/customer/more.tsx");
const moreKeysBlock = customerMore.match(/const CUSTOMER_MORE_KEYS = \[([\s\S]*?)\] as const;/);
assert.ok(moreKeysBlock, "Customer More must declare an explicit five-link shortlist.");
const moreKeys = [...moreKeysBlock[1].matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
assert.deepEqual(moreKeys, [
  "account-deletion", "customer-support", "notifications", "quotations", "documents",
], "Customer More must contain exactly the requested five links in order.");
const customerRoleModules = modulesForRole("customer");
for (const key of moreKeys) {
  assert.ok(customerRoleModules.some(module => module.key === key),
    "Customer More destination must exist and be customer-authorized: " + key);
}
assert.ok(customerMore.includes("CUSTOMER_MORE_KEYS.flatMap(key => customerModules.filter(module => module.key === key))"),
  "Customer More must render only its five approved catalog entries.");
assert.ok(customerMore.includes('testID="role-module-directory"'),
  "Customer More destination container must remain covered by role browser tests.");
assert.ok(!customerMore.includes("<RoleModuleDirectory") && !customerMore.includes("All Customer Modules"),
  "Customer More must not render the generic module directory heading, count, or groups.");

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
