const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const read = file => readFileSync(path.join(__dirname, "..", file), "utf8");

test("shared light/dark card surfaces preserve readability over subdued artwork", () => {
  const tokens = read("src/theme/tokens.ts");
  for (const key of ["surfaceSecondary", "surfaceTertiary", "surfaceElevated", "glassTint"]) {
    const alphas = [...tokens.matchAll(new RegExp(key + ': "rgba\\([^"]+,(0\\.\\d+)\\)"', "g"))].map(match => Number(match[1]));
    assert.equal(alphas.length, 2, key + " must be defined for dark and light");
    assert.ok(alphas.every(alpha => alpha >= 0.94), key + " must remain readable");
  }
  const glass = [...tokens.matchAll(/(?:lightSurface|darkSurface): "rgba\([^"]+,(0\.\d+)\)"/g)];
  assert.equal(glass.length, 2);
  assert.ok(glass.every(match => Number(match[1]) >= 0.94));
  assert.match(read("src/components/ThemedScreen.tsx"), /artwork: \{ opacity: 0\.15 \}/);
  assert.match(read("src/owner/OwnerUI.tsx"), /opacity: 0\.15/);
  assert.match(read("src/theme/sceneBackground.ts"), /0\.85/);
});

test("customer Plants quick action uses an in-bounds SVG and compact label", () => {
  assert.match(read("app/customer/index.tsx"), /key: "plants", label: "Plants", symbol: "nearby-rmc-plants"/);
  const master = read("assets/images/SVG Vector Symbol/nearby-rmc-plants.svg").trim();
  assert.equal((master.match(/translate\(30 0\) scale\(0\.5\)/g) ?? []).length, 3);
  const set = read("src/components/vector-symbols/set3.ts");
  const entry = set.match(/^  "nearby-rmc-plants": (".*"),$/m);
  assert.ok(entry, "embedded SVG must remain available");
  assert.equal(JSON.parse(entry[1]), master, "embedded and master artwork must match");
});

test("tab bars do not add transparent web padding below navigation", () => {
  const customer = read("src/components/GlassTabBar.tsx");
  assert.match(customer, /paddingBottom: Platform\.OS === "web" \? 0 : insets\.bottom/);
  assert.match(customer, /backgroundColor: getThemedCanvasColor\(colors\)/);
  const owner = read("src/owner/OwnerTabBar.tsx");
  assert.match(owner, /paddingBottom: Platform\.OS === "web" \? 8 : Math\.max\(insets\.bottom, 8\)/);
});
