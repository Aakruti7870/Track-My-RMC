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
      const go = async path => { await page.goto('http://127.0.0.1:8765/owner/'); await page.getByTestId('owner-theme-toggle').waitFor(); if (path.includes('directory=1')) await page.getByRole('button', { name: 'View all plant modules', exact: true }).click(); else { const tab = path.split('/')[2]; if (tab) await page.getByTestId(`tab-${tab}`).click(); } await page.waitForTimeout(250); };
      for (const name of ['home', 'orders', 'operations', 'more']) {
        await go('/owner' + (name === 'home' ? '' : '/' + name));
        const tab = page.getByTestId(`tab-${name}`);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByText('TrackMyRMC Play Review Owner', { exact: true }).count(), 0);
        if (name === 'home') assert.equal(await page.locator('[data-testid^="owner-shortcut-"]').count(), 6);
        if (name === 'operations') assert.equal(await page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])').count(), 10);
        if (name === 'more') assert.equal(await page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])').count(), 21);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
        await page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png`, animations: 'disabled' });
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
      await page.getByTestId('owner-order-search').fill('Site literal %');
      await page.waitForTimeout(450);
      assert(requests.some(url => url.pathname.endsWith('/owner/orders') && url.searchParams.get('q') === 'Site literal %' && url.searchParams.get('status') === 'processing' && url.searchParams.get('limit') === '30'));
      await page.getByRole('button', { name: 'Order filters', exact: true }).click();
      await page.getByRole('textbox', { name: 'Concrete grade', exact: true }).fill('M25');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await page.waitForTimeout(200);
      assert(requests.some(url => url.searchParams.get('grade') === 'M25'));
      await go('/owner/more?directory=1');
      assert.equal(await page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])').count(), 31);
      await go('/owner/operations');
      await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; });
      const row = await page.getByTestId('role-module-business-reports').boundingBox();
      const bar = await page.getByTestId('tab-home').boundingBox();
      assert(row && bar && row.y + row.height <= bar.y + 2, 'Last operation hidden by tab bar');
      await page.screenshot({ path: `${out}/${scheme}-${width}-operations-bottom.png` });
      await go('/owner');
      await page.getByTestId('owner-theme-toggle').click();
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
      await page.getByText('Server down', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS owner: ${scheme} ${width}px — layout, 31 destinations, Quick, search, filters, detail navigation, error state, live theme`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
