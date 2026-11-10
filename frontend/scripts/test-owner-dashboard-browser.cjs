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
      const page = await context.newPage(), errors = [], requests = [];
      let populated = false, failing = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname; requests.push(url);
        let json = {};
        if (path.endsWith('/me')) json = { id: 'isolated-owner', name: 'TrackMyRMC Play Review Owner', role: 'plant_owner', roles: ['plant_owner'], status: 'active', kyc_status: 'pending', plant_id: null };
        else if (path.endsWith('/owner/home')) json = { plant_count: 0, plants: [], cards: { todays_orders: 0, dispatched_loads: 0, active_staff: 0, pending_approvals: 0 }, pending_orders: [] };
        else if (path.endsWith('/notifications')) json = { unread: 2, items: [] };
        else if (path.endsWith('/master/my-plants')) json = { plants: [] };
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
          assert.equal(await page.locator('[data-testid^="owner-shortcut-"]').count(), 5);
          assert.equal(await page.locator('[data-testid^="owner-metric-"]').count(), 8);
          assert.equal(await page.getByTestId('owner-commercial-grid').locator(':scope > *').count(), 12, '12 commercial tiles hold 13 separately accessible modules');
          assert.equal(await page.getByTestId('role-module-payroll-closure').count(), 1);
          assert.equal(await page.getByTestId('role-module-owner-drivers').count(), 1);
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
          const heights = await page.locator('[data-testid^="owner-shortcut-"]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
          assert(heights.every(height => height >= 82 && height <= 135), `Owner shortcut card outside compact range at ${width}px: ${heights}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
        await page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png`, animations: 'disabled' });
      }
      assert.equal(visibleModuleKeys.size, 30, '30 owner cards plus Plant Attendance metric and Notifications bell form 32 unique destinations');
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
      await page.getByTestId('owner-order-search').fill('Site literal %');
      await page.waitForTimeout(450);
      assert(requests.some(url => url.pathname.endsWith('/owner/orders') && url.searchParams.get('q') === 'Site literal %' && url.searchParams.get('status') === 'processing' && url.searchParams.get('limit') === '30'));
      await page.getByRole('button', { name: 'Order filters', exact: true }).click();
      await page.getByRole('textbox', { name: 'Concrete grade', exact: true }).fill('M25');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await page.waitForTimeout(200);
      assert(requests.some(url => url.searchParams.get('grade') === 'M25'));
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
      console.log(`PASS owner: ${scheme} ${width}px — 8 metrics, 5 Quick tiles, 12 Commercial cards/13 destinations, unique tabs and top-only theme`);
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
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
