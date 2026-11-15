import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFileSync(path.join(root, relative), "utf8");
async function importTypescript(relative) {
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const legacyAssets = readdirSync(path.join(root, "assets/images/SVG Vector Symbol"))
  .filter(filename => filename.endsWith(".svg"))
  .map(filename => filename.slice(0, -4));
const { materialSymbolNames, materialSymbolPaths } = await importTypescript(
  "src/components/vector-symbols/materialSymbols.ts",
);
for (const name of legacyAssets) {
  assert.ok(Object.hasOwn(materialSymbolNames, name), `Missing replacement for ${name}`);
}
for (const [name, icon] of Object.entries(materialSymbolNames)) {
  assert.ok(Object.hasOwn(materialSymbolPaths, icon), `Unknown Material Symbol ${icon} for ${name}`);
}
for (const [icon, d] of Object.entries(materialSymbolPaths)) {
  assert.match(d, /^[Mm][0-9.,+ eEMmLlHhVvCcSsQqTtAaZz-]+$/, `Invalid path for ${icon}`);
}
assert.match(read("src/components/vector-symbols/LICENSE-Material-Symbols"), /Apache License/);

const { MODULE_CATALOG } = await importTypescript("src/navigation/moduleCatalog.ts");
assert.equal(MODULE_CATALOG.length, 62, "Global RFQ administration is web-only; legitimate plant modules remain");
assert.ok(!MODULE_CATALOG.some(m => m.key === "admin-rmc-rfq-leads" || m.route === "/admin/rmc-rfq-leads"), "Global customer leads must not be advertised to plant admins");
assert.doesNotMatch(read("app/admin/rmc-rfq-leads.tsx"), /useGet|apiPatch|apiPost/, "Legacy global RFQ deep link must not send mobile credentials");
let mapped = 0;
for (const m of MODULE_CATALOG) {
  if (m.symbol) {
    mapped++;
    assert.ok(Object.hasOwn(materialSymbolNames, m.symbol), `Unknown SVG ${m.symbol} for module ${m.key}`);
  } else {
    assert.equal(m.key, "account-deletion", "No unsuitable substitute SVGs for destructive account deletion");
    assert.equal(m.icon, "trash-outline");
  }
}
assert.equal(mapped, 61, "All non-destructive mobile modules retain a registered SVG");
const tabs = read("src/navigation/vectorSymbolAssignments.ts");
for (const [, key] of tabs.matchAll(/(?:"[^"]+":\s*|return\s+)"([a-z0-9-]+)"/g)) {
  assert.ok(Object.hasOwn(materialSymbolNames, key), `Tab references an unregistered SVG: ${key}`);
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
const renderer = read("src/components/VectorSymbol.tsx");
assert.match(renderer, /viewBox="0 -960 960 960"/);
assert.match(renderer, /<Path d=\{materialSymbolPaths\[materialSymbolNames\[name\]\]\} fill=/);
assert.match(renderer, /\baria-hidden\b/);
assert.doesNotMatch(renderer, /SvgXml|[Gg]radient|warmAccent/);

const home = read("app/customer/index.tsx");
const homeIcons = [materialSymbolNames["new-order"], materialSymbolNames["live-order-tracking"],
  materialSymbolNames["nearby-rmc-plants"], materialSymbolNames["my-orders"],
  materialSymbolNames.cement, materialSymbolNames["labour-contractor"], materialSymbolNames["building-material"]];
assert.equal(new Set(homeIcons).size, homeIcons.length, "Order actions and service categories need distinct symbols");
assert.match(home, /<VectorSymbol name="pump-rental" size=\{homeSize.pumpSymbol\}/);

const nav = read("src/components/GlassTabBar.tsx");
assert.match(nav, /<VectorSymbol name=\{symbol\} color=\{ink\} \/>/);
assert.ok(nav.includes('{leftRoutes.map(renderTab)}') && nav.includes('{rightRoutes.map(renderTab)}'), "Two symmetric side groups must flank New Order");
assert.ok(!nav.includes("styles.iconWrap"), "Navigation icon plates must be absent");
const kyc = read("src/components/KycBanner.tsx");
assert.match(kyc, /<VectorSymbol name=\{cfg.symbol\} size=\{size.kycSymbol\} color=\{tone\}/);
const header = read("src/components/customer/CustomerHomeHeader.tsx");
for (const expected of ['name="chevron-down" size={size.headerChevron}', 'name="notifications-outline" size={size.headerBell}']) {
  assert.ok(header.includes(expected), `Header symbol missing responsive dimension: ${expected}`);
}
assert.ok(!header.includes('header-qr-disabled') && !header.includes('testID="header-kyc"') && !header.includes('header-location-refresh'), "Deprecated QR, shield, and refresh controls must not appear in the header");
assert.equal((header.match(/name="chevron-down"/g) || []).length, 1, "Exactly one location dropdown chevron must remain");
assert.ok(header.includes('testID="header-location-chevron"') && header.includes('onPress={() => setSheet("location")}'), "Left chevron must open the existing selector");
console.log(`PASS: ${legacyAssets.length} former artwork assignments have replacements, ${Object.keys(materialSymbolPaths).length} licensed Material Symbols and ${mapped}/${MODULE_CATALOG.length} mapped role modules`);
