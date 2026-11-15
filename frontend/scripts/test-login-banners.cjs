/* Keep login hero quality, pixel dimensions and sheet geometry stable across builds. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { dimensions } = require("./webp-asset-utils.cjs");

const frontend = path.resolve(__dirname, "..");
const screen = fs.readFileSync(path.join(frontend, "src/screens/LoginScreen.tsx"), "utf8");

const assets = [
  ["HERO_LIGHT", "TrackMyRMC_Login_Top_Banner_light.webp", 1227],
  ["HERO_DARK", "TrackMyRMC_Login_Top_Banner_Dark.webp", 1229],
];

describe("optimized login banner assets and non-cropping layout", () => {
  for (const [variable, filename, width] of assets) {
    it(`bundles the reference crop as a lossless WebP for ${variable}`, () => {
      const requirePath = `../../assets/images/${filename}`;
      assert.ok(screen.includes(`const ${variable} = require("${requirePath}");`));
      const compressedPath = path.join(frontend, "assets/images", filename);
      const originalPath = compressedPath.replace(/\.webp$/, ".png");
      assert.deepEqual(dimensions(compressedPath), { width, height: 615 });
      assert.deepEqual(dimensions(originalPath), { width, height: 615 });
      assert.ok(fs.readFileSync(compressedPath).includes(Buffer.from("VP8L")), "WebP must preserve the decoded reference pixels");
      assert.ok(fs.statSync(compressedPath).size < fs.statSync(originalPath).size, "WebP must be smaller than original PNG");
    });
  }

  it("selects the matching theme without cropping the original hero crop", () => {
    assert.ok(screen.includes("colors.isDark ? HERO_DARK : HERO_LIGHT"));
    assert.ok(screen.includes('contentFit="contain"'));
    assert.match(screen, /aspectRatio: heroAspect/);
    assert.match(screen, /heroAspect = \(colors\.isDark \? 1229 : 1227\) \/ 615/);
    assert.match(screen, /heroImage:\s*\{\s*width:\s*"100%",\s*height:\s*"100%"/);
  });

  it("retains login card width, hero seam, and existing options", () => {
    assert.match(screen, /loginShell:\s*\{\s*width:\s*"92%",\s*maxWidth:\s*470,\s*marginTop:\s*-16/);
    assert.ok(screen.includes('testID={`login-${key}-tab`}'));
    assert.match(screen, /key: "user".*label: "USER LOGIN"/);
    assert.match(screen, /key: "plant".*label: "PLANT STAFF"/);
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
