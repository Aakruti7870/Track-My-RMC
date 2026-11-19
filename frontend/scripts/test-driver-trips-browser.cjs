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
          driver_name: "Fixture driver with a long full name",
          plant_name: "Synthetic Ready Mix Concrete and Aggregates Plant",
          blood_group: "O+",
          tm_number: "SYNTHETIC-TRANSIT-MIXER-001",
          driving_licence_number: "MH042026123456789123",
          driving_licence_valid_until: "2031-08-12",
          emergency_contact_1: { name: "Long Emergency Contact Name", phone: "+919000000001" },
          emergency_contact_2: null,
          employment: {
            employee_id: "SYNTHETIC-DRIVER",
            company_joining_date: "2020-07-15",
            total_driving_experience_display: "6 years, 4 months",
          },
        } });
        if (pathname.endsWith("/driver/home")) return route.fulfill({ json: { name: "Fixture driver", active_trip: null, checked_in: false, completed_today: 0 } });
        return route.fulfill({ json: {} });
      });
      await page.goto("http://127.0.0.1:8765/driver/");
      const identity = page.getByTestId("driver-identity-card");
      const artwork = identity.getByTestId("driver-identity-background");
      await artwork.locator("img").waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-testid="driver-identity-background"] img')]
          .some(image => image.complete && image.naturalWidth > 0)
      );
      assert.equal(await page.getByTestId("driver-home-plant-banner").count(), 0);
      const details = identity.getByTestId("driver-identity-full-details");
      for (const value of [
        "Fixture driver with a long full name", "SYNTHETIC-TRANSIT-MIXER-001",
        "Synthetic Ready Mix Concrete and Aggregates Plant", "O+", "MH042026123456789123",
        "12/08/2031", "Long Emergency Contact Name · +919000000001", "Not provided",
        "SYNTHETIC-DRIVER", "15/07/2020", "6 years, 4 months",
      ]) {
        await identity.getByText(value, { exact: true }).waitFor();
      }
      for (const [screenWidth, columns] of [[320, 1], [360, 2], [390, 2], [768, 3], [1440, 3]]) {
        await page.setViewportSize({ width: screenWidth, height: 900 });
        await page.waitForFunction(expected => {
          const fields = [...document.querySelectorAll('[data-testid="driver-identity-full-details"] > div:first-child > div')];
          const firstRow = fields[0]?.getBoundingClientRect().top;
          return fields.length === 9 &&
            fields.filter(field => field.getBoundingClientRect().top === firstRow).length === expected;
        }, columns);
        const bounds = await identity.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= screenWidth);
        assert(bounds.width <= 1120);
        assert(Math.abs(bounds.x - (screenWidth - bounds.x - bounds.width)) < 2);
        assert(await details.locator(":scope > div:first-child > div").evaluateAll(fields =>
          fields.every(field => field.scrollWidth <= field.clientWidth + 1)
        ));
        console.log(`PASS driver card ${screenWidth}px ${colorScheme}: artwork, ${columns} column(s), all records, no field overflow`);
      }
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId("plant-home-supplier-enquiry").waitFor();
      await page.getByTestId("plant-home-profile").waitFor();
      const more = page.getByTestId('tab-more');
      await more.click();
      await page.waitForURL(/\/driver\/more\/?$/);
      await more.click({ clickCount: 3 });
      assert.equal(await more.getAttribute('aria-selected'), 'true');
      await page.getByTestId('tab-home').click();
      await page.getByTestId("home-see-all-driver-workforce").click();
      const workforce = page.getByTestId("role-modules-page");
      await workforce.getByTestId("role-module-my-payslip").waitFor();
      assert.equal(await workforce.getByTestId("role-module-driver-attendance").count(), 1);
      await page.getByTestId("role-modules-back").click();
      await page.getByTestId("home-see-all-driver-trips").click();
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
