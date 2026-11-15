const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../../admin-web/node_modules/playwright");

const origin = process.env.ORDER_TEST_ORIGIN || "http://127.0.0.1:8765";
const baseline = process.env.ORDER_BASELINE_PREVIEW === "true";
const output = process.env.ORDER_PREVIEW_DIR || "order-previews";
const longPlantName = "Western Maharashtra Ready-Mix Concrete and Infrastructure Supply";
const plants = [
  { id: "direct", name: longPlantName, city: "Navi Mumbai", verified: true, order_enabled: true, status: "active", grades: ["M30"] },
  { id: "rfq-only", name: "Quotation enquiries only", city: "Pune", verified: true, order_enabled: false, status: "active", grades: ["M30"] },
];

async function enlargeRadioText(radio, multiplier) {
  return radio.evaluate((control, ratio) => {
    const text = [...control.querySelectorAll("div")].filter(el => !el.children.length && el.textContent.trim());
    for (const el of text) {
      const { fontSize, lineHeight } = getComputedStyle(el);
      el.style.fontSize = parseFloat(fontSize) * ratio + "px";
      if (Number.isFinite(parseFloat(lineHeight))) el.style.lineHeight = parseFloat(lineHeight) * ratio + "px";
    }
    const bounds = control.getBoundingClientRect();
    return text.every(el => {
      const box = el.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right + 1
        && box.top >= bounds.top && box.bottom <= bounds.bottom + 1 && el.scrollWidth <= el.clientWidth + 1;
    });
  }, multiplier);
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const previewWidths = [[320, "light"], [360, "dark"], [393, "light"], [412, "dark"], [620, "light"]];
    const cases = baseline ? previewWidths : previewWidths.flatMap(([width]) => [[width, "light"], [width, "dark"]]);
    for (const [width, scheme] of cases) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: scheme });
      const pageErrors = [];
      let plantReads = 0;
      const drafts = [];
      let provisionalRequests = 0;
      let confirmedOrders = 0;
      let showPlantFailure = !baseline && width === 320;
      let draftDetailReads = 0;
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.addInitScript(({ theme }) => {
        localStorage.setItem("tmrmc_token", JSON.stringify("isolated-order-fixture"));
        localStorage.setItem("tmrmc_theme_mode", JSON.stringify(theme));
      }, { theme: scheme });
      await page.route("https://trackmyrmc.com/api/**", async route => {
        const req = route.request();
        const url = new URL(req.url());
        const pathname = url.pathname;
        if (pathname.endsWith("/me")) return route.fulfill({ json: {
          id: "test-customer", role: "customer", roles: ["customer"], status: "active",
          name: "Test Customer", kyc_status: "UNVERIFIED", phone: "9000000000",
        } });
        if (pathname.endsWith("/permission-consent")) return route.fulfill({ json: {
          consent: { version: 1, location_choice: "manual", notification_choice: "manual" },
        } });
        if (pathname.endsWith("/customer/home")) return route.fulfill({ json: {
          name: "Test Customer", kyc_status: "UNVERIFIED", active_order: null,
          recent_orders: [], nearby_plants: [], unread_notifications: 0,
        } });
        if (pathname.endsWith("/customer/plants")) {
          plantReads += 1;
          if (showPlantFailure) return route.fulfill({ status: 503, json: { detail: "Plant list temporarily unavailable" } });
          return route.fulfill({ json: { plants } });
        }
        if (pathname.endsWith("/maps/autocomplete")) {
          return route.fulfill({ json: { success: true, predictions: [
            { place_id: "fixture-place", description: "Synthetic Google Places result" },
          ] } });
        }
        if (pathname.endsWith("/maps/place/fixture-place")) {
          return route.fulfill({ json: { success: true, place_id: "fixture-place",
            address: "20 Synthetic Works, Panvel", lat: 18.998, lng: 73.11 } });
        }
        if (pathname.endsWith("/customer/order-drafts/synthetic-draft") && req.method() === "GET") {
          draftDetailReads += 1;
          return route.fulfill({ json: { id: "synthetic-draft", form: drafts.at(-1)?.form } });
        }
        if (pathname.endsWith("/customer/order-drafts") && req.method() === "GET") {
          return route.fulfill({ json: { drafts: drafts.length ? [{ id: "synthetic-draft", form: drafts.at(-1).form }] : [] } });
        }
        if (pathname.endsWith("/customer/order-drafts") && req.method() === "POST") {
          drafts.push(req.postDataJSON());
          await new Promise(resolve => setTimeout(resolve, 100));
          return route.fulfill({ json: { id: "synthetic-draft" } });
        }
        if (pathname.endsWith("/customer/order-drafts/synthetic-draft/provisional")) {
          provisionalRequests += 1;
          return route.fulfill({ json: { status: "PENDING_KYC" } });
        }
        if (pathname.endsWith("/customer/orders") && req.method() === "POST") confirmedOrders += 1;
        return route.fulfill({ json: {} });
      });

      await page.goto(origin + "/customer/");
      await page.getByTestId("home-order-request").click({ timeout: 15000 }).catch(async error => {
        console.error("Home fixture failed", page.url(), await page.locator("body").innerText(), pageErrors);
        throw error;
      });
      if (showPlantFailure) {
        await page.getByText("The service is temporarily unavailable. Please try again.").waitFor();
        showPlantFailure = false;
        await page.getByRole("button", { name: "Retry", exact: true }).click();
      }

      const plant = page.getByTestId("neworder-plant-direct");
      await plant.waitFor({ timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      if (!baseline) {
        assert.equal(await page.getByTestId("neworder-plant-rfq-only").count(), 0);
        assert.equal(await plant.getAttribute("aria-checked"), "false");
        if (width === 320) assert.equal(plantReads, 2);
      }
      await plant.click();
      await page.getByTestId("grade-M30").click();
      await plant.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `order-${width}-${scheme}.png`) });

      if (!baseline && width <= 360) {
        const scale = width === 320 ? 1.5 : 2;
        const before = await plant.boundingBox();
        assert(await enlargeRadioText(plant, scale), `Order plant content clips at ${scale}× browser text size`);
        assert((await plant.boundingBox()).height > before.height);
        await page.screenshot({ path: path.join(output, `order-${width}-${scheme}-text-${scale * 100}.png`) });
      }

      const payment = page.getByRole("radio", { name: "Pay on Delivery", exact: true });
      await payment.focus();
      await page.keyboard.press("Space");
      if (!baseline) {
        assert.equal(await plant.getAttribute("aria-checked"), "true");
        assert.equal(await payment.getAttribute("aria-checked"), "true");
        const credit = page.getByRole("radio", { name: "Credit / Pay Later", exact: true });
        await page.keyboard.press("ArrowDown");
        assert.equal(await credit.getAttribute("aria-checked"), "true");
        assert.equal(await credit.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press("ArrowUp");
        assert.equal(await payment.getAttribute("aria-checked"), "true");
        assert.equal(await page.getByTestId("neworder-payment-FULL_ADVANCE").count(), 0);
        const paymentBox = await payment.boundingBox();
        assert(paymentBox && paymentBox.height >= 48);
        assert(paymentBox.x >= 0 && paymentBox.x + paymentBox.width <= width + 1);
      }

      if (!baseline && width === 320) {
        const siteName = page.getByTestId("neworder-site");
        await siteName.fill("Synthetic building site");
        await page.getByTestId("neworder-address").fill("10 Test Road");
        await page.getByRole("button", { name: "Use address Synthetic Google Places result" }).click();
        await page.waitForFunction(() => document.querySelector('[data-testid="neworder-address"]')?.value === "20 Synthetic Works, Panvel");
        const provisional = page.getByTestId("neworder-provisional");
        await provisional.evaluate(el => { el.click(); el.click(); });
        await page.waitForURL(/customer\/orders/);
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].form.plant_id, "direct");
        assert.equal(drafts[0].form.grade, "M30");
        assert.equal(drafts[0].form.address, "20 Synthetic Works, Panvel");
        assert.equal(drafts[0].form.lat, 18.998);
        assert.equal(drafts[0].form.lng, 73.11);
        assert.equal(drafts[0].form.payment_mode, "ON_DELIVERY");
        assert.equal(provisionalRequests, 1);
        assert.equal(confirmedOrders, 0);
      }
      if (!baseline && width === 360) {
        await page.getByTestId("neworder-site").fill("Saved synthetic site");
        await page.getByTestId("neworder-address").fill("10 saved test road");
        await page.getByTestId("neworder-draft").click();
        await page.waitForURL(/customer\/orders/);
        await page.getByText("Saved synthetic site", { exact: true }).click();
        await page.getByTestId("neworder-site").waitFor();
        assert.equal(draftDetailReads, 1);
        assert.equal(await page.getByTestId("neworder-site").inputValue(), "Saved synthetic site");
        assert.equal(await page.getByTestId("neworder-address").inputValue(), "10 saved test road");
        await page.getByTestId("neworder-place").click();
        await page.waitForURL(url => url.pathname.endsWith("/kyc") && url.searchParams.get("draftId") === "synthetic-draft");
        assert.equal(drafts.at(-1).id, "synthetic-draft");
        assert.equal(confirmedOrders, 0);
      }
      assert.deepEqual(pageErrors, []);
      console.log(`PASS ${width}px ${scheme}${baseline ? " baseline preview" : " direct plants, keyboard payment and bounds"}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
