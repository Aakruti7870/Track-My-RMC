import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const renderer = read("src/components/VectorSymbol.tsx");
const trackIcons = JSON.parse(read("src/components/vector-symbols/track-icons.json"));
const aliases = Object.fromEntries([...renderer.matchAll(/^  "([a-z-]+)": "([a-z-]+)",$/gm)].map(([, key, value]) => [key, value]));
assert.equal(Object.keys(trackIcons).length, 88);
for (const [name, icon] of Object.entries(trackIcons)) {
  assert.ok(icon.full.length && icon.compact.length, `Missing master or compact artwork for ${name}`);
  for (const shapes of Object.values(icon)) checkShapes(shapes);
}
function checkShapes(shapes) {
  for (const [tag, attributes, children] of shapes) {
    assert.ok(["path", "circle", "g", "line", "rect"].includes(tag), `Unexpected SVG element: ${tag}`);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "stroke" || key === "fill") assert.ok(["none", "currentColor"].includes(value));
      if (key === "d") assert.match(value, /^[Mm][0-9.,+ eEMmLlHhVvCcSsQqTtAaZz-]+$/);
    }
    if (children) checkShapes(children);
  }
}
for (const [alias, name] of Object.entries(aliases)) {
  assert.ok(Object.hasOwn(trackIcons, name), `Unknown symbol ${name} for ${alias}`);
}
for (const name of ["home", "orders", "plants", "more"]) {
  assert.ok(trackIcons[name].active?.length, `Missing active symbol for ${name}`);
}
for (const name of ["avatar-shield", "browser-shield", "compact-lock"]) {
  assert.ok(trackIcons["restricted-access"][name]?.length, `Missing restricted access variation: ${name}`);
}
const { materialSymbolNames, materialSymbolPaths } = await importTypescript(
  "src/components/vector-symbols/materialSymbols.ts",
);
const supported = new Set([...Object.keys(trackIcons), ...Object.keys(aliases), ...Object.keys(materialSymbolNames)]);
for (const [name, icon] of Object.entries(materialSymbolNames)) {
  assert.ok(Object.hasOwn(materialSymbolPaths, icon), `Unknown Material Symbol ${icon} for ${name}`);
}
for (const [icon, d] of Object.entries(materialSymbolPaths)) {
  assert.match(d, /^[Mm][0-9.,+ eEMmLlHhVvCcSsQqTtAaZz-]+$/, `Invalid path for ${icon}`);
}
assert.match(read("src/components/vector-symbols/LICENSE-Material-Symbols"), /Apache License/);

const { MODULE_CATALOG } = await importTypescript("src/navigation/moduleCatalog.ts");
assert.equal(MODULE_CATALOG.length, 62, "Global RFQ administration is web-only; legitimate plant modules remain");
assert.ok(!MODULE_CATALOG.some(m => m.key === "admin-rmc-rfq-leads" || m.route === "/plant-admin/rmc-rfq-leads"), "Global customer leads must not be advertised to plant admins");
assert.doesNotMatch(read("app/plant-admin/rmc-rfq-leads.tsx"), /useGet|apiPatch|apiPost/, "Legacy global RFQ deep link must not send mobile credentials");
let mapped = 0;
for (const m of MODULE_CATALOG) {
  if (m.symbol) {
    mapped++;
    assert.ok(supported.has(m.symbol), `Unknown SVG ${m.symbol} for module ${m.key}`);
  } else {
    assert.equal(m.key, "account-deletion", "No unsuitable substitute SVGs for destructive account deletion");
    assert.equal(m.icon, "trash-outline");
  }
}
assert.equal(mapped, 61, "All non-destructive mobile modules retain a registered SVG");
const tabs = read("src/navigation/vectorSymbolAssignments.ts");
for (const [, key] of tabs.matchAll(/(?:"[^"]+":\s*|return\s+)"([a-z0-9-]+)"/g)) {
  assert.ok(supported.has(key), `Tab references an unregistered SVG: ${key}`);
}
const integrationFiles = [
  "src/components/RoleModuleDirectory.tsx",
  "src/components/GlassTabBar.tsx",
  "src/components/QuickActionHub.tsx",
  "src/components/IconTile.tsx",
  "app/customer/index.tsx",
];
for (const filename of integrationFiles) {
  assert.match(read(filename), /<(?:VectorSymbol|IconTile\b[^>]*\bsymbol=)/, `SVG not rendered by ${filename}`);
}
assert.match(renderer, /track-icons\.json/);
assert.match(renderer, /"0 0 64 64" : "0 -960 960 960"/);
assert.match(renderer, /<Path d=\{materialSymbolPaths\[fallback\]\} fill=/);
assert.match(renderer, /\baria-hidden\b/);
assert.doesNotMatch(renderer, /SvgXml|dangerouslySetInnerHTML/);

const home = read("src/navigation/customerHome.ts");
const homeIcons = ["new-order", "live-order-tracking", "nearby-rmc-plants", "my-orders", "cement", "labour-contractor", "building-material"];
const geometries = homeIcons.map(name => JSON.stringify(trackIcons[name]?.full ?? materialSymbolPaths[materialSymbolNames[name]]));
assert.ok(geometries.every(Boolean));
assert.equal(new Set(geometries).size, homeIcons.length, "Order actions and service categories need distinct symbols");
assert.match(home, /key: "pump-rental"[^\n]*symbol: "pump-rental"/);

const nav = read("src/components/GlassTabBar.tsx");
assert.match(nav, /<VectorSymbol name=\{symbol\} color=\{ink\} active=\{focused\} \/>/);
assert.ok(nav.includes('{leftRoutes.map(renderTab)}') && nav.includes('{rightRoutes.map(renderTab)}'), "Two symmetric side groups must flank New Order");
assert.ok(!nav.includes("styles.iconWrap"), "Navigation icon plates must be absent");
const kyc = read("src/components/KycBanner.tsx");
assert.match(kyc, /<IdentityVerificationSymbol size=\{size.kycSymbol \+ 6\} verified=\{isVerified\}/);
const verificationSymbol = read("src/components/vector-symbols/IdentityVerificationSymbol.tsx");
assert.match(verificationSymbol, /backgroundColor: homeArtwork.kycIconFill/);
assert.match(verificationSymbol, /verified \? "kyc-verified" : "restricted-access"/);
assert.match(verificationSymbol, /color=\{colors.isDark \? "#FFFFFF" : lightQuickAccessArtwork.iconInk\}/);
const header = read("src/components/customer/CustomerHomeHeader.tsx");
for (const expected of ['name="chevron-down" size={size.headerChevron}', 'name="notifications" size={size.headerBell}']) {
  assert.ok(header.includes(expected), `Header symbol missing responsive dimension: ${expected}`);
}
assert.ok(!header.includes('header-qr-disabled') && !header.includes('testID="header-kyc"') && !header.includes('header-location-refresh'), "Deprecated QR, shield, and refresh controls must not appear in the header");
assert.equal((header.match(/name="chevron-down"/g) || []).length, 1, "Exactly one location dropdown chevron must remain");
assert.ok(header.includes('testID="header-location-chevron"') && header.includes('onPress={() => setSheet("location")}'), "Left chevron must open the existing selector");
console.log(`PASS: ${Object.keys(trackIcons).length} supplied vectors, ${Object.keys(materialSymbolPaths).length} licensed Material Symbols and ${mapped}/${MODULE_CATALOG.length} mapped role modules`);
