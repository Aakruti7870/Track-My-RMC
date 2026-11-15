const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("brand stays orange/graphite with readable theme surfaces", () => {
  const tokens = read("src/theme/tokens.ts");
  assert.match(tokens, /orange: "#FF6A00"/);
  assert.match(tokens, /graphite: "#0E1116"/);
  for (const status of ["DOCUMENT_NOT_SHARED", "DOCUMENT_UNAVAILABLE", "REVIEW_NEEDED", "IN_PROGRESS"]) {
    assert.ok(tokens.includes('"' + status + '"'), status + " must be color-coded");
  }
});
test("shared buttons wrap labels and preserve accessible touch targets", () => {
  const button = read("src/components/ui/Button.tsx");
  assert.doesNotMatch(button, /numberOfLines=\{1\}/);
  assert.match(button, /flexShrink: 1/);
  assert.match(button, /textAlign: "center"/);
  assert.match(button, /minHeight: control.buttonHeightSmall/);
  assert.match(button, /accessibilityRole="button"/);
});
test("glass cards and badges avoid horizontal overflow", () => {
  const card = read("src/components/ui/Card.tsx");
  const badge = read("src/components/ui/Badge.tsx");
  assert.match(card, /"glass"/);
  assert.match(card, /minWidth: 0/);
  assert.match(badge, /maxWidth: "100%"/);
  assert.match(badge, /numberOfLines=\{2\}/);
});
test("location disclosure remains explicit and scrollable on compact screens", () => {
  const consent = read("src/location/BackgroundLocationConsent.tsx");
  for (const required of [
    "ScrollView", 'maxHeight: "92%"', "contentContainerStyle",
    "backgroundColor: colors.surfaceElevated",
    'onRequestClose={() => settle(false)}',
    'label="Not now"', "PRIVACY_URL",
  ]) assert.ok(consent.includes(required), required);
});
test("KYC navigation has history fallback and does not imply verification", () => {
  const kyc = read("app/kyc.tsx");
  assert.match(kyc, /router.canGoBack\(\)/);
  assert.match(kyc, /router.replace\("\/customer"\)/);
  assert.match(kyc, /accessibilityLabel="Back"/);
  assert.match(kyc, /data\?\.status !== "VERIFIED"/);
});
