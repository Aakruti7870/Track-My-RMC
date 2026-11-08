// Isolated staff browser QA: no live credentials, mutations or production data.
const { chromium } = require(process.env.OWNER_PLAYWRIGHT_MODULE || '../../admin-web/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const roles = ['admin', 'dispatcher', 'operator', 'supervisor', 'accountant',
  'quality_engineer', 'fleet_manager', 'store_manager'];
const grants = ['dispatch_queue', 'fleet_availability', 'production_queue', 'incidents',
  'billing_ledger', 'quality_register', 'driver_roster', 'material_inventory',
  'rate_cards', 'mix_designs', 'suppliers', 'purchases', 'diesel_ledger',
  'quotations', 'expenses', 'payroll', 'plant_reports', 'workforce', 'employee_master'];
const out = process.env.STAFF_PREVIEW_DIR || 'staff-previews';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.OWNER_CHROMIUM_PATH ? { executablePath: process.env.OWNER_CHROMIUM_PATH } : {}) });
  try {
    for (const role of roles) {
      for (const width of [320, 390, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 920 } });
        await context.addInitScript(() => {
          localStorage.setItem('tmrmc_token', JSON.stringify('isolated-staff-dashboard-test'));
          localStorage.setItem('tmrmc_theme_mode', JSON.stringify('light'));
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/**', async route => {
          const path = new URL(route.request().url()).pathname;
          let json = {};
          if (path.endsWith('/me')) json = {
            id: 'staff-isolated', name: 'QA Staff', role, roles: [role],
            role_label: role.replaceAll('_', ' '), plant_id: 'qa-plant',
            status: 'active', kyc_status: 'verified',
          };
          else if (path.endsWith('/staff/home')) json = {
            role, role_label: role.replaceAll('_', ' '), name: 'QA Staff',
            plant_name: 'Fixture RMC Plant', kpis: [
              { label: 'Pending Orders', value: 0, icon: 'cube-outline' },
              { label: 'Available TMs', value: 2, icon: 'bus-outline' },
              { label: 'Staff Present Today', value: 3, icon: 'people-outline' },
              { label: 'Open Incidents', value: 0, icon: 'warning-outline' },
            ], primary: { title: "Today’s workspace", kind: 'dispatch' },
          };
          else if (path.endsWith('/staff/module-permissions')) json = {
            permissions: grants.map(key => ({ key, view: true })),
          };
          else if (path.endsWith('/staff/manager-access')) json = { enabled: false };
          else if (path.endsWith('/notifications')) json = { unread: 0, items: [] };
          else if (path.includes('/staff/collections')) json = {
            title: 'Isolated queue', empty: 'No items', items: [],
          };
          await route.fulfill({ json });
        });
        await page.goto('http://127.0.0.1:8765/' + role + '/');
        await page.getByTestId('staff-home-summary').waitFor({ timeout: 25000 });
        await page.waitForFunction(() => !document.body.innerText.includes('Checking staff permissions…'));
        const homeCards = page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])');
        const homeKeys = await homeCards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
        assert(homeKeys.length > 0 && homeKeys.length <= 6, role + ' Home card count invalid');
        assert.equal(new Set(homeKeys).size, homeKeys.length, role + ' duplicated a Home card');
        let homeSizes = await homeCards.evaluateAll(nodes => nodes.map(node => ({
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        })));
        assert(homeSizes.every(box => box.width >= 125 && box.width <= 240 && box.height >= 120 && box.height <= 165),
          role + ' oversize or clipped Home card at ' + width + 'px: ' + JSON.stringify(homeSizes));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' Home horizontal overflow at ' + width);
        if (width === 390) await page.screenshot({ path: out + '/' + role + '-home-390.png', fullPage: true });
        await page.getByTestId('tab-more').click();
        await page.getByTestId('staff-module-search').waitFor();
        await page.waitForFunction(() => !document.body.innerText.includes('Checking staff permissions…'));
        const moreCards = page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])');
        const moreKeys = await moreCards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
        assert.equal(new Set(moreKeys).size, moreKeys.length, role + ' duplicated a More card');
        for (const key of moreKeys) assert(!homeKeys.includes(key), role + ' repeats ' + key + ' between Home and More');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' More horizontal overflow at ' + width);
        if (width === 390) await page.screenshot({ path: out + '/' + role + '-more-390.png', fullPage: true });
        assert.deepEqual(errors, [], role + ' produced runtime browser errors');
        await context.close();
        console.log('PASS staff: ' + role + ' ' + width + 'px — unique Home/More, responsive layout');
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
