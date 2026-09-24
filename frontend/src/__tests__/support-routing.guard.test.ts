import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(`${process.cwd()}/src/support/routes.ts`, "utf8");
const scripted = readFileSync(`${process.cwd()}/src/support/scriptedSupport.ts`, "utf8");
const screen = readFileSync(`${process.cwd()}/app/support.tsx`, "utf8");
const order = readFileSync(`${process.cwd()}/app/new-order.tsx`, "utf8");
const staff = readFileSync(`${process.cwd()}/app/support-cases.tsx`, "utf8");
const more = readFileSync(`${process.cwd()}/src/screens/StaffMore.tsx`, "utf8");
const widget = readFileSync(`${process.cwd()}/src/support/SupportWidgetBridge.tsx`, "utf8");
const layout = readFileSync(`${process.cwd()}/app/_layout.tsx`, "utf8");

test("support actions route only to existing secure screens", () => {
  for (const route of ["/kyc", "/customer/orders", "/account-deletion", "/plant-onboarding"]) {
    assert.ok(routes.includes(`\"${route}\"`));
  }
  assert.match(routes, /OPEN_TRACKING[\s\S]*owned-id|OPEN_TRACKING/);
  assert.ok(routes.includes('case "OPEN_SECURE_LOGIN_HELP": return null'));
  assert.ok(!routes.includes("http://") && !routes.includes("https://"));
});

test("support categories provide scripted choices and instant answers before typing", () => {
  assert.ok(screen.includes("SCRIPTED_SUPPORT"));
  assert.ok(screen.includes('testID="support-scripted-question"'));
  assert.ok(screen.includes('testID="support-instant-answer"'));
  assert.ok(screen.includes("You do not need to type first"));
  assert.ok(screen.includes('testID="support-solved-yes"'));
  assert.ok(screen.includes('testID="support-solved-no"'));
  assert.ok(screen.includes("Extra details are optional"));
  assert.ok(screen.includes("You can create a support case now without typing anything"));
});

test("scripted support covers common login, KYC, order, tracking, payment, account and onboarding issues", () => {
  for (const text of [
    "OTP not received", "OTP invalid or expired", "KYC pending", "KYC failed",
    "Order still pending", "Plant not responding", "Open live tracking", "Location not updating",
    "Payment failed", "Money deducted but not updated", "Delete my account", "Staff email not approved",
    "Describe another issue",
  ]) assert.ok(scripted.includes(text), `missing scripted option: ${text}`);
  for (const category of ["LOGIN", "KYC", "ORDER", "TRACKING", "PAYMENT", "ACCOUNT_DELETION", "PLANT_ONBOARDING", "GENERAL"]) {
    assert.ok(scripted.includes(`${category}: {`));
  }
});

test("order and tracking scripted answers stay bound to an owned selected order", () => {
  assert.ok(screen.includes("/customer/orders"));
  assert.ok(screen.includes("Choose one of your orders"));
  assert.ok(screen.includes("choice.requiresOrder && !orderId"));
  assert.ok(scripted.includes("requiresOrder: true"));
  assert.ok(screen.includes("order_id: orderId"));
});

test("unresolved scripted guidance escalates safely and can omit free text", () => {
  assert.ok(screen.includes("generatedSupportMessage"));
  assert.ok(screen.includes("scripted guidance did not resolve the issue"));
  assert.ok(screen.includes('testID="support-escalate"'));
  assert.ok(screen.includes("Create Support Case"));
  assert.ok(screen.includes("passwords, OTPs, passkeys, recovery codes or payment credentials"));
});

test("support escalation rotates idempotency only after a successful case request", () => {
  assert.ok(screen.includes("const newEscalationId"));
  const post = screen.indexOf('apiPost<Reply>("/assistant/support"');
  const rotate = screen.indexOf("escalationId.current = newEscalationId()");
  assert.ok(post >= 0 && rotate > post);
});

test("all customer categories and case conversation controls are present", () => {
  for (const category of ["LOGIN", "KYC", "ORDER", "TRACKING", "PAYMENT", "ACCOUNT_DELETION", "PLANT_ONBOARDING", "GENERAL"]) {
    assert.ok(screen.includes(`category: "${category}"`));
  }
  for (const text of ["My Support Cases", "Loading conversation", "Send Reply", "closed for replies", "Related order"]) assert.ok(screen.includes(text));
  assert.ok(screen.includes("/assistant/support/cases/${selectedCaseId}/replies"));
});

test("assisted ordering prepares before requiring explicit confirmation", () => {
  const prepare = order.indexOf('"/assistant/orders/prepare"');
  const confirm = order.indexOf('"/assistant/orders/confirm"');
  assert.ok(prepare >= 0 && confirm > prepare);
  assert.ok(order.includes("This order has not yet been placed"));
  assert.ok(order.includes('label="Confirm Order"'));
  assert.ok(screen.includes("/new-order?assistant=1"));
});

