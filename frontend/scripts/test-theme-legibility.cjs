const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const read = file => readFileSync(path.join(__dirname, "..", file), "utf8");

test("matte light and dark surfaces keep body and secondary text readable", () => {
  const tokens = read("src/theme/tokens.ts");
  const luminance = hex => {
    const rgb = hex.match(/[0-9a-f]{2}/gi).map(pair => {
      const srgb = parseInt(pair, 16) / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const scheme of ["dark", "light"]) {
    const body = tokens.split(`export const ${scheme}Colors: ThemeColors = {`)[1].split("};")[0];
    const color = key => {
      const value = body.match(new RegExp(`\\b${key}: "(#[0-9A-F]{6})"`, "i"))?.[1];
      assert.ok(value, `${scheme} ${key} must be a solid color`);
      return luminance(value);
    };
    const pairs = [
      ["onBrand", "brand"],
      ["onBrand", "brandPressed"],
      ...["surfaceSecondary", "surfaceTertiary", "surfaceElevated"].flatMap(surface =>
        ["onSurface", "onSurfaceTertiary", "accentText", "error"].map(ink => [ink, surface])),
    ];
    for (const [foreground, background] of pairs) {
      const [low, high] = [color(background), color(foreground)].sort((a, b) => a - b);
      assert.ok((high + 0.05) / (low + 0.05) >= 4.5, `${scheme} ${foreground} on ${background} fails normal-text contrast`);
    }
    const outline = color("controlOutline");
    for (const surface of ["surfaceSecondary", "surfaceTertiary", "surfaceElevated"]) {
      const [low, high] = [color(surface), outline].sort((a, b) => a - b);
      assert.ok((high + 0.05) / (low + 0.05) >= 3, `${scheme} field outline on ${surface}`);
    }
  }

  for (const component of ["src/components/GlassTabBar.tsx", "src/components/QuickActionHub.tsx"]) {
    assert.doesNotMatch(read(component), /BlurView|backdropFilter/);
  }
  assert.match(read("src/components/ThemedScreen.tsx"), /artwork: \{ opacity: 0\.15 \}/);
  assert.match(read("src/owner/OwnerUI.tsx"), /opacity: 0\.15/);
  assert.match(read("src/theme/sceneBackground.ts"), /0\.85/);
});

test("customer Plants quick action uses the uploaded nearby RMC plants glyph", () => {
  assert.match(read("app/customer/index.tsx"), /key: "plants", label: "Nearby Plants", symbol: "nearby-rmc-plants"/);
  const icons = JSON.parse(read("src/components/vector-symbols/track-icons.json"));
  assert.ok(icons["nearby-rmc-plants"].compact.length);
});

test("tab bars do not add transparent web padding below navigation", () => {
  const customer = read("src/components/GlassTabBar.tsx");
  assert.match(customer, /paddingBottom: Platform\.OS === "web" \? 0 : insets\.bottom/);
  assert.match(customer, /backgroundColor: getThemedCanvasColor\(colors\)/);
  const owner = read("src/owner/OwnerTabBar.tsx");
  assert.match(owner, /paddingBottom: Platform\.OS === "web" \? 8 : Math\.max\(insets\.bottom, 8\)/);
});

test("order stages share the requested colors, including persisted aliases", () => {
  const ts = require("typescript");
  const { runInNewContext } = require("node:vm");
  const code = ts.transpileModule(read("src/domain/order.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: () => require("../src/domain/order-status-colors.json") });
  const { orderStatusColor } = exports;
  for (const dark of [false, true]) {
    for (const states of [
      ["Pending", "pending_kyc"],
      ["Accepted", "confirmed", "scheduled"],
      ["Preparing", "in-production", "produced", "ready_to_dispatch"],
      ["Dispatched", "in_transit", "en route", "at_site"],
      ["Delivered", "completed"],
    ]) {
      for (const value of states) assert.equal(orderStatusColor(value, dark), orderStatusColor(states[0], dark));
    }
    assert.equal(new Set(["Pending", "Accepted", "Preparing", "Dispatched", "Delivered"]
      .map(value => orderStatusColor(value, dark))).size, 5);
    assert.equal(orderStatusColor("VERIFIED", dark), undefined);
  }
});
