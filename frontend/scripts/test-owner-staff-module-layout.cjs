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
const staff = loadTs("src/screens/StaffModuleDirectory.tsx", { "@/src/navigation/moduleCatalog": catalog });

const ownerHome = owner.HOME_KEYS;
const ownerOperations = owner.ownerModules(owner.OPERATIONS_KEYS).map(module => module.key);
const ownerMore = [
  ...owner.ownerModules(owner.WORKFORCE_KEYS).map(module => module.key),
  ...owner.ownerModules(owner.ACCOUNT_KEYS).map(module => module.key),
  ...owner.ownerModules(owner.COMMERCIAL_KEYS).map(module => module.key),
  owner.DRIVER_MODULE.key,
];
const allOwner = [...ownerHome, ...ownerOperations, ...ownerMore];
assert.equal(ownerHome.length, 6);
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
  assert.deepEqual(new Set(rendered), new Set(catalogKeys), role + " must expose all approved destinations exactly once");
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
console.log("PASS: Owner + eight staff role partitions, permission-gated catalog, 320–1440px compact grid geometry");
