const assert = require("node:assert/strict");
const { chromium } = require("../../admin-web/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    for (const [width, colorScheme] of [[320, "dark"], [620, "light"]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      await page.addInitScript(scheme => {
        localStorage.setItem("tmrmc_token", JSON.stringify("driver-browser-fixture"));
        localStorage.setItem("tmrmc_theme_mode", JSON.stringify(scheme));
      }, colorScheme);
      const site = "Synthetic delivery location for the outer ring commercial site loading gate";
      await page.route("https://trackmyrmc.com/api/**", route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith("/me")) return route.fulfill({ json: {
          id: "test-driver", role: "driver", roles: ["driver"], name: "Fixture driver", status: "active",
        } });
        if (pathname.endsWith("/permission-consent")) return route.fulfill({ json: { consent: { version: 1, location_choice: "manual", notification_choice: "manual" } } });
        if (pathname.endsWith("/driver/trips")) return route.fulfill({ json: { trips: [
          { id: "trip-fixture", order_number: "FIXTURE-DRIVER-SITE-001", status: "EN_ROUTE", grade: "M30", quantity: 8, tm_number: "TM01", site_name: site },
          { id: "delivered-fixture", order_number: "FIXTURE-DELIVERED-002", status: "DELIVERED", grade: "M30", quantity: 8, tm_number: "TM01", site_name: "Earlier site" },
        ] } });
        if (pathname.endsWith("/driver/identity")) return route.fulfill({ json: {
          driver_name: "Fixture driver", employment: { employee_id: "SYNTHETIC-DRIVER" },
        } });
        if (pathname.endsWith("/driver/home")) return route.fulfill({ json: { name: "Fixture driver", active_trip: null, checked_in: false, completed_today: 0 } });
        return route.fulfill({ json: {} });
      });
      await page.goto("http://127.0.0.1:8765/driver/");
      await page.getByRole("tab", { name: "Trips tab", exact: true }).click();
      const card = page.getByTestId("trip-card-FIXTURE-DRIVER-SITE-001");
      await card.waitFor();
      assert.equal(await card.getAttribute("role"), "button");
      const siteText = card.getByText(site, { exact: true });
      const bounds = await siteText.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
      const delivered = page.getByTestId("trip-filter-delivered");
      assert((await delivered.boundingBox()).height >= 48);
      await delivered.focus();
      await page.keyboard.press("Space");
      assert.equal(await delivered.getAttribute("aria-pressed"), "true");
      await page.getByTestId("trip-card-FIXTURE-DELIVERED-002").waitFor();
      assert.equal(await card.count(), 0);
      await page.close();
      console.log(`PASS driver trips ${width}px ${colorScheme}: long site, 48px filters, keyboard selection and status filtering`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
