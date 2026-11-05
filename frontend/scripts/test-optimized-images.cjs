"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { dimensions } = require("./webp-asset-utils.cjs");

const root = path.resolve(__dirname, "..");
const files = [
  ["Mixer", "src/components/HomeCarousel.tsx"],
  ["KYC-verification", "src/components/HomeCarousel.tsx"],
  ["Free-Calculator", "src/components/HomeCarousel.tsx"],
  ["Cashfree", "src/components/HomeCarousel.tsx"],
  ["CountryMap", "src/components/HomeCarousel.tsx"],
  ["TrackMyRMC_Login_Top_Banner_light", "src/screens/LoginScreen.tsx"],
  ["TrackMyRMC_Login_Top_Banner_Dark", "src/screens/LoginScreen.tsx"],
  ["Background Light Theme", "src/components/ThemedScreen.tsx"],
  ["Background Dark Theme", "src/components/ThemedScreen.tsx"],
  ["support-agent-mascot", "src/support/SupportWidgetBridge.tsx"],
];

test("ten optimised WebP images preserve PNG dimensions and reduce the bundle transfer bytes", () => {
  let pngBytes = 0, webpBytes = 0;
  for (const [stem, component] of files) {
    const original = path.join(root, "assets/images", stem + ".png");
    const optimized = path.join(root, "assets/images", stem + ".webp");
    assert.deepEqual(dimensions(optimized), dimensions(original), `dimension mismatch: ${stem}`);
    const pngSize = fs.statSync(original).size;
    const webpSize = fs.statSync(optimized).size;
    assert.ok(webpSize < pngSize, `no savings for ${stem}`);
    pngBytes += pngSize;
    webpBytes += webpSize;
    assert.ok(fs.readFileSync(path.join(root, component), "utf8").includes(stem + ".webp"), `missing optimized asset reference in ${component}`);
  }
  assert.ok(webpBytes < pngBytes * 0.45, `expected >55% combined byte savings; actual: ${pngBytes} -> ${webpBytes}`);
  for (const name of ["src/theme/sceneBackground.ts", "src/owner/OwnerUI.tsx"]) {
    const contents = fs.readFileSync(path.join(root, name), "utf8");
    for (const theme of ["Background Light Theme", "Background Dark Theme"])
      assert.ok(contents.includes(theme + ".webp"), `missing ${theme}.webp in ${name}`);
  }
});

test("native PNG splash and Android app icons are unchanged", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  assert.equal(config.expo.icon, "./assets/images/icon.png");
  assert.equal(config.expo.plugins.find(v => Array.isArray(v) && v[0] === "expo-splash-screen")[1].image,
    "./assets/images/Splash_screen.png");
});

test("visible-first images have priority without changing carousel order or timing", () => {
  const home = fs.readFileSync(path.join(root, "src/components/HomeCarousel.tsx"), "utf8");
  const login = fs.readFileSync(path.join(root, "src/screens/LoginScreen.tsx"), "utf8");
  assert.ok(home.includes('priority={slide.id === "mixer" ? "high" : "low"}'));
  assert.ok(home.includes('loading={slide.id === "mixer" ? "eager" : "lazy"}'));
  assert.ok(home.includes("const AUTO_MS = 4500"));
  assert.ok(home.includes("contentFit=\"contain\""));
  assert.ok(login.includes('priority="high"'));
  assert.ok(login.includes('cachePolicy="memory-disk"'));
});
