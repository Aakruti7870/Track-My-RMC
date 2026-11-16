"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { dimensions } = require("./webp-asset-utils.cjs");

const root = path.resolve(__dirname, "..");
const files = [
  ["TrackMyRMC_Login_Top_Banner_light", "src/screens/LoginScreen.tsx"],
  ["TrackMyRMC_Login_Top_Banner_Dark", "src/screens/LoginScreen.tsx"],
  ["Background Light Theme", "src/components/ThemedScreen.tsx"],
  ["Background Dark Theme", "src/components/ThemedScreen.tsx"],
  ["support-agent-mascot", "src/support/SupportWidgetBridge.tsx"],
];

test("shared WebP artwork preserves PNG dimensions and reduces the bundle transfer bytes", () => {
  for (const [stem, component] of files) {
    const original = path.join(root, "assets/images", stem + ".png");
    const optimized = path.join(root, "assets/images", stem + ".webp");
    assert.deepEqual(dimensions(optimized), dimensions(original), `dimension mismatch: ${stem}`);
    const pngSize = fs.statSync(original).size;
    const webpSize = fs.statSync(optimized).size;
    assert.ok(webpSize < pngSize, `no savings for ${stem}`);
    assert.ok(fs.readFileSync(path.join(root, component), "utf8").includes(stem + ".webp"), `missing optimized asset reference in ${component}`);
  }
  for (const name of ["src/theme/sceneBackground.ts", "src/owner/OwnerUI.tsx"]) {
    const contents = fs.readFileSync(path.join(root, name), "utf8");
    for (const theme of ["Background Light Theme", "Background Dark Theme"])
      assert.ok(contents.includes(theme + ".webp"), `missing ${theme}.webp in ${name}`);
  }
});

test("six new carousel banners are optimized WebPs and replace the retired slides", () => {
  const assets = path.join(root, "assets", "images");
  const directory = path.join(assets, "carousel");
  const carousel = fs.readFileSync(path.join(root, "src/components/HomeCarousel.tsx"), "utf8");
  const filenames = [
    "order-concrete.webp", "track-order.webp", "nearby-plants.webp",
    "rmc-calculator.webp", "bulk-concrete.webp", "delivery-challans.webp",
  ];
  assert.deepEqual([...carousel.matchAll(/source: require\("\.\.\/\.\.\/assets\/images\/carousel\/([^"]+)"\)/g)].map(match => match[1]), filenames);
  assert.deepEqual(fs.readdirSync(directory).sort(), [...filenames].sort());
  let bytes = 0;
  for (const filename of filenames) {
    const asset = path.join(directory, filename);
    assert.deepEqual(dimensions(asset), { width: 1672, height: 941 });
    assert.equal(fs.readFileSync(asset).toString("ascii", 8, 12), "WEBP");
    bytes += fs.statSync(asset).size;
  }
  assert.ok(bytes < 1024 * 1024, `Carousel transfer exceeds 1 MiB: ${bytes}`);
  for (const stem of ["Mixer", "KYC-verification", "Free-Calculator", "Cashfree", "CountryMap"]) {
    assert.ok(!fs.existsSync(path.join(assets, stem + ".webp")));
    assert.ok(!fs.existsSync(path.join(assets, stem + ".png")));
  }
});

test("owner and plant staff reuse the pixel-preserving RMC plant WebP banner", () => {
  const stem = "Plant _Owner_All_staff_top_card";
  const original = path.join(root, "assets/images", stem + ".png");
  const optimized = path.join(root, "assets/images", stem + ".webp");
  assert.deepEqual(dimensions(optimized), dimensions(original), "plant hero dimensions must not change");
  assert.ok(fs.statSync(optimized).size < fs.statSync(original).size, "lossless banner must be smaller");
  const header = fs.readFileSync(optimized).subarray(0, 16);
  assert.equal(header.subarray(0, 4).toString(), "RIFF");
  assert.equal(header.subarray(8, 12).toString(), "WEBP");
  // VP8L is WebP's lossless format. A lossy re-encode would violate the image requirement.
  assert.equal(header.subarray(12, 16).toString(), "VP8L");
  const shared = fs.readFileSync(path.join(root, "src/components/PlantHomeCards.tsx"), "utf8");
  assert.ok(shared.includes(stem + ".webp"), "missing lossless plant banner in PlantHomeHero");
  for (const component of ["app/owner/index.tsx", "src/screens/StaffHome.tsx"]) {
    const contents = fs.readFileSync(path.join(root, component), "utf8");
    assert.ok(contents.includes("<PlantHomeHero "), `missing shared plant banner in ${component}`);
  }
  assert.ok(!fs.readFileSync(path.join(root, "app/owner/index.tsx"), "utf8").includes('require("../../assets/images/Mixer.png")'), "owner banner must no longer show a truck");
  const staff = fs.readFileSync(path.join(root, "src/screens/StaffHome.tsx"), "utf8");
  assert.ok(staff.includes("disabled={!primaryAllowed}"), "staff permission gate must remain unchanged");
  assert.match(staff, /onPress=\{\(\) => router\.push\(workspace\.href\)\}/, "The staff shortcut must open its configured role workspace.");
});

test("native PNG splash and Android app icons are unchanged", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  assert.equal(config.expo.icon, "./assets/images/icon.png");
  assert.equal(config.expo.plugins.find(v => Array.isArray(v) && v[0] === "expo-splash-screen")[1].image,
    "./assets/images/Splash_screen.png");
});

test("Android adaptive launcher artwork exists as a square PNG", () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const resolved = require(path.join(root, "app.config.js"))({ config: app.expo });
  const adaptive = resolved.android.adaptiveIcon;
  assert.equal(adaptive.foregroundImage, "./assets/images/adaptive-icon.png");
  assert.equal(adaptive.backgroundColor, "#24282D");
  const foreground = path.resolve(root, adaptive.foregroundImage);
  assert.ok(fs.existsSync(foreground), `Missing Android adaptive foreground: ${foreground}`);
  const bytes = fs.readFileSync(foreground);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Foreground must be a PNG");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(width, height, "Android adaptive foreground must be square");
  assert.ok(width >= 1024, "Android adaptive foreground resolution is too small");
});

test("visible-first images have priority with the established carousel timing", () => {
  const home = fs.readFileSync(path.join(root, "src/components/HomeCarousel.tsx"), "utf8");
  const login = fs.readFileSync(path.join(root, "src/screens/LoginScreen.tsx"), "utf8");
  assert.ok(home.includes('priority={i === 0 ? "high" : "low"}'));
  assert.ok(home.includes("const AUTO_MS = 4500"));
  assert.ok(home.includes("contentFit=\"contain\""));
  assert.ok(login.includes('priority="high"'));
  assert.ok(login.includes('cachePolicy="memory-disk"'));
});
