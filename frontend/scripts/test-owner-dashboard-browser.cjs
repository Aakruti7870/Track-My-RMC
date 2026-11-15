// Isolated browser fixtures only. No production credentials or app-side mock path.
const { chromium } = require(process.env.OWNER_PLAYWRIGHT_MODULE || '../../admin-web/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.OWNER_PREVIEW_DIR || 'owner-previews';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.OWNER_CHROMIUM_PATH ? { executablePath: process.env.OWNER_CHROMIUM_PATH } : {}) });
  try {
    for (const [scheme, width] of [['light', 390], ['dark', 390], ['light', 320], ['light', 768], ['light', 1440]]) {
      const context = await browser.newContext({ viewport: { width, height: 920 } });
      await context.addInitScript(({ scheme }) => {
        localStorage.setItem('tmrmc_token', JSON.stringify('isolated-owner-browser-test'));
        localStorage.setItem('tmrmc_theme_mode', JSON.stringify(scheme));
      }, { scheme });
      const page = await context.newPage(), errors = [];
      let populated = false, failing = false;
      let supplierFixture = false;
      const supplierRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        let json = {};
        if (path.endsWith('/me')) json = { id: 'isolated-owner', name: 'TrackMyRMC Play Review Owner', role: 'plant_owner', roles: ['plant_owner'], status: 'active', kyc_status: 'pending', plant_id: null };
        else if (path.endsWith('/owner/home')) json = { plant_count: 0, plants: [], cards: { todays_orders: 0, dispatched_loads: 0, active_staff: 0, pending_approvals: 0 }, pending_orders: [] };
        else if (path.endsWith('/notifications')) json = { unread: 2, items: [] };
        else if (path.endsWith('/master/my-plants')) json = { plants: supplierFixture ? [{ id: 'plant-one', name: 'Fixture Plant', city: 'Panvel' }] : [] };
        else if (path.endsWith('/plant-profile/plant-one/editor')) return route.fulfill({ status: 403, json: { message: 'No edit grant' } });
        else if (path.endsWith('/plant-profile/plant-one')) json = { plant_name: 'Fixture Plant', sections: [], documents: [] };
        else if (path.endsWith('/staff/supplier-enquiries')) {
          supplierRequests.push(route.request().postDataJSON());
          if (supplierRequests.length === 1) return route.fulfill({ status: 503, json: { message: 'Fixture retry' } });
          return route.fulfill({ status: 201, json: { success: true, id: 'isolated-enquiry', status: 'NEW' } });
        }
        else if (/\/owner\/orders\/[0-9a-f-]+$/.test(path)) return route.fulfill({ status: 404, json: { message: 'Isolated detail navigation fixture' } });
        else if (path.endsWith('/owner/orders')) {
          if (failing) return route.fulfill({ status: 503, json: { message: 'Isolated network failure' } });
          json = { orders: populated ? [{ id: '00000000-0000-0000-0000-000000000001', order_number: 'TEST-OWNER-001', customer_name: 'Isolated browser fixture', plant_name: 'Test plant', site_name: 'Test project site', site_address: 'Test address', grade: 'M25', quantity: 6, delivery_date: '2026-10-19', status: 'PENDING', payment_status: 'UNPAID' }] : [], has_more: false };
        }
        await route.fulfill({ json });
      });
      const go = async path => { await page.goto('http://127.0.0.1:8765/owner/'); await page.getByTestId('operational-theme').waitFor(); { const tab = path.includes('directory=1') ? 'more' : path.split('/')[2]; if (tab) await page.getByTestId(`tab-${tab}`).click(); } await page.waitForTimeout(250); };
      const visibleModuleKeys = new Set();
      for (const name of ['home', 'orders', 'operations', 'more']) {
        await go('/owner' + (name === 'home' ? '' : '/' + name));
        const tab = page.getByTestId(`tab-${name}`);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByText('TrackMyRMC Play Review Owner', { exact: true }).count(), 0);
        if (name === 'home') {
          const summary = await page.getByTestId('owner-home-summary').evaluate(el => getComputedStyle(el).backgroundColor);
          assert.equal(summary, scheme === 'dark' ? 'rgb(26, 31, 38)' : 'rgb(255, 255, 255)');
          const card = await page.locator('[data-testid^="owner-metric-"]').first().locator(':scope > div').first()
            .evaluate(el => getComputedStyle(el).backgroundColor);
          assert.equal(card, summary, 'Owner KPI cards share the matte surface');
          assert.equal(await page.locator('[data-testid^="owner-shortcut-"]').count(), 5);
          assert.equal(await page.locator('[data-testid^="owner-metric-"]').count(), 8);
          assert.equal(await page.getByTestId('home-modules-owner-commercial').locator('[data-testid^="role-module-"]').count(), 4);
          assert.equal(await page.getByTestId('home-modules-owner-workforce').locator('[data-testid^="role-module-"]').count(), 4);
          assert.equal(await page.getByTestId('role-module-payroll-closure').count(), 0);
          assert.equal(await page.getByTestId('role-module-owner-drivers').count(), 1);
          const hero = page.getByTestId('owner-home-hero-banner');
          const fixed = page.getByTestId('owner-home-scroll-fixed');
          await fixed.getByTestId('plant-home-supplier-enquiry').waitFor();
          await fixed.getByTestId('owner-quick-access').waitFor();
          const scroll = page.getByTestId('owner-home-scroll');
          const profile = scroll.getByTestId('plant-home-profile');
          assert.equal(await profile.count(), 1, 'Owner profile remains in the scroll area');
          if (width === 390) {
            await page.setViewportSize({ width, height: 760 });
            await fixed.getByTestId('plant-home-supplier-enquiry').waitFor();
            const movement = await scroll.evaluate(node => {
              const profile = node.querySelector('[data-testid="plant-home-profile"]');
              const supplier = document.querySelector('[data-testid="plant-home-supplier-enquiry"]');
              const profileTop = profile.getBoundingClientRect().top;
              const supplierTop = supplier.getBoundingClientRect().top;
              node.scrollTop = 100;
              return { offset: node.scrollTop, profile: profile.getBoundingClientRect().top - profileTop,
                supplier: supplier.getBoundingClientRect().top - supplierTop };
            });
            assert(movement.offset > 0 && movement.profile < 0, 'Owner profile scrolls with the dashboard');
            assert.equal(movement.supplier, 0, 'Owner supplier enquiry stays fixed');
            await page.setViewportSize({ width, height: 920 });
            await scroll.evaluate(node => { node.scrollTop = 0; });
          }
          const order = await page.evaluate(() => {
            const supplier = document.querySelector('[data-testid="plant-home-supplier-enquiry"]');
            const profile = document.querySelector('[data-testid="plant-home-profile"]');
            const kpi = document.querySelector('[data-testid="owner-metric-todays_orders"]');
            return supplier.compareDocumentPosition(profile) & profile.compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING;
          });
          assert(await hero.evaluate(node => node.getBoundingClientRect().width >= 280), 'Plant image spans the home card');
          assert(order, 'Supplier and profile cards sit above the KPI grid in the requested order');
        }
        if (name === 'operations') assert.equal(await page.getByTestId('owner-operations-module-directory').locator('[data-testid^="role-module-"]').count(), 8);
        if (name === 'more') {
          assert.equal(await page.getByTestId('role-module-directory').locator('[data-testid^="role-module-"]').count(), 4);
          assert.equal(await page.getByText('Appearance', { exact: true }).count(), 0);
          assert.equal(await page.getByTestId('owner-staff-module-access').count(), 1);
          assert.equal(await page.getByTestId('owner-permission-settings').count(), 1);
        }
        if (name !== 'orders') {
          const shortcutIds = name === 'home'
            ? await page.locator('[data-testid^="owner-shortcut-"]:not([data-testid="owner-shortcut-insights"])')
              .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid').replace('owner-shortcut-', '')))
            : [];
          const moduleSurface = name === 'operations' ? page.getByTestId('owner-operations-module-directory')
            : name === 'more' ? page.getByTestId('role-module-directory')
            : page;
          const moduleIds = await moduleSurface.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])')
            .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid').replace('role-module-', '')));
          for (const key of [...shortcutIds, ...moduleIds]) {
            assert(!visibleModuleKeys.has(key), `Duplicate owner module ${key} across tabs at ${width}px`);
            visibleModuleKeys.add(key);
          }
        }
        if (name === 'home') {
          const heights = await page.locator('[data-testid^="owner-shortcut-"]:not([data-testid="owner-shortcut-insights"])').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
          assert(heights.every(height => height >= 80 && height <= 135), `Owner shortcut card outside compact range at ${width}px: ${heights}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
        await page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png`, animations: 'disabled' });
      }
      assert.equal(visibleModuleKeys.size, 25, 'Owner Home exposes compact previews alongside the existing Operations and More destinations');
      await go('/owner');
      if (width === 390) {
        supplierFixture = true;
        await page.getByTestId('plant-home-profile').click();
        await page.getByText('Fixture Plant · TrackMyRMC', { exact: true }).waitFor();
        await page.getByText('Contact your Plant Owner to request editing access.').waitFor();
        await page.getByText('Back', { exact: true }).click();
        await page.getByTestId('plant-home-supplier-enquiry').click();
        const form = page.getByTestId('supplier-enquiry-form');
        await form.getByRole('button', { name: 'Submit Enquiry' }).click();
        await page.getByText('Select at least one material.').waitFor();
        await form.getByTestId('supplier-material-dropdown').click();
        assert.equal(await form.getByRole('checkbox').count(), 7);
        for (const material of ['OPC Cement', 'Aggregate', 'Fly Ash']) {
          await form.getByRole('checkbox', { name: material, exact: true }).click();
        }
        assert(await form.getByRole('checkbox', { name: 'PPC Cement', exact: true }).isDisabled());
        await form.getByTestId('supplier-material-dropdown').click();
        await form.getByRole('textbox', { name: 'Contact phone' }).fill('+919876543210');
        await form.getByRole('textbox', { name: 'Delivery location' }).fill('Fixture delivery address');
        await form.getByRole('button', { name: /Required delivery date/ }).click();
        await page.getByRole('button', { name: /^20\d\d-\d\d-\d\d$/ }).last().click();
        await form.getByRole('button', { name: 'Submit Enquiry' }).click();
        await page.getByText('The service is temporarily unavailable. Please try again.', { exact: true }).waitFor();
        await form.getByRole('button', { name: 'Submit Enquiry' }).click();
        await page.getByTestId('supplier-enquiry-success').waitFor();
        assert.deepEqual(supplierRequests[0], supplierRequests[1], 'Retry reuses the submitted payload and request key');
        assert.deepEqual(supplierRequests[0].materials, ['OPC Cement', 'Aggregate', 'Fly Ash']);
        assert.equal(supplierRequests[0].plant_id, 'plant-one');
        await page.getByRole('button', { name: 'Done' }).click();
        await page.getByTestId('owner-home-summary').waitFor();
        supplierFixture = false;
      }
      for (const [category, key, count] of [['Commercial','owner-commercial',7],['Workforce','owner-workforce',9]]) {
        await page.getByTestId('home-see-all-' + key).click();
        await page.getByRole('heading', { name: category, exact: true }).waitFor();
        const directory = page.getByTestId('role-modules-page');
        assert.equal(await directory.locator('[data-testid^="role-module-"]').count(), count);
        if (category === 'Workforce') {
          await directory.getByTestId('role-module-payroll-closure').waitFor();
          await directory.getByTestId('role-module-business-attendance').waitFor();
        }
        await page.getByTestId('role-modules-back').click();
        await page.getByTestId('owner-home-summary').waitFor();
      }
      await go('/owner');
      const homeUrl = page.url();
      await page.getByTestId('tab-quick-actions').click();
      await page.getByRole('button', { name: 'Review Pending Orders', exact: true }).waitFor();
      assert.equal(page.url(), homeUrl);
      assert.equal(await page.getByTestId('tab-home').getAttribute('aria-selected'), 'true');
      await page.getByRole('button', { name: 'Review Pending Orders', exact: true }).click();
      await page.waitForFunction(() => location.search.includes('status=pending'));
      await page.getByTestId('owner-filter-processing').click();
      await page.waitForFunction(() => location.search.includes('status=processing'));
      const searchRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname.endsWith('/owner/orders') && url.searchParams.get('q') === 'Site literal %'
          && url.searchParams.get('status') === 'processing' && url.searchParams.get('limit') === '30';
      });
      await page.getByTestId('owner-order-search').fill('Site literal %');
      await searchRequest;
      await page.getByRole('button', { name: 'Order filters', exact: true }).click();
      await page.getByRole('textbox', { name: 'Concrete grade', exact: true }).fill('M25');
      const filterRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname.endsWith('/owner/orders') && url.searchParams.get('grade') === 'M25';
      });
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await filterRequest;
      await go('/owner/more?directory=1');
      assert.equal(await page.getByTestId('role-module-directory').locator('[data-testid^="role-module-"]').count(), 4);
      await go('/owner/operations');
      await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; });
      const row = await page.getByTestId('role-module-business-diesel').boundingBox();
      const bar = await page.getByTestId('tab-home').boundingBox();
      assert(row && bar && row.y + row.height <= bar.y + 2, 'Last operation hidden by tab bar');
      await page.screenshot({ path: `${out}/${scheme}-${width}-operations-bottom.png` });
      await go('/owner');
      await page.getByTestId('operational-theme').click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tmrmc_theme_mode'))), scheme === 'light' ? 'dark' : 'light');
      assert.equal(page.url(), homeUrl);
      populated = true;
      await go('/owner/orders');
      await page.getByTestId('order-card-TEST-OWNER-001').waitFor();
      await page.screenshot({ path: `${out}/${scheme}-${width}-orders-fixture.png` });
      await page.getByTestId('order-card-TEST-OWNER-001').click();
      await page.waitForURL('**/order/00000000-0000-0000-0000-000000000001');
      failing = true; populated = false;
      await go('/owner/orders');
      await page.getByText('The service is temporarily unavailable. Please try again.', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS owner: ${scheme} ${width}px — 8 metrics, 5 Quick tiles, compact Commercial/Workforce cards, full directories and top-only theme`);
    }

    // Compact Native Automation regression: four tiles per row at mobile and tablet widths.
    const automationKeys = [
      'DISPATCH_UNASSIGNED_LOAD', 'INVENTORY_BELOW_MIN', 'ORDER_ACCEPTED_NOTICE',
      'ORDER_PENDING_REMINDER', 'ORDER_REJECTED_NOTICE', 'ORDER_SUBMITTED_TASK',
      'QUALITY_INSPECTION_FAILED', 'RFQ_PENDING_PLANT', 'WORKFORCE_LEAVE_PENDING',
    ];
    const plantId = '00000000-0000-0000-0000-000000000007';
    for (const width of [320, 390, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 920 } });
      await context.addInitScript(() => {
        localStorage.setItem('tmrmc_token', JSON.stringify('isolated-owner-browser-test'));
        localStorage.setItem('tmrmc_theme_mode', JSON.stringify('light'));
      });
      const page = await context.newPage();
      const ruleState = automationKeys.map((key, index) => ({
        key, label: key.replaceAll('_', ' '), published: index < 4,
        globally_paused: false, enabled: index === 3,
        reminder_after_minutes: 60, sla_minutes: 60,
      }));
      let saved = 0;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        if (path.endsWith('/me')) return route.fulfill({ json: {
          id: 'isolated-owner', name: 'Owner', role: 'plant_owner', roles: ['plant_owner'],
          status: 'active', kyc_status: 'pending', plant_id: plantId,
        } });
        if (path.endsWith('/notifications')) return route.fulfill({ json: { unread: 0, items: [] } });
        if (path.endsWith('/owner/home')) return route.fulfill({ json: {
          plant_count: 1, plants: [], cards: {}, pending_orders: [],
        } });
        if (path.endsWith('/master/my-plants')) return route.fulfill({ json: {
          plants: [{ id: plantId, name: 'Isolated test plant' }],
        } });
        if (path.endsWith('/automation/rules')) return route.fulfill({ json: { rules: ruleState, worker_enabled: true } });
        if (path.endsWith('/automation/tasks')) return route.fulfill({ json: { tasks: [] } });
        if (path.endsWith('/automation/history')) return route.fulfill({ json: { jobs: [] } });
        if (path.includes('/automation/rules/') && route.request().method() === 'PUT') {
          const key = decodeURIComponent(path.split('/').at(-1));
          const rule = ruleState.find(rule => rule.key === key);
          if (!rule) return route.fulfill({ status: 404, json: { message: 'Unknown rule' } });
          Object.assign(rule, route.request().postDataJSON());
          saved += 1;
          return route.fulfill({ json: { rule } });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto('http://127.0.0.1:8765/owner/');
      await page.getByTestId('tab-operations').click();
      const grid = page.getByTestId('owner-automation-grid');
      await page.getByTestId('owner-automation-toggle-ORDER_ACCEPTED_NOTICE').waitFor();
      const boxes = await grid.locator(':scope > *').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }));
      assert.equal(boxes.length, 10, 'Nine backend rules plus one clearly reserved slot');
      for (const [first, last] of [[0, 3], [4, 7], [8, 9]]) {
        for (let i = first + 1; i <= last; i++) assert(Math.abs(boxes[i].y - boxes[first].y) < 2, 'Cards align on the same row');
      }
      assert(boxes[4].y > boxes[0].y && boxes[8].y > boxes[4].y, 'Grid wraps 4 + 4 + 2');
      assert(boxes.every(box => box.height <= 117 && box.width > 0), 'Compact tiles must remain 116dp tall');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
      const publishedToggle = page.getByTestId('owner-automation-toggle-ORDER_ACCEPTED_NOTICE');
      assert.match(await publishedToggle.innerText(), /OFF/, 'Published automation begins disabled');
      await publishedToggle.click();
      await page.waitForFunction(() => document.querySelector('[data-testid="owner-automation-toggle-ORDER_ACCEPTED_NOTICE"]')?.textContent?.includes('ON'));
      assert.equal(saved, 1, 'Published automation switch persists through existing API');
      assert.match(await page.getByTestId('owner-automation-toggle-RFQ_PENDING_PLANT').innerText(), /OFF/, 'Unpublished automation remains off');
      await page.getByTestId('owner-automation-detail-ORDER_PENDING_REMINDER').click();
      await page.getByText('Remind after (minutes)').waitFor();
      await page.getByTestId('owner-reminder-120').click();
      assert.equal(ruleState[3].reminder_after_minutes, 120, 'Reminder settings remain accessible from selected tile');
      await context.close();
      console.log('PASS owner automation: ' + width + 'px, grid 4/4/2, API toggle and reminder');
    }
    {
      const page = await browser.newPage({ viewport: { width: 320, height: 900 }, reducedMotion: "reduce" });
      let plantResponse = "error";
      let stockMutations = 0;
      await page.addInitScript(() => localStorage.setItem("tmrmc_token", JSON.stringify("isolated-inventory-fixture")));
      await page.route("**/api/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== "GET" && path.includes("/fixture-plant/")) stockMutations += 1;
        if (path.endsWith("/me")) return route.fulfill({ json: {
          id: "inventory-owner", name: "Fixture owner", role: "plant_owner", roles: ["plant_owner"], status: "active",
        } });
        if (path.endsWith("/permission-consent")) return route.fulfill({ json: {
          consent: { version: 1, location_choice: "manual", notification_choice: "manual" },
        } });
        if (path.endsWith("/master/my-plants")) {
          if (plantResponse === "error") return route.fulfill({ status: 503, json: {} });
          return route.fulfill({ json: { plants: plantResponse === "empty" ? [] : [{ id: "fixture-plant", name: "Fixture Plant" }] } });
        }
        if (path.endsWith("/fixture-plant/resources")) return route.fulfill({ json: {
          materials: ["Cement", "Sand", "Gravel", "Other"].map((name, i) => ({ id: String(i), name, stock: i + 1, reorder: 2, unit: "kg" })),
        } });
        if (path.endsWith("/owner/home")) return route.fulfill({ json: { plants: [], cards: {}, pending_orders: [] } });
        return route.fulfill({ json: {} });
      });

      const openInventory = async () => {
        await page.goto("http://127.0.0.1:8765/owner/");
        await page.getByTestId("owner-shortcut-business-inventory").click();
      };
      await openInventory();
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await retry.waitFor();
      plantResponse = "empty";
      await retry.click();
      await page.getByText("No plant is assigned to this account.", { exact: true }).waitFor();

      plantResponse = "loaded";
      await openInventory();
      const search = page.getByRole("textbox", { name: "Search records" });
      await search.fill("No such material");
      await page.getByText("No records match your search.", { exact: true }).waitFor();
      await search.fill("Cement");
      await page.getByText("Cement", { exact: true }).waitFor();
      assert.equal(await page.getByText("Sand", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Stock In", exact: true }).click();
      const quantity = page.getByRole("textbox", { name: "Quantity" });
      await quantity.fill("2");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await quantity.waitFor({ state: "detached" });
      assert.equal(stockMutations, 0);
      await page.close();
      console.log("PASS owner inventory: 320px, plant retry, empty assignment, search correction and adjustment cancellation");
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
