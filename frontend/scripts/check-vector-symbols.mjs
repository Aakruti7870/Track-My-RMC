import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFileSync(path.join(root, relative), "utf8");
const assets = "assets/images/SVG Vector Symbol";
const masters = readdirSync(path.join(root, assets)).filter(name => name.endsWith(".svg")).sort();
const serviceNames = ["building-material", "cement", "labour-contractor"];
assert.equal(masters.length, 92, "Expected 88 original, 3 service and 1 driver SVG masters");

const embedded = new Map();
for (let i = 0; i < 8; i++) {
  const content = read(`src/components/vector-symbols/set${i}.ts`);
  const entries = [...content.matchAll(/^\s+"([^"]+)": ("(?:[^"\\]|\\.)*"),?$/gm)];
  assert.equal(entries.length, 11, `Expected 11 vector symbols in set${i}`);
  for (const [, name, serialized] of entries) {
    assert.ok(!embedded.has(name), `Duplicate vector symbol: ${name}`);
    embedded.set(name, JSON.parse(serialized));
  }
}
assert.equal(embedded.size, 88, "Preserve all 88 original registered vectors");
const newSet = read("src/components/vector-symbols/set8.ts");
const newEntries = [...newSet.matchAll(/^\s+"([^"]+)": ("(?:[^"\\]|\\.)*"),?$/gm)];
assert.equal(newEntries.length, 3, "The new service set must have three vectors");
assert.deepEqual(newEntries.map(([, name]) => name).sort(), serviceNames);
for (const [, name, serialized] of newEntries) {
  assert.ok(!embedded.has(name), `Duplicate SVG symbol: ${name}`);
  embedded.set(name, JSON.parse(serialized));
}
const driverEntries = [...read("src/components/vector-symbols/set9.ts").matchAll(/^\s+"([^"]+)": ("(?:[^"\\]|\\.)*"),?$/gm)];
assert.equal(driverEntries.length, 1, "Exactly one new driver symbol");
assert.equal(driverEntries[0][1], "drop-offs");
embedded.set(driverEntries[0][1], JSON.parse(driverEntries[0][2]));
assert.equal(embedded.size, masters.length, "Every SVG master must be embedded");
for (const filename of masters) {
  const name = filename.slice(0, -4);
  const original = read(`${assets}/${filename}`).trim();
  assert.ok(embedded.has(name), `SVG not registered: ${filename}`);
  assert.equal(embedded.get(name), original, `Out-of-date embedded SVG: ${name}`);
  assert.match(original, /^<svg\b/);
  assert.match(original, /<\/svg>$/);
  assert.match(original, /\bviewBox=/);
  assert.doesNotMatch(original, /<script\b|<foreignObject\b|\bonload\s*=/i);
}

