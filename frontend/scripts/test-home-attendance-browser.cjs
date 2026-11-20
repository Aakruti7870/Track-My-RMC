const assert = require("node:assert/strict");
const { assertHomeCardRow } = require("./assert-home-card-row.cjs");
const { chromium } = require("../../admin-web/node_modules/playwright");

const origin = "http://127.0.0.1:8765";
const roles = [
  ["plant_owner", "owner", "Plant Owner"], ["owner", "owner", "Plant Owner"],
  ["admin", "plant-admin", "Plant Admin"],
  ["dispatcher", "dispatcher", "Dispatcher"], ["operator", "operator", "Plant Operator"],
  ["supervisor", "supervisor", "Supervisor"], ["accountant", "accountant", "Accountant"],
  ["quality_engineer", "quality_engineer", "Quality Engineer"], ["fleet_manager", "fleet_manager", "Fleet Manager"],
  ["store_manager", "store_manager", "Store Manager"], ["driver", "driver", "Driver"],
];
const grants = [
  "dispatch_queue", "fleet_availability", "production_queue", "incidents", "billing_ledger",
  "quality_register", "driver_roster", "material_inventory", "rate_cards", "mix_designs",
  "suppliers", "purchases", "diesel_ledger", "quotations", "expenses", "payroll",
  "plant_reports", "workforce", "employee_master",
];
const dispatcherGrants = ["dispatch_queue", "fleet_availability", "challan_gate_pass", "material_inventory"];
const plant = { id: "fixture-plant", name: "Fixture Plant" };
const coordinates = { latitude: 19.02, longitude: 73.11 };
const start = "2026-11-20T04:00:00Z";
const end = "2026-11-20T10:00:00Z";

