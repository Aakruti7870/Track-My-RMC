const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const imagePath = path.join(root, "assets", "images", "Splash_screen.png");
const layout = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));

test("Splash_screen.png is a compact, square, valid PNG for quick native startup", () => {
  const image = fs.readFileSync(imagePath);
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.toString("ascii", 12, 16), "IHDR");
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  assert.equal(width, height, "Native splash artwork should be square");
  assert.ok(width >= 512 && width <= 2048, "Splash PNG must be a practical Android splash dimension");
  assert.ok(image.length <= 1.5 * 1024 * 1024, "Splash PNG should not exceed 1.5 MiB");
});

test("Native Expo splash and startup artwork both use the uploaded PNG", () => {
  const splash = config.expo.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === "expo-splash-screen",
  );
  assert.ok(splash, "Expo splash configuration must exist");
  assert.equal(splash[1].image, "./assets/images/Splash_screen.png");
  assert.equal(splash[1].resizeMode, "contain");
  assert.equal(splash[1].backgroundColor, "#000000");
  assert.match(layout, /require\(["']\.\.\/assets\/images\/Splash_screen\.png["']\)/);
  assert.match(layout, /SplashScreen\.preventAutoHideAsync\(\)/);
  assert.match(layout, /SplashScreen\.hideAsync\(\)/);
  assert.doesNotMatch(layout, /expo-video|VideoView|useVideoPlayer|\.mp4/);
});

test("Deleted video and older PNG are not required for app boot", () => {
  assert.ok(!fs.existsSync(path.join(root, "assets", "images", "TrackMyRMC_Splash_screen.mp4")));
  assert.doesNotMatch(layout, /RMC_Splash_logo\.png/);
  assert.ok(!JSON.stringify(config).includes("RMC_Splash_logo.png"));
});

test("Video playback package is not required after MP4 removal", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(manifest.dependencies["expo-video"], undefined);
  assert.equal(lockfile.packages[""].dependencies["expo-video"], undefined);
  assert.equal(lockfile.packages["node_modules/expo-video"], undefined);
});