const catalog = read("src/navigation/moduleCatalog.ts");
const compiled = ts.transpileModule(catalog, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { MODULE_CATALOG } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
assert.equal(MODULE_CATALOG.length, 62, "Global RFQ administration is web-only; legitimate plant modules remain");
assert.ok(!MODULE_CATALOG.some(m => m.key === "admin-rmc-rfq-leads" || m.route === "/admin/rmc-rfq-leads"), "Global customer leads must not be advertised to plant admins");
assert.doesNotMatch(read("app/admin/rmc-rfq-leads.tsx"), /useGet|apiPatch|apiPost/, "Legacy global RFQ deep link must not send mobile credentials");
let mapped = 0;
for (const m of MODULE_CATALOG) {
  if (m.symbol) {
    mapped++;
    assert.ok(embedded.has(m.symbol), `Unknown SVG ${m.symbol} for module ${m.key}`);
  } else {
    assert.equal(m.key, "account-deletion", "No unsuitable substitute SVGs for destructive account deletion");
    assert.equal(m.icon, "trash-outline");
  }
}
assert.equal(mapped, 61, "All non-destructive mobile modules retain a registered SVG");
const tabs = read("src/navigation/vectorSymbolAssignments.ts");
for (const [, key] of tabs.matchAll(/(?:"[^"]+":\s*|return\s+)"([a-z0-9-]+)"/g)) {
  assert.ok(embedded.has(key), `Tab references an unregistered SVG: ${key}`);
}
const integrationFiles = [
  "src/components/RoleModuleDirectory.tsx",
  "src/components/GlassTabBar.tsx",
  "src/components/QuickActionHub.tsx",
  "app/customer/index.tsx",
];
for (const filename of integrationFiles) {
  assert.match(read(filename), /<VectorSymbol\b/, `SVG not rendered by ${filename}`);
}
// Every uploaded symbol must have an actual UI assignment, not merely a registry key.
const uiFiles = [
  "src/navigation/moduleCatalog.ts",
  "src/navigation/vectorSymbolAssignments.ts",
  "app/customer/index.tsx",
  "src/components/GlassTabBar.tsx",
  "src/components/PlantCard.tsx",
  "src/components/KycBanner.tsx",
  "app/owner/operations.tsx",
  "src/owner/modules.ts",
  "src/owner/OwnerInsights.tsx",
  "src/owner/OwnerTabBar.tsx",
  "src/screens/StaffCollection.tsx",
  "src/components/StateViews.tsx",
  "app/customer/more.tsx",
  "src/screens/StaffMore.tsx",
  "app/driver/trips.tsx",
  "app/trip/[id].tsx",
  "app/challan/[id].tsx",
  "app/pod/[id].tsx",
  "app/customer/plants.tsx",
];
const sourceUI = uiFiles.map(read).join("\\n");
for (const filename of masters) {
  const key = filename.slice(0, -4);
  assert.ok(sourceUI.includes(`"${key}"`), `SVG registered but not assigned to a real UI surface: ${key}`);
}
const homeSource = read("app/customer/index.tsx");
const registry = read("src/components/VectorSymbol.tsx");
assert.ok(registry.includes('import { set8 } from "./vector-symbols/set8";') && registry.includes("...set8,"), "New symbols must be registered");
for (const [key, symbol] of [["cement", "cement"], ["labour", "labour-contractor"], ["material", "building-material"]]) {
  assert.ok(homeSource.includes(`key: "${key}"`) && homeSource.includes(`symbol: "${symbol}"`), `Customer service ${key} missing vector assignment`);
}
assert.ok(homeSource.includes('<VectorSymbol name={service.symbol} size={homeSize.serviceSymbol} />'), "Other Services must render responsive registered vectors, not generic Ionicons");
assert.ok(homeSource.includes('<VectorSymbol name={action.symbol} size={homeSize.quickSymbol} />'), "Quick Actions must render responsive registered vectors");
assert.ok(homeSource.includes('<VectorSymbol name={module.symbol} size={homeSize.toolSymbol} />'), "RMC Tools must render responsive registered vectors");
assert.ok(!/styles\.(actionIcon|toolIcon|serviceIcon)/.test(homeSource), "Remove all decorative home icon wrappers");
const nav = read("src/components/GlassTabBar.tsx");
assert.ok(nav.includes('<VectorSymbol name={symbol} size={35} />'), "Navigation SVG icons must be 35 units");
assert.ok(nav.includes('styles.tabSide}>{leftRoutes.map(renderTab)') && nav.includes('styles.tabSide}>{rightRoutes.map(renderTab)'), "Two symmetric side groups must flank New Order");
assert.ok(!nav.includes("styles.iconWrap"), "Navigation icon plates must be absent");
const kyc = read("src/components/KycBanner.tsx");
assert.ok(kyc.includes('<VectorSymbol name={cfg.symbol} size={size.kycSymbol} />'), "KYC artwork must use the shared responsive size");
assert.ok(!kyc.includes("styles.icon"), "KYC icon plate must be absent");
const header = read("src/components/customer/CustomerHomeHeader.tsx");
for (const expected of ['name="chevron-down" size={size.headerChevron}', 'name="notifications-outline" size={size.headerBell}']) {
  assert.ok(header.includes(expected), `Header symbol missing responsive dimension: ${expected}`);
}
assert.ok(!header.includes('header-qr-disabled') && !header.includes('testID="header-kyc"') && !header.includes('header-location-refresh'), "Deprecated QR, shield, and refresh controls must not appear in the header");
assert.equal((header.match(/name="chevron-down"/g) || []).length, 1, "Exactly one location dropdown chevron must remain");
assert.ok(header.includes('testID="header-location-chevron"') && header.includes('onPress={() => setSheet("location")}'), "Left chevron must open the existing selector");
const homeSizes = read("src/theme/tokens.ts");
for (const baseline of ["quickSymbol: 52", "toolSymbol: 52", "serviceSymbol: 58", "kycSymbol: 28", "headerShield: 35", "headerScan: 32", "headerQR: 19", "headerBell: 22"]) {
  assert.ok(homeSizes.includes(baseline), `Native/mobile SVG baseline changed unexpectedly: ${baseline}`);
}
console.log(`PASS: ${masters.length}/${masters.length} SVG masters, original 88 preserved, 3 Other Services symbols rendered; ${mapped}/${MODULE_CATALOG.length} role modules; responsive Home artwork and native baselines protected`);
