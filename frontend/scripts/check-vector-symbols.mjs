import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFileSync(path.join(root, relative), "utf8");
const assets = "assets/images/SVG Vector Symbol";
const masters = readdirSync(path.join(root, assets)).filter(name => name.endsWith(".svg")).sort();
assert.equal(masters.length, 88, "Expected exactly 88 uploaded SVG master files");

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
assert.equal(embedded.size, masters.length);
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
console.log(`PASS: ${masters.length}/${masters.length} SVGs registered and assigned to real UI surfaces, ${mapped}/${MODULE_CATALOG.length} role modules assigned; tabs and quick actions connected`);
