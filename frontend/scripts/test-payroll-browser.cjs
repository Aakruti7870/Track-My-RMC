const assert = require("node:assert/strict");
const { chromium } = require("../../admin-web/node_modules/playwright");

const origin = "http://127.0.0.1:8765";
const plant = "10000000-0000-4000-8000-000000000001";
const employee = "10000000-0000-4000-8000-000000000002";

async function run() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("tmrmc_token", JSON.stringify("isolated-payroll-fixture")));
    await page.route(url => url.origin === origin && url.pathname === "/business/payroll",
      route => route.continue({ url: origin + "/business/%5Bkind%5D.html" }));
    let role = "accountant";
    let allowLaterReport;
    const laterReport = new Promise(resolve => { allowLaterReport = resolve; });
    const drafts = [];
    const reports = [];
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/me") return route.fulfill({
        json: { id: "payroll-fixture", name: "Fixture", role, roles: [role], status: "active" },
      });
      if (url.pathname.startsWith("/api/workforce-reports/monthly/")) {
        const month = url.pathname.split("/").at(-1);
        reports.push({ month, plant: url.searchParams.get("plant_id"), payroll: url.searchParams.get("payroll_only") });
        if (month === "2028-03") await laterReport;
        return route.fulfill({ json: { month, reports: [{
          plant_id: plant, plant_name: `Payroll Plant ${month}`, month, calendar_days: 29, employee_count: 1,
          present_records: 2, completed_shift_records: 1, open_shift_records: 1, approved_leave_days: 1,
          completed_client_visits: 1, approved_expenses: 52.5, payroll_total: 1125.5,
          payroll_visible: true, payroll_editable: role === "accountant", payroll_note: "Stored evidence",
          employees: [{ user_id: employee, user_name: "Fixture Employee", role: "operator", attendance_days: 2,
            completed_shifts: 1, open_shifts: 1, attendance_hours: 6.5, approved_leave_days: 1,
            completed_client_visits: 1, approved_expenses: 52.5,
            payroll: { id: "draft", status: "DRAFT", basic_amount: 1000, overtime_amount: 125.5, paid_days: 1.5, notes: "Original note" },
          }],
        }] } });
      }
      if (url.pathname.endsWith("/draft")) {
        drafts.push({ url: url.pathname, amount: request.postDataJSON().basic_amount });
        if (drafts.length === 1) return route.fulfill({ status: 400, json: { detail: "Fixture draft failed" } });
        return route.fulfill({ json: { success: true } });
      }
      if (url.pathname === "/api/permission-consent") return route.fulfill({
        json: { consent: { version: 1, location_choice: "manual", notification_choice: "manual" } },
      });
      return route.fulfill({ json: {} });
    });
    await page.goto(origin + "/business/payroll?plantId=" + plant);
    await page.waitForURL("**/workforce-reports?*");
    const month = page.getByRole("textbox", { name: "Month", exact: true });
    await month.fill("2028-02");
    await page.getByText("Payroll Plant 2028-02", { exact: true }).waitFor();
    assert.deepEqual(reports.at(-1), { month: "2028-02", plant, payroll: "true" });
    await page.getByText("6.5", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Edit Payroll Draft" }).click();
    const amount = page.getByRole("textbox", { name: "Basic amount" });
    await amount.fill("1050");
    const save = page.getByRole("button", { name: "Save Draft for Owner Approval" });
    await save.click();
    await page.getByText("Fixture draft failed", { exact: true }).waitFor();
    assert.equal(await amount.inputValue(), "1050");
    await save.click();
    await amount.waitFor({ state: "hidden" });
    const expected = { url: `/api/workforce-reports/plants/${plant}/payroll/2028-02/${employee}/draft`, amount: 1050 };
    assert.deepEqual(drafts, [expected, expected]);

    await month.fill("2028-03");
    await page.getByText("Payroll Plant 2028-02", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Edit Payroll Draft" }).count(), 0);
    allowLaterReport();
    await page.getByText("Payroll Plant 2028-03", { exact: true }).waitFor();

    role = "owner";
    await page.goto(origin + "/business/payroll?plantId=" + plant);
    await page.getByRole("button", { name: "Approve", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Edit Payroll Draft" }).count(), 0);
    console.log("PASS: Payroll card redirect, plant scope, failed draft retry, month switch and owner approval");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