async function visitRole(browser, [role, routeName, label], scheme) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 920 }, colorScheme: scheme, reducedMotion: "reduce",
    geolocation: coordinates, permissions: ["geolocation"], serviceWorkers: "block",
  });
  try {
    await context.addInitScript(theme => {
      localStorage.setItem("tmrmc_token", JSON.stringify("isolated-attendance-fixture"));
      localStorage.setItem("tmrmc_theme_mode", JSON.stringify(theme));
    }, scheme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const driver = role === "driver";
    const owner = role === "plant_owner" || role === "owner";
    const readPath = driver ? "/driver/attendance" : "/workforce/me";
    const inPath = driver ? "/driver/attendance/checkin" : "/workforce/attendance/punch-in";
    const outPath = driver ? "/driver/attendance/checkout" : "/workforce/attendance/punch-out";
    const writes = [];
    let attendanceReads = 0;
    let times = { check_in: null, check_out: null };
    let failWrite = role === "dispatcher" && scheme === "dark";
    const requestFailureCase = failWrite;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const pathname = url.pathname.replace(/^\/api/, "");
      const reply = json => route.fulfill({ json });
      if (pathname === "/me") return reply({
        id: "test-" + role, name: "Fixture " + label, role, role_label: label, roles: [role],
        status: "active", plant_id: plant.id, kyc_status: "verified",
      });
      if (pathname === "/permission-consent") return reply({ consent: {
        version: 1, location_choice: "manual", notification_choice: "manual",
      } });
      if (pathname === "/maps/geocode") return reply({ locality: "Fixture Location" });
      if (pathname === readPath) {
        attendanceReads += 1;
        if (driver) return reply(times);
        const attendance = times.check_in ? times : null;
        const activity = url.searchParams.get("include_activity") === "true"
          ? { attendance_history: [{ id: "fixture-attendance", date: "2026-11-20", ...times }],
            leave_requests: [], client_visits: [], expense_claims: [] } : undefined;
        return reply({ attendance, activity });
      }
      if (pathname === "/workforce/owner/control") return reply({
        mode: "owner_control", plant_ids: [plant.id],
        attendance: [{ id: "staff-entry", date: "2026-11-20", user_name: "Fixture Dispatcher", role: "dispatcher", check_in: start, check_out: end }],
        leave_requests: [], client_visits: [], expense_claims: [],
      });
      if (pathname === inPath || pathname === outPath) {
        assert.equal(route.request().method(), "POST");
        const checkIn = pathname === inPath;
        assert.equal(checkIn, !times.check_in);
        assert.deepEqual(route.request().postDataJSON(), { lat: coordinates.latitude, lng: coordinates.longitude });
        writes.push(pathname);
        if (failWrite) {
          failWrite = false;
          return route.fulfill({ status: 503, json: { detail: "Fixture retry" } });
        }
        times = checkIn ? { check_in: start, check_out: null } : { ...times, check_out: end };
        return reply({ success: true });
      }
      if (pathname === "/driver/home") return reply({ name: "Fixture Driver", active_trip: null, checked_in: !!times.check_in && !times.check_out, completed_today: 0 });
      if (pathname === "/driver/identity") return reply({
        driver_name: "Fixture Driver", plant_name: plant.name, employment: { employee_id: "EMPLOYEE-FIXTURE" },
      });
      if (pathname === "/staff/home") return reply({
        name: "Fixture " + label, role, role_label: label, plant_name: plant.name,
        primary: { title: "Workspace", kind: "dispatch" },
        kpis: [
          { label: "Staff Present Today", value: 3, icon: "people-outline" },
          { label: "Pending Orders", value: 2, icon: "cube-outline" },
          { label: "Fleet Available", value: 1, icon: "bus-outline" },
        ],
      });
      if (pathname === "/master/my-plants") return reply({ plants: [plant] });
      if (pathname === "/staff/module-permissions") return reply({
        plant_id: plant.id, permissions: (role === "dispatcher" ? dispatcherGrants : grants).map(key => ({ key, view: true })),
      });
      if (pathname === "/plant-operations/fixture-plant/pipeline") return reply({ counts: {}, total: 0, loads: [] });
      return reply({});
    });
    await page.goto(origin + "/" + routeName + "/");
    const card = page.getByTestId("home-attendance-card");
    if (owner) {
      await page.getByTestId("owner-quick-access").waitFor();
      assert.equal(await card.count(), 0);
      assert.equal(await page.getByRole("button", { name: /^check (in|out)$/i }).count(), 0);
      await page.route(origin + "/workforce", route => route.continue({ url: origin + "/workforce.html" }));
      await page.goto(origin + "/workforce");
      await page.getByText("Workforce Control", { exact: true }).waitFor();
      await page.getByText("Fixture Dispatcher", { exact: true }).waitFor();
      await page.getByText("Leave approvals", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /^check (in|out)$/i }).count(), 0);
      assert.equal(attendanceReads, 0);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${role} ${scheme}: staff attendance and approvals with no personal attendance controls`);
      return;
    }
    const checkIn = card.getByRole("button", { name: "Check In", exact: true });
    const checkOut = card.getByRole("button", { name: "Check Out", exact: true });
    const top = page.getByTestId(driver ? "driver-identity-card" : "staff-home-hero-banner");
    const quick = page.getByTestId(driver ? "home-modules-driver-quick-access" : "home-modules-quick-access");
    await card.getByText("Ready to check in", { exact: true }).waitFor();
    await quick.waitFor();
    if (role === "dispatcher") {
      const cards = await quick.locator('[data-testid^="role-module-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
      assert.deepEqual(cards, ["role-module-business-inventory", "role-module-shift-roster", "role-module-workforce"]);
      assert.equal(await page.getByTestId("staff-home-scroll").locator('[data-testid^="home-modules-"]').count(), 1);
    }
    assert.equal(await card.count(), 1);
    assert(await checkIn.isEnabled());
    assert(await checkOut.isDisabled());
    assert.deepEqual(writes, []);
    const ratios = await card.evaluate(element => {
      const luminance = color => color.match(/[0-9.]+/g).slice(0, 3).reduce((total, component, index) => {
        const value = Number(component) / 255;
        return total + [0.2126, 0.7152, 0.0722][index] *
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      }, 0);
      return Array.from(element.querySelectorAll('[role="heading"], h1, h2, [data-testid="home-attendance-status"], [role="button"]')).map(item => {
        const isButton = item.getAttribute("role") === "button";
        const base = getComputedStyle(isButton ? item : element).backgroundColor;
        const ink = getComputedStyle(isButton ? item.querySelector(':scope > div > div:last-child') : item).color;
        const values = [luminance(base), luminance(ink)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
      });
    });
    assert(ratios.length === 4 && ratios.every(ratio => ratio >= 4.5), role + " contrast " + scheme + ": " + ratios.join(", "));

    for (const [width, height] of [[280, 760], [320, 800], [360, 800], [390, 920], [667, 375], [768, 900], [1024, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const [topBounds, cardBounds, quickBounds] = await Promise.all([top.boundingBox(), card.boundingBox(), quick.boundingBox()]);
      assert(cardBounds.x >= 0 && cardBounds.x + cardBounds.width <= width + 1, role + " card overflows at " + width);
      assert(topBounds.y + topBounds.height <= cardBounds.y + 1 && cardBounds.y + cardBounds.height <= quickBounds.y + 1, role + " misplaced attendance at " + width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), role + " page overflows at " + width);
      for (const button of [checkIn, checkOut]) {
        assert((await button.boundingBox()).height >= 44);
        assert(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 2), role + " attendance label overflows at " + width);
      }
      const row = quick.getByTestId(driver ? "home-module-row-driver-quick-access" : "home-module-row-quick-access");
      await assertHomeCardRow(row, { shouldOverflow: width >= 768 ? false : undefined });
      const otherRows = page.locator('[data-testid^="home-module-row-"], [data-testid="staff-home-kpi-row"], [data-testid="staff-home-plant-records-row"], [data-testid="plant-home-actions-row"], [data-testid="driver-home-stats-row"], [data-testid="home-load-pipeline-row"]').and(page.locator(':not([data-testid$="-quick-access"])'));
      for (const otherRow of await otherRows.all()) {
        await assertHomeCardRow(otherRow, { shouldOverflow: width >= 768 ? false : undefined });
      }
    }

    await page.setViewportSize({ width: 390, height: 920 });
    await checkIn.click();
    const disclosure = page.getByText("Use location for attendance?", { exact: true });
    await disclosure.waitFor();
    assert.deepEqual(writes, []);
    await page.getByTestId("bg-location-deny").click();
    await page.getByText("Location permission is required for this action.", { exact: true }).waitFor();
    assert.deepEqual(writes, []);
    await checkIn.click();
    await page.getByTestId("bg-location-allow").click();
    if (requestFailureCase) {
      await page.getByText("The service is temporarily unavailable. Please try again.", { exact: true }).waitFor();
      await checkIn.click();
      await page.getByTestId("bg-location-allow").click();
    }
    await card.getByText("Checked in", { exact: true }).waitFor();
    assert(await checkIn.isDisabled());
    await checkOut.click();
    await page.getByTestId("bg-location-allow").click();
    await card.getByText("Shift complete", { exact: true }).waitFor();
    assert(await checkOut.isDisabled());
    assert.deepEqual(writes, requestFailureCase ? [inPath, inPath, outPath] : [inPath, outPath]);
    if (role === "dispatcher" && scheme === "light") {
      await page.route(origin + "/workforce", route => route.continue({ url: origin + "/workforce.html" }));
      await page.goto(origin + "/workforce");
      await page.getByText("Attendance history", { exact: true }).waitFor();
      await page.getByText("2026-11-20", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /^(check|punch) (in|out)/i }).count(), 0);
    }
    if (driver && scheme === "light") {
      await page.getByTestId("driver-shortcut-driver-attendance").click();
      await page.waitForURL(url => url.pathname === "/driver/shift-attendance");
      const record = page.getByTestId("driver-shift-attendance-record");
      await record.getByText("Shift complete", { exact: true }).waitFor();
      await record.getByText("Check in and out from Home.", { exact: true }).waitFor();
      assert.equal(await record.getByRole("button", { name: /^(check|punch) (in|out)/i }).count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${role} ${scheme}: responsive Home, consent, persisted check-in and check-out`);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    for (const role of roles) {
      for (const theme of ["light", "dark"]) await visitRole(browser, role, theme);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
