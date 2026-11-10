/* Keep login hero quality, pixel dimensions and sheet geometry stable across builds. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { dimensions } = require("./webp-asset-utils.cjs");

const frontend = path.resolve(__dirname, "..");
const screen = fs.readFileSync(path.join(frontend, "src/screens/LoginScreen.tsx"), "utf8");

const assets = [
  ["HERO_LIGHT", "TrackMyRMC_Login_Top_Banner_light.webp"],
  ["HERO_DARK", "TrackMyRMC_Login_Top_Banner_Dark.webp"],
];

describe("optimized login banner assets and non-cropping layout", () => {
  for (const [variable, filename] of assets) {
    it(`bundles the original-resolution 1920x1080 WebP for ${variable}`, () => {
      const requirePath = `../../assets/images/${filename}`;
      assert.ok(screen.includes(`const ${variable} = require("${requirePath}");`));
      const compressedPath = path.join(frontend, "assets/images", filename);
      const originalPath = compressedPath.replace(/\.webp$/, ".png");
      assert.deepEqual(dimensions(compressedPath), { width: 1920, height: 1080 });
      assert.deepEqual(dimensions(originalPath), { width: 1920, height: 1080 });
      assert.ok(fs.statSync(compressedPath).size < fs.statSync(originalPath).size, "WebP must be smaller than original PNG");
    });
  }

  it("selects the matching theme without cropping the 16:9 banner", () => {
    assert.ok(screen.includes("colors.isDark ? HERO_DARK : HERO_LIGHT"));
    assert.ok(screen.includes('contentFit="contain"'));
    assert.match(screen, /hero:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*760[\s\S]*?aspectRatio:\s*16\s*\/\s*9/);
    assert.match(screen, /heroImage:\s*\{\s*width:\s*"100%",\s*height:\s*"100%"/);
  });

  it("retains current login card width, overlap and existing options", () => {
    assert.match(screen, /loginShell:\s*\{\s*width:\s*"92%",\s*maxWidth:\s*470,\s*marginTop:\s*-24/);
    assert.ok(screen.includes('testID="login-user-tab"'));
    assert.ok(screen.includes('testID="login-plant-tab"'));
    assert.ok(screen.includes('testID="login-review-access"'));
  });
  it("links the Plant Staff work email to the new Plant Owner registration form", () => {
    const label = screen.indexOf('label="Enter Registered Work Email"');
    const link = screen.indexOf('testID="login-open-onboarding-form"');
    const submit = screen.indexOf('testID="login-plant-send-otp"');
    assert.ok(label >= 0, "Plant Staff email label should be updated");
    assert.ok(label < link && link < submit, "Onboarding link must appear directly after the email field and before login submit");
    assert.ok(screen.includes('accessibilityRole="button"'));
    assert.ok(screen.includes('accessibilityLabel="Register As Plant Owner"'));
    assert.ok(screen.includes("onPress={openOnboarding}"));
    assert.ok(screen.includes('pathname: "/plant-onboarding"'));
    assert.ok(screen.includes("email: plantEmail.trim().toLowerCase()"));
    assert.ok(screen.includes("onboardingLinkContent: {"));
    assert.ok(screen.includes("onboardingLinkLabel: {"));
    assert.ok(screen.includes("fontFamily: fonts.bold"));
    assert.ok(screen.includes("minHeight: 54"));
    assert.ok(screen.includes("rgba(187,247,208,0.21)"), "Dark glass green treatment missing");
    assert.ok(screen.includes("rgba(134,239,172,0.30)"), "Light glass green treatment missing");
  });

});