test("legacy support operations remain available to privileged roles until the web move", () => {
  for (const status of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) assert.ok(staff.includes(`"${status}"`));
  for (const text of ["Send Public Reply", "Add Internal Note", "Change status", "Loading support cases", "Unable to update case status"]) assert.ok(staff.includes(text));
  assert.ok(!more.includes('testID="staff-support-cases"'));
  assert.ok(staff.includes('user?.role === "authority" || user?.role === "central_admin"'));
});

test("login help widget stays compact and public issue choices expand before navigation", () => {
  const publicWidget = widget.slice(widget.indexOf('testID="login-help-panel"'));
  assert.ok(layout.includes("<SupportWidgetBridge />"));
  assert.ok(widget.includes('normalizedPath === "/login"'));
  assert.ok(widget.includes("!token && !user"));
  assert.ok(widget.includes("Safe quick help before sign-in"));
  assert.ok(widget.includes("No customer, order, tracking or payment data is available here"));
  assert.ok(widget.includes('type PublicSupportFlow = "login" | "onboarding" | "delete" | null'));
  assert.ok(widget.includes('testID="login-help-onboarding-card"'));
  assert.ok(widget.includes('testID="login-help-delete-card"'));
  assert.ok(widget.includes('testID="login-help-open-onboarding"'));
  assert.ok(widget.includes('testID="login-help-open-delete-account"'));
  assert.ok(widget.includes("/plant-onboarding"));
  assert.ok(widget.includes("/account-deletion-public"));
  assert.ok(!widget.includes("apiPost") && !widget.includes("apiGet"));
  assert.ok(!publicWidget.includes('"/assistant/') && !publicWidget.includes('"/customer/orders'));
});

test("support widget uses a bundled system icon and compact responsive sizing", () => {
  assert.ok(widget.includes('name="chatbubbles-outline"'));
  assert.ok(!widget.includes("support-agent-mascot.png"));
  assert.ok(!widget.includes('from "expo-image"'));
  assert.ok(widget.includes("width: 56"));
  assert.ok(widget.includes("height: 56"));
  assert.ok(widget.includes("compactPanelWidth(viewportWidth)"));
  assert.ok(widget.includes("viewportWidth * 0.72"));
  assert.ok(widget.includes("viewportHeight * 0.42"));
  assert.ok((widget.match(/pointerEvents=\"box-none\"/g) || []).length >= 4);
  assert.ok(widget.includes("insets.top + spacing.sm"));
  assert.ok(widget.includes("flexDirection: \"column-reverse\""));
});

test("authenticated Place Order and Track Delivery expand inside the corner card before navigation", () => {
  assert.ok(widget.includes('Boolean(token) && user?.role === "customer"'));
  assert.ok(widget.includes("CUSTOMER_WIDGET_PATHS.has(normalizedPath)"));
  for (const path of ["/customer", "/customer/orders", "/customer/plants", "/customer/more"]) assert.ok(widget.includes(`\"${path}\"`));
  assert.ok(widget.includes("Math.max(insets.bottom + 104, 120)"));
  assert.ok(widget.includes('testID="customer-support-panel"'));
  assert.ok(widget.includes('accessibilityState={{ expanded: customerHelpOpen }}'));
  assert.ok(widget.includes("setCustomerHelpOpen((value) => !value)"));

  assert.ok(widget.includes('type CustomerSupportFlow = "order" | "tracking" | null'));
  assert.ok(widget.includes('testID="customer-support-place-order"'));
  assert.ok(widget.includes('testID="customer-support-place-order-card"'));
  assert.ok(widget.includes('setCustomerFlow((current) => (current === "order" ? null : "order"))'));
  assert.ok(widget.includes('testID="customer-support-order-grade"'));
  assert.ok(widget.includes('testID="customer-support-order-location"'));
  assert.ok(widget.includes('testID="customer-support-start-assisted-order"'));
  assert.ok(widget.includes('pathname: "/new-order"'));
  assert.ok(widget.includes('assistant: "1"'));

  assert.ok(widget.includes('testID="customer-support-track-delivery"'));
  assert.ok(widget.includes('testID="customer-support-track-delivery-card"'));
  assert.ok(widget.includes('setCustomerFlow((current) => (current === "tracking" ? null : "tracking"))'));
  assert.ok(widget.includes('testID="customer-support-open-orders"'));
  assert.ok(widget.includes('router.push("/customer/orders"'));

  const placeOrderRow = widget.slice(widget.indexOf('testID="customer-support-place-order"'), widget.indexOf('testID="customer-support-place-order-card"'));
  const trackingRow = widget.slice(widget.indexOf('testID="customer-support-track-delivery"'), widget.indexOf('testID="customer-support-track-delivery-card"'));
  assert.ok(!placeOrderRow.includes("router.push"), "Place Order row must expand in-card before navigation");
  assert.ok(!trackingRow.includes("router.push"), "Track Delivery row must expand in-card before navigation");

  assert.ok(widget.includes('testID="customer-support-open-center"'));
  assert.ok(widget.includes('router.push("/support"'));
  assert.ok(!widget.includes('user?.role === "driver"'));
  assert.ok(!widget.includes('user?.role === "admin"'));
  assert.ok(!widget.includes('user?.role === "plant_owner"'));
});
