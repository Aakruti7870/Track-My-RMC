const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const images = path.join(root, "assets", "images");
const light = "trackmyrmc-glass-card-light";
const dark = "trackmyrmc-dark-glass-card";

test("both uploaded themes have SVG masters and valid WebP card assets", () => {
  for (const name of [light, dark]) {
    const vector = fs.readFileSync(path.join(images, name + ".svg"), "utf8");
    assert.match(vector, /<svg\\b/);
    const image = fs.readFileSync(path.join(images, name + ".webp"));
    assert.equal(image.toString("ascii", 0, 4), "RIFF");
    assert.equal(image.toString("ascii", 8, 12), "WEBP");
  }
});

test("shared card artwork references both actual uploaded theme assets", () => {
  const artwork = fs.readFileSync(path.join(root, "src", "components", "ui", "GlassCardArtwork.tsx"), "utf8");
  for (const name of [light, dark]) assert.ok(artwork.includes(name + ".webp"));
  assert.match(artwork, /pointerEvents="none"/);
  assert.match(artwork, /useTheme/);
});

test("main cards and compact navigation tiles reuse the shared artwork", () => {
  for (const file of [
    "src/components/ui/Card.tsx",
    "src/components/QuickActionHub.tsx",
    "src/components/RoleModuleDirectory.tsx",
    "src/components/ActiveTransitMixerCard.tsx",
    "app/customer/index.tsx",
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /GlassCardArtwork/, file);
  }
});
