import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const absolute = path.join(directory, entry.name);
  if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(absolute);
  return /\.(?:tsx?|jsx?)$/.test(entry.name) ? [absolute] : [];
});
const sources = walk(path.join(root, "app")).concat(walk(path.join(root, "src")));
const mixed = [];
for (const file of sources) {
  const source = readFileSync(file, "utf8");
  if (/fontFamily\s*:\s*["'](?:Outfit|Raleway|Roboto|Arial|System)(?:[-"' ,]|$)/.test(source)) mixed.push(path.relative(root, file));
}
assert.deepEqual(mixed, [], "Every Expo app view must use the shared Jakarta family");
const tokens = readFileSync(path.join(root, "src/theme/tokens.ts"), "utf8");
for (const name of ["Jakarta-Regular", "Jakarta-Medium", "Jakarta-SemiBold", "Jakarta-Bold"])
  assert.ok(tokens.includes(name), "Shared font not declared: " + name);
assert.ok(!/Outfit-|Raleway-/.test(tokens), "Display and heading tokens must also be Jakarta");
const layout = readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
assert.ok(!/Outfit-|Raleway-/.test(layout), "Do not load mixed display fonts");
console.log("PASS: one font family, Plus Jakarta Sans, across Expo app sources");
