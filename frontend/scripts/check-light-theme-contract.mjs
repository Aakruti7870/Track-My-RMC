import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = readFileSync(resolve(root, "src/theme/tokens.ts"), "utf8");
const kt = readFileSync(resolve(root, "native-theme/TrackMyRmcLightTheme.kt"), "utf8");

const expected = {
  cardBackground: ["CARD_BACKGROUND", "#FFFFFF"],
  cardBorder: ["CARD_BORDER", "#FFE2C7"],
  titleText: ["TITLE_TEXT", "#1F2937"],
  secondaryText: ["SECONDARY_TEXT", "#4B5563"],
  distanceChip: ["DISTANCE_CHIP", "#FFF3E0"],
  googleMapsChip: ["GOOGLE_MAPS_CHIP", "#E0F0FF"],
  verificationChip: ["VERIFICATION_CHIP", "#E8F5E9"],
  primaryButton: ["PRIMARY_BUTTON", "#FF8A00"],
  buttonBorder: ["BUTTON_BORDER", "#FFA94D"],
  disabledButton: ["DISABLED_BUTTON", "#E2E8F0"],
};

for (const [token, [nativeName, hex]] of Object.entries(expected)) {
  assert.ok(ts.includes(`${token}: "${hex}"`), `missing TypeScript token ${token}=${hex}`);
  assert.ok(kt.includes(`const val ${nativeName} = "${hex}"`),
    `mismatched Kotlin token ${nativeName}=${hex}`);
}

for (const key of ["cardOpacity: 0.86", "wallpaperOpacity: 0.35"]) {
  assert.ok(ts.includes(key), `missing opacity contract ${key}`);
}
assert.ok(kt.includes("const val GLASS_CARD_OPACITY = 0.86f"));
assert.ok(kt.includes("const val WALLPAPER_OPACITY = 0.35f"));

const dark = ts.slice(ts.indexOf("export const darkColors:"), ts.indexOf("export const lightColors:"));
assert.ok(dark.includes('brand: "#FF6A00"'), "dark theme must keep its own orange");
assert.ok(dark.includes('onBrand: "#FFFFFF"'), "dark text must remain unchanged");
console.log("Light theme screenshot palette parity: 10 colours and 2 opacity values OK");
