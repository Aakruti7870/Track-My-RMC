/* Keep login hero images and sheet geometry stable across release builds. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const frontend = path.resolve(__dirname, "..");
const screen = fs.readFileSync(path.join(frontend, "src/screens/LoginScreen.tsx"), "utf8");

const assets = [
  ["HERO_LIGHT", "TrackMyRMC_Login_Top_Banner_light.png"],
  ["HERO_DARK", "TrackMyRMC_Login_Top_Banner_Dark.png"],
];

describe("login banner assets and non-cropping layout", () => {
  for (const [variable, filename] of assets) {
    it(`bundles the correct 1920x1080 PNG for ${variable}`, () => {
      const requirePath = `../../assets/images/${filename}`;
      assert.ok(screen.includes(`const ${variable} = require("${requirePath}");`));
      const filePath = path.join(frontend, "assets/images", filename);
      const header = Buffer.alloc(24);
      const fd = fs.openSync(filePath, "r");
      try {
        assert.equal(fs.readSync(fd, header, 0, 24, 0), 24);
      } finally {
        fs.closeSync(fd);
      }
      assert.equal(header.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(header.toString("ascii", 12, 16), "IHDR");
      assert.equal(header.readUInt32BE(16), 1920);
      assert.equal(header.readUInt32BE(20), 1080);
      assert.ok(fs.statSync(filePath).size < 2 * 1024 * 1024, "banner exceeds 2 MiB");
    });
  }

  it("selects the matching theme without cropping the 16:9 banner", () => {
    assert.ok(screen.includes("colors.isDark ? HERO_DARK : HERO_LIGHT"));
    assert.ok(screen.includes('contentFit="contain"'));
    assert.match(screen, /hero:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*760[\s\S]*?aspectRatio:\s*16\s*\/\s*9/);
    assert.match(screen, /heroImage:\s*\{\s*width:\s*"100%",\s*height:\s*"100%"/);
  });

  it("retains the current login card width, overlap and all existing content", () => {
    assert.match(screen, /loginShell:\s*\{\s*width:\s*"92%",\s*maxWidth:\s*470,\s*marginTop:\s*-24/);
    assert.ok(screen.includes("testID=\"login-user-tab\""));
    assert.ok(screen.includes("testID=\"login-plant-tab\""));
    assert.ok(screen.includes("testID=\"login-review-access\""));
  });
});
