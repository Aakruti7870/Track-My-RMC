// Isolated browser fixtures only. No production credentials or app-side mock path.
const { chromium } = require(process.env.OWNER_PLAYWRIGHT_MODULE || '../../admin-web/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.OWNER_PREVIEW_DIR || 'owner-previews';
fs.mkdirSync(out, { recursive: true });
async function assertFits(locator, viewportWidth) {
  const cards = await locator.evaluateAll(nodes => nodes.map(node => {
    const { left, right, width } = node.getBoundingClientRect();
    return { left, right, width, contentWidth: node.scrollWidth };
  }));
  assert(cards.length > 0, 'Expected at least one visible card');
  assert(cards.every(card => card.width > 0 && card.left >= -1 && card.right <= viewportWidth + 1
    && card.contentWidth <= card.width + 1), `Cards overflow at ${viewportWidth}px: ${JSON.stringify(cards)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.OWNER_CHROMIUM_PATH ? { executablePath: process.env.OWNER_CHROMIUM_PATH } : {}) });
  try {
    for (const [scheme, width, height = 920] of [['light', 390], ['dark', 390], ['light', 280], ['light', 320], ['light', 360], ['light', 667, 375], ['light', 768], ['light', 1440]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript(({ scheme }) => {
        localStorage.setItem('tmrmc_token', JSON.stringify('isolated-owner-browser-test'));
        localStorage.setItem('tmrmc_theme_mode', JSON.stringify(scheme));
      }, { scheme });
      const page = await context.newPage(), errors = [];
      let populated = false, failing = false, secondPlant = false;

      const supplierRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        let json = {};
        if (path.endsWith('/me')) json = { id: 'isolated-owner', name: 'TrackMyRMC Play Review Owner', role: 'plant_owner', roles: ['plant_owner'], status: 'active', kyc_status: 'pending', plant_id: null };
        else if (path.endsWith('/owner/home')) json = { plant_count: 0, plants: [], cards: { todays_orders: 0, dispatched_loads: 0, active_staff: 0, pending_approvals: 0 }, pending_orders: [] };
        else if (path.endsWith('/notifications')) json = { unread: 2, items: [] };
        else if (path.endsWith('/master/my-plants')) json = { plants: [
          { id: 'plant-one', name: 'Fixture Plant', city: 'Panvel' },
          ...(secondPlant ? [{ id: 'plant-two', name: 'Second Fixture Plant', city: 'Panvel' }] : []),
        ] };
        else if (path.endsWith('/business/plants/plant-two/materials')) json = { materials: [
          { id: 'cement', name: 'Fixture Cement', material_type: 'CEMENT', unit: 'kg', current_stock: '4', minimum_stock: '10' },
          { id: 'sand', name: 'Fixture Sand', material_type: 'SAND', unit: 'kg', current_stock: '0', minimum_stock: '10' },
          { id: 'water', name: 'Fixture Water', material_type: 'WATER', unit: 'L', current_stock: '30', minimum_stock: '10' },
        ] };
        else if (path.endsWith('/business/plants/plant-two/vehicles')) json = { vehicles: [
          { id: 'mixer-one', registration_number: 'MH46AB1234', capacity_m3: '6', status: 'idle' },
        ] };
        else if (path.endsWith('/plant-operations/plant-one/pipeline')) json = {
          counts: { needs_mixer: 3 },
          total: 1,
          loads: url.searchParams.get('summary') === 'true' ? [] : [{
            id: 'load-one', order_id: 'order-one', order_number: 'ORDER-001', load_number: 1,
            stage: 'needs_mixer', quantity_m3: 6, grade: 'M25', site_name: 'Test project site',
          }],
        };
        else if (path.endsWith('/master/plants/plant-one/people')) json = {
          people: [{ id: 'dispatcher-one', name: 'Fixture Dispatcher', role: 'dispatcher', active: true, status: 'active' }],
        };
        else if (path.endsWith('/owner/plants/plant-one/staff/dispatcher-one/module-permissions')) json = {
          permissions: [{ key: 'dispatch_queue', view: true }, { key: 'fleet_availability', view: false }],
        };
        else if (path.endsWith('/plant-profile/plant-one/editor')) return route.fulfill({ status: 403, json: { message: 'No edit grant' } });
        else if (path.endsWith('/plant-profile/plant-one')) json = { plant_name: 'Fixture Plant', sections: [], documents: [] };
        else if (path.endsWith('/staff/supplier-enquiries')) {
          if (route.request().method() === 'GET') return route.fulfill({ json: { enquiries: [] } });
          supplierRequests.push(route.request().postDataJSON());
          if (supplierRequests.length === 1) return route.fulfill({ status: 503, json: { message: 'Fixture retry' } });
          return route.fulfill({ status: 201, json: { success: true, id: 'isolated-enquiry', status: 'NEW' } });
        }
        else if (/\/owner\/orders\/[0-9a-f-]+$/.test(path)) return route.fulfill({ status: 404, json: { message: 'Isolated detail navigation fixture' } });
        else if (/\/owner\/plants\/plant-one\/business-summary$/.test(path)) {
          const lastMonth = url.searchParams.get('period') === 'last_month';
          json = { invoices_issued: lastMonth ? 8 : 12, invoiced_sales: '480000.00',
            purchase_receipts: 6, purchases_total: '185000.00', customer_payments: '300000.00',
            invoice_balance: '80000.00', recorded_expenses: '65000.00' };
        }
        else if (path.endsWith('/owner/orders')) {
          if (failing) return route.fulfill({ status: 503, json: { message: 'Isolated network failure' } });
          json = { orders: populated ? [{ id: '00000000-0000-0000-0000-000000000001', order_number: 'TEST-OWNER-001', customer_name: 'Isolated browser fixture', plant_name: 'Test plant', site_name: 'Test project site', site_address: 'Test address', grade: 'M25', quantity: 6, delivery_date: '2026-10-19', status: 'PENDING', payment_status: 'UNPAID' }] : [], has_more: false };
        }
        await route.fulfill({ json });
      });
      const go = async path => {
        await page.goto('http://127.0.0.1:8765/owner/');
        await page.getByTestId('operational-theme').waitFor();
        const tab = path.includes('directory=1') ? 'more' : path.split('/')[2];
        if (tab === 'orders') await page.getByTestId('owner-shortcut-owner-orders').click();
        else if (tab) await page.getByTestId(`tab-${tab}`).click();
        await page.waitForTimeout(250);
      };
      for (const name of ['home', 'operations', 'business', 'more']) {
        await go('/owner' + (name === 'home' ? '' : '/' + name));
        const tab = page.getByTestId(`tab-${name}`);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByText('TrackMyRMC Play Review Owner', { exact: true }).count(), 0);
        if (name === 'home') {
          const summary = await page.getByTestId('owner-home-summary').evaluate(el => getComputedStyle(el).backgroundColor);
          assert.equal(summary, scheme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(250, 249, 245)');
          const quickCards = page.getByTestId('owner-quick-access').getByRole('button');
          assert.equal(await quickCards.count(), 5);
          await assertFits(quickCards, width);
          const heights = await quickCards.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
          assert(heights.every(height => height >= 65 && height <= 135), `Owner shortcut card outside compact range at ${width}px: ${heights}`);
          assert.equal(await page.locator('[data-testid^="owner-metric-"]').count(), 0);
          for (const id of ['owner-shortcut-insights', 'home-modules-owner-commercial', 'home-modules-owner-workforce', 'role-module-owner-drivers']) {
            assert.equal(await page.getByTestId(id).count(), 0);
          }
          const hero = page.getByTestId('owner-home-hero-banner');
          const scroll = page.getByTestId('owner-home-scroll');
          const supplierCard = scroll.getByTestId('plant-home-supplier-enquiry');
          const profileCard = scroll.getByTestId('plant-home-profile');
          await supplierCard.waitFor();
          await scroll.getByTestId('owner-quick-access').waitFor();
          assert.equal(await supplierCard.getByText('Request quotes for up to 3 materials').count(), 0);
          await profileCard.getByText('Plant Profile', { exact: true }).waitFor();
          assert((await supplierCard.boundingBox()).height >= 44);
          assert((await profileCard.boundingBox()).height >= 44);
          await page.getByRole('button', { name: 'Needs mixer, 3 loads' }).waitFor();
          if (width === 390) {
            await page.setViewportSize({ width, height: 660 });
            const movement = await scroll.evaluate(node => {
              const supplier = node.querySelector('[data-testid="plant-home-supplier-enquiry"]');
              node.scrollTop = 0;
              const top = supplier.getBoundingClientRect().top;
              node.scrollTop = 120;
              return { offset: node.scrollTop, moved: top - supplier.getBoundingClientRect().top };
            });
            assert(movement.offset > 0 && Math.abs(movement.moved - movement.offset) <= 1);
            await page.setViewportSize({ width, height: 920 });
            await scroll.evaluate(node => { node.scrollTop = 0; });
          }
          const order = await page.evaluate(() => {
            const supplier = document.querySelector('[data-testid="plant-home-supplier-enquiry"]');
            const profile = document.querySelector('[data-testid="plant-home-profile"]');
            const pipeline = document.querySelector('[data-testid="plant-load-pipeline"]');
            return profile.compareDocumentPosition(supplier) & supplier.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING;
          });
          assert(await hero.evaluate(node => node.getBoundingClientRect().width >= Math.min(innerWidth - 32, 620) - 1), 'Plant image spans the home card');
          assert(order, 'Supplier and profile cards sit above Load Pipeline in the requested order');
          await assertFits(scroll.getByRole('button'), width);
        }
        if (name === 'operations') {
          assert.equal(await page.getByTestId('owner-operations-module-directory').count(), 0);
          assert.equal(await page.getByText('Review tasks', { exact: true }).count(), 0);
          assert.equal(await page.getByText(/^Recent automation:/).count(), 0);
          await page.getByRole('button', { name: 'WhatsApp Dispatch settings', exact: true }).waitFor();
          const team = page.getByTestId('owner-operations-team');
          await team.getByText('Fixture Dispatcher').waitFor();
          assert.equal(await team.locator('[data-testid^="owner-operations-role-"]:not([data-testid="owner-operations-role-modules"])').count(), 7);
          const roleModules = team.getByTestId('owner-operations-role-modules');
          await roleModules.getByRole('button', { name: 'Dispatch Queue', exact: true }).waitFor();
          assert.equal(await roleModules.getByRole('button', { name: 'Fleet Availability', exact: true }).count(), 0);
          await team.getByTestId('owner-operations-role-operator').click();
          await roleModules.getByText('This role has no active employee assignment.').waitFor();
          const registers = page.getByTestId('owner-operations-registers');
          assert.equal(await registers.getByRole('button').count(), 14);
          await assertFits(team.getByRole('button'), width);
          await assertFits(registers.getByRole('button'), width);
        }
        if (name === 'business') {
          const workspace = page.getByTestId('owner-business-workspace');
          assert.equal(await page.getByTestId('tab-orders').count(), 0);
          assert.equal(await workspace.locator('[data-testid^="owner-business-card-"]').count(), 4);
          await assertFits(workspace.locator('[data-testid^="owner-business-card-"]'), width);
          await workspace.getByText('₹4,80,000', { exact: true }).waitFor();
          for (const label of ['Plant Orders', 'Quotation Requests', 'Provisional Requests', 'Plant Customers', 'Rate Cards']) {
            assert.equal(await workspace.getByRole('button', { name: label, exact: true }).count(), 1);
          }
          await workspace.getByTestId('owner-business-period-last_month').click();
          await workspace.getByText('8', { exact: true }).waitFor();
          for (const [section, label] of [
            ['purchase', 'Purchase Receipts'], ['payments', 'Billing & Ledger'], ['profit-loss', 'Stock & Consumption'],
          ]) {
            await workspace.getByTestId(`owner-business-card-${section}`).click();
            await workspace.getByRole('button', { name: label, exact: true }).waitFor();
          }
          await workspace.getByText('Net profit needs valued material consumption and closing adjustments.').waitFor();
          await page.getByTestId('owner-business-card-sales').click();
        }
        if (name === 'more') {
          await tab.click({ clickCount: 3 });
          await page.waitForURL(/\/owner\/more\/?$/);
          assert.equal(await tab.getAttribute('aria-selected'), 'true');
          assert.equal(await page.getByTestId('role-module-directory').locator('[data-testid^="role-module-"]').count(), 4);
          assert.equal(await page.getByText('Appearance', { exact: true }).count(), 0);
          assert.equal(await page.getByTestId('owner-staff-module-access').count(), 1);
          assert.equal(await page.getByTestId('owner-permission-settings').count(), 1);
          assert.equal(await page.getByTestId('owner-workforce-directory').count(), 1);
          assert.equal(await page.getByTestId('owner-support').count(), 1);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
        await page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png`, animations: 'disabled' });
      }
      await go('/owner');
      if (width === 390) {
        await page.getByRole('button', { name: 'Needs mixer, 3 loads' }).click();
        await page.getByRole('button', { name: /ORDER-001 · Load 1/ }).waitFor();
        assert(new URL(page.url()).searchParams.get('stage') === 'needs_mixer');
        await page.getByRole('button', { name: 'Back to Operations' }).click();
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
      const row = await page.getByRole('button', { name: 'WhatsApp Dispatch settings', exact: true }).boundingBox();
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
      if (scheme === 'light' && width === 390) {
        secondPlant = true;
        const post = suffix => page.waitForRequest(request =>
          request.method() === 'POST' && new URL(request.url()).pathname.endsWith(suffix));

        await go('/owner/operations');
        await page.getByRole('button', { name: 'Second Fixture Plant', exact: true }).click();
        await page.getByTestId('owner-operations-registers').getByRole('button', { name: 'Diesel Ledger', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/business/diesel' && url.searchParams.get('plantId') === 'plant-two');

        await go('/owner');
        await page.getByTestId('owner-shortcut-business-inventory').click();
        await page.getByText('Second Fixture Plant', { exact: true }).click();
        for (const status of ['Low stock', 'Out of stock', 'In stock']) {
          await page.getByText(status, { exact: true }).waitFor();
        }
        await page.getByRole('button', { name: 'Add Material', exact: true }).click();
        await page.getByRole('textbox', { name: 'Material type', exact: true }).fill('CEMENT');
        await page.getByRole('textbox', { name: 'Material name', exact: true }).fill('New Fixture Cement');
        await page.getByRole('textbox', { name: 'Unit', exact: true }).fill('kg');
        await page.getByRole('textbox', { name: 'Opening stock', exact: true }).fill('20');
        await page.getByRole('textbox', { name: 'Reorder level', exact: true }).fill('8');
        const materialRequest = post('/business/plants/plant-two/materials');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.deepEqual((await materialRequest).postDataJSON(), {
          material_type: 'CEMENT', name: 'New Fixture Cement', unit: 'kg', current_stock: 20, minimum_stock: 8,
        });

        await go('/owner');
        await page.getByTestId('owner-shortcut-business-fleet').click();
        await page.getByText('Second Fixture Plant', { exact: true }).click();
        const maintenanceRequest = post('/business/plants/plant-two/vehicles/mixer-one/status');
        await page.getByRole('button', { name: 'Set Maintenance', exact: true }).click();
        assert.deepEqual((await maintenanceRequest).postDataJSON(), { status: 'maintenance' });
        await page.getByRole('button', { name: 'Add Transit Mixer', exact: true }).click();
        await page.getByRole('textbox', { name: 'TM number', exact: true }).fill('MH46AB5678');
        await page.getByRole('textbox', { name: 'Capacity m³', exact: true }).fill('6');
        const vehicleRequest = post('/business/plants/plant-two/vehicles');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.deepEqual((await vehicleRequest).postDataJSON(), { registration_number: 'MH46AB5678', capacity_m3: 6 });
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS owner: ${scheme} ${width}px — marked cards removed, remaining Home and Operations cards fit`);
    }

    // Automation cards reflow without clipping and preserve rule and WhatsApp settings.
    const automationKeys = [
      'DISPATCH_UNASSIGNED_LOAD', 'INVENTORY_BELOW_MIN', 'ORDER_ACCEPTED_NOTICE',
      'ORDER_PENDING_REMINDER', 'ORDER_REJECTED_NOTICE', 'ORDER_SUBMITTED_TASK',
      'QUALITY_INSPECTION_FAILED', 'RFQ_PENDING_PLANT', 'WORKFORCE_LEAVE_PENDING',
    ];
    const plantId = '00000000-0000-0000-0000-000000000007';
    for (const width of [280, 320, 390, 768, 1440]) {
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
        if (path.endsWith('/pipeline')) return route.fulfill({ json: { counts: {}, total: 0, loads: [] } });
        if (path.endsWith('/automation/rules')) return route.fulfill({ json: { rules: ruleState, worker_enabled: true } });
        if (path.endsWith('/dispatch-whatsapp')) return route.fulfill({ json: {
          enabled: true, marketing_enabled: false, preference_exists: true,
          worker_enabled: true, marketing_worker_enabled: true, template_configured: true, marketing_template_configured: true,
        } });
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
      assert.equal(boxes.length, 9, 'Show every backend rule');
      const columns = width < 320 ? 2 : 3;
      for (let i = 1; i < boxes.length; i++) {
        if (i % columns === 0) assert(boxes[i].y > boxes[i - 1].y, 'Cards wrap at the viewport column count');
        else assert(Math.abs(boxes[i].y - boxes[i - 1].y) < 2, 'Cards align on the same row');
      }
      assert(boxes.every(box => box.height <= 116 && box.width > 0), `Automation cards exceed the compact grid at ${width}px: ${JSON.stringify(boxes)}`);
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
      await page.getByRole('button', { name: 'WhatsApp Dispatch settings', exact: true }).click();
      await page.getByText('Optional App Promotion', { exact: true }).waitFor();
      await assertFits(page.getByTestId('owner-native-automation-center').getByRole('switch'), width);
      await context.close();
      console.log('PASS owner automation: ' + width + 'px, ' + columns + ' columns, API toggle, reminder and WhatsApp settings');
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
        if (path.endsWith("/fixture-plant/materials")) return route.fulfill({ json: {
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
