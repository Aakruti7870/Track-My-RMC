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

test("home offers KYC-later request building and prioritizes next actions", () => {
  const home = read("app/customer/index.tsx");
  const actionHandler = home.split("const onAction = ")[1]?.split("const openService = ")[0] || "";
  assert.match(actionHandler, /router\.push\("\/new-order"\)/);
  assert.doesNotMatch(actionHandler, /Complete KYC to place an order/);
  assert.match(home, /<CustomerNextAction/);
  const firstCard = home.indexOf("<CustomerNextAction");
  const carousel = home.indexOf("<HomeCarousel");
  const shortcuts = home.indexOf("{quickActions}", carousel);
  assert.ok(firstCard < carousel && carousel < shortcuts, "context-first home keeps carousel and shortcuts adjacent");
  const action = read("src/components/customer/CustomerNextAction.tsx");
  assert.match(action, /activeOrder/);
  assert.match(action, /Verify identity/);
  assert.match(action, /No payment is taken/);
});
test("new order uses local calendar dates and a transparent final review", () => {
  const order = read("app/new-order.tsx");
  const nextDays = order.split("function nextDays")[1]?.split("export default function")[0] || "";
  assert.match(nextDays, /getFullYear\(\)/);
  assert.doesNotMatch(nextDays, /toISOString\(\)/);
  for (const section of ["1. Choose Plant", "2. Concrete Grade", "3. Quantity", "4. Delivery Schedule", "5. Site & Contact", "6. Payment Preference"]) {
    assert.ok(order.includes(section), "Missing step " + section);
  }
  assert.ok(order.indexOf("5. Site & Contact") < order.indexOf("6. Payment Preference"), "payment comes after site information");
  assert.ok(order.indexOf('testID="neworder-review"') > order.indexOf("6. Payment Preference"), "review is last");
  assert.match(order, /plant confirms availability, rates and final payment terms/);
  assert.match(order, /router\.canGoBack\(\)/);
});
test("plant onboarding keeps the request pending and supports compact-screen scrolling", () => {
  const onboarding = read("app/plant-onboarding.tsx");
  assert.match(onboarding, /testID="onboarding-next-steps"/);
  assert.match(onboarding, /Account access is enabled only after approval/);
  assert.match(onboarding, /contentContainerStyle=\{\[styles\.successPage/);
  assert.match(onboarding, /router\.canGoBack\(\)/);
});

test("customer order empty state recovers instead of trapping the user", () => {
  const orders = read("app/customer/orders.tsx");
  assert.match(orders, /testID="orders-empty-next-action"/);
  assert.match(orders, /Start an Order Request/);
  assert.match(orders, /View All Orders/);
  assert.match(orders, /router\.push\("\/new-order"\)/);
  assert.match(orders, /minHeight: 48/);
});
