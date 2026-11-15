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

test("Material theme pairs meet WCAG AA for normal control text in both modes", () => {
  const ts = require("typescript");
  const { createRequire } = require("node:module");
  const load = (name, imports = {}) => {
    const filename = path.join(__dirname, "..", name);
    const output = ts.transpileModule(read(name), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    const requireFromFile = createRequire(filename);
    new Function("require", "module", "exports", output)(
      id => imports[id] ?? requireFromFile(id), module, module.exports,
    );
    return module.exports;
  };
  const tokens = load("src/theme/tokens.ts");
  const base = { fonts: { bodyLarge: { fontWeight: "400" }, default: {} } };
  const { createPaperTheme } = load("src/theme/paperTheme.ts", {
    "./tokens": tokens,
    "react-native-paper": { MD3DarkTheme: base, MD3LightTheme: base },
  });
  const lum = hex => {
    const rgb = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
    return rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const colors of [tokens.lightColors, tokens.darkColors]) {
    const theme = createPaperTheme(colors, true);
    assert.equal(theme.animation.scale, 0);
    assert.equal(theme.fonts.bodyLarge.fontFamily, tokens.fonts.regular);
    for (const [on, background] of [
      ["onPrimary", "primary"], ["onPrimaryContainer", "primaryContainer"],
      ["onSurface", "surface"], ["onSurfaceVariant", "surfaceVariant"], ["onError", "error"],
    ]) assert.ok(contrast(theme.colors[on], theme.colors[background]) >= 4.5, on);
  }
  assert.ok(contrast(tokens.palette.graphite, tokens.palette.orange) >= 4.5);
});

test("Paper shares the existing theme, motion preference and root navigation", () => {
  const root = read("app/_layout.tsx");
  const adapter = read("src/theme/MaterialProvider.tsx");
  assert.equal(root.match(/<MaterialProvider>/g)?.length, 1);
  assert.ok(root.indexOf("<ThemeProvider") < root.indexOf("<MaterialProvider>"));
  assert.match(root, /reduceMotion \? "none" : "fade"/);
  assert.match(adapter, /createPaperTheme\(colors, reduceMotion\)/);
  const radio = read("src/components/ui/RadioChoice.tsx");
  assert.match(radio, /accessibilityRole="radio"/);
  assert.match(radio, /accessibilityState=\{\{ checked, disabled \}\}/);
  assert.match(radio, /minHeight: 56/);
  assert.doesNotMatch(radio, /numberOfLines=/);
});

test("New Order keeps direct-order eligibility, authoritative KYC and the draft submission lock", () => {
  const order = read("app/new-order.tsx");
  assert.match(order, /plant\.order_enabled \?\?/);
  assert.match(order, /plants\.filter\(acceptsOrders\)/);
  assert.match(order, /orderEnabled\) return setError/);
  assert.match(order, /if \(!kycOk\) return startKycFromOrder\(\)/);
  assert.match(order, /submissionInFlight\.current = true/);
  assert.match(order, /id: copy \? null : draftId\.current/);
  const changes = order.slice(order.indexOf("const changeAddress"), order.indexOf("const plants ="));
  assert.ok(changes.includes("placeSelection.current += 1"));
  assert.ok(changes.includes("selection !== placeSelection.current"));
});
