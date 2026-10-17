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
assert.equal(masters.length, 91, "Expected 88 original and 3 new SVG masters");

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
assert.equal(MODULE_CATALOG.length, 61);
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
assert.equal(mapped, 60);
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
assert.ok(homeSource.includes('<VectorSymbol name={service.symbol} size={58} />'), "Other Services must render the assigned vector, not a generic Ionicon");
console.log(`PASS: ${masters.length}/${masters.length} SVG masters, original 88 preserved, 3 Other Services symbols rendered; ${mapped}/${MODULE_CATALOG.length} role modules; tabs and quick actions connected`);
