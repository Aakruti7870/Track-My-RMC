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
            ], primary: { title: role === 'quality_engineer' ? 'Quality Register' : "Today’s workspace", kind: role === 'quality_engineer' ? 'quality' : 'dispatch' },
          };
          else if (path.endsWith('/staff/module-permissions')) json = {
            permissions: grants.map(key => ({ key, view: true })),
          };
          else if (path.endsWith('/staff/manager-access')) json = { enabled: false };
          else if (path.endsWith('/notifications')) json = { unread: 0, items: [] };
          else if (role === 'quality_engineer' && path.endsWith('/staff/collection/quality')) json = {
            title: 'Quality Register', empty: 'No items', items: [{
              id: 'isolated-quality', primary: 'Synthetic quality record', nav: '/quality-test/isolated-quality',
            }],
          };
          else if (path.endsWith('/staff/quality/isolated-quality')) json = {
            order_number: 'ISOLATED-QA', grade: 'M25', quantity: 3, site_name: 'Fixture site', quality_tests: [],
          };
          else if (path.includes('/staff/collection/')) json = {
            title: 'Isolated queue', empty: 'No items', items: [],
          };
          await route.fulfill({ json });
        });
        await page.goto('http://127.0.0.1:8765/' + role + '/');
        const summary = page.getByTestId('staff-home-summary');
        await summary.waitFor({ timeout: 25000 });
        await page.getByTestId('staff-home-hero-banner').waitFor();
        await page.getByTestId('plant-home-supplier-enquiry').waitFor();
        const fixed = page.getByTestId('staff-home-scroll-fixed');
        await fixed.getByRole('heading', { name: 'Quick Access', exact: true }).waitFor();
        await fixed.getByTestId('staff-home-summary').waitFor();
        await fixed.getByTestId('plant-home-supplier-enquiry').waitFor();
        const scroll = page.getByTestId('staff-home-scroll');
        const profile = scroll.getByTestId('plant-home-profile');
        assert.equal(await profile.count(), 1, 'Staff profile remains in the scroll area');
        if (width === 390) {
          await page.setViewportSize({ width, height: 760 });
          // At smaller heights the shortcut block can become sticky after the hero scrolls.
          await page.getByTestId('staff-home-scroll-shortcuts').getByTestId('plant-home-supplier-enquiry').waitFor();
          await scroll.evaluate(node => {
            const shortcuts = node.querySelector('[data-testid="staff-home-scroll-shortcuts"]');
            if (shortcuts) node.scrollTop = Math.max(0, shortcuts.getBoundingClientRect().top - node.getBoundingClientRect().top + 24);
          });
          const movement = await scroll.evaluate(node => {
            const profile = node.querySelector('[data-testid="plant-home-profile"]');
            const supplier = document.querySelector('[data-testid="plant-home-supplier-enquiry"]');
            const profileTop = profile.getBoundingClientRect().top;
            const supplierTop = supplier.getBoundingClientRect().top;
            node.scrollTop += 75;
            return { offset: node.scrollTop, profile: profile.getBoundingClientRect().top - profileTop,
              supplier: supplier.getBoundingClientRect().top - supplierTop };
          });
          assert(movement.offset > 0 && movement.profile < 0, 'Staff profile scrolls with the dashboard');
          assert.equal(movement.supplier, 0, 'Staff supplier enquiry stays fixed');
          await page.setViewportSize({ width, height: 920 });
          await fixed.getByTestId("staff-home-summary").waitFor();
          await scroll.evaluate(node => { node.scrollTop = 0; });
        }
        const surface = await summary.evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(surface, 'rgb(250, 249, 245)', 'Staff summary copy sits on opaque ivory');
        await page.waitForFunction(() => document.querySelector('[data-testid="tab-home"]')?.getAttribute('aria-selected') === 'true');
        await page.waitForFunction(() => document.querySelector('[data-testid^="home-modules-"] [data-testid^="role-module-"]'));
        const homeCards = page.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])');
        const homeKeys = await homeCards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
        assert(homeKeys.length > 0, role + ' Home must expose permission-approved operational cards');
        assert.equal(new Set(homeKeys).size, homeKeys.length, role + ' duplicated a Home card');
        assert(homeKeys.every(key => !['role-module-public-plant-profile', 'role-module-my-payslip'].includes(key)),
          role + ' must keep personal documents and profile cards on More only');
        let homeSizes = await homeCards.evaluateAll(nodes => nodes.map(node => ({
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
          quick: Boolean(node.closest('[data-testid="home-modules-quick-access"]')),
        })));
        assert(homeSizes.every(box => box.width >= (box.quick ? 60 : 72) && box.width <= 240 && box.height >= 76 && box.height <= 140),
          role + ' oversize or clipped Home card at ' + width + 'px: ' + JSON.stringify(homeSizes));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' Home horizontal overflow at ' + width);
        if (width === 390) await page.screenshot({ path: out + '/' + role + '-home-390.png', fullPage: true });
        const sections = await page.locator('[data-testid^="home-modules-"]').evaluateAll(nodes =>
          nodes.map(node => node.querySelectorAll('[data-testid^="role-module-"]').length));
        assert(sections.every(count => count > 0 && count <= 4), role + ' renders too many Home shortcuts');
        const seeAll = page.locator('[data-testid^="home-modules-"] [data-testid^="home-see-all-"]');
        assert(await seeAll.count(), role + ' needs a See All link for its longer categories');
        {
          const label = await seeAll.first().getAttribute('aria-label');
          const category = label.replace('See all ', '');
          await seeAll.first().click();
          await page.getByRole('heading', { name: category, exact: true }).waitFor();
          await page.waitForFunction(() => !document.body.innerText.includes('Checking staff permissions…'));
          const full = page.getByTestId('role-modules-page');
          assert((await full.locator('[data-testid^="role-module-"]:not([data-testid="role-module-directory"])').count()) > 2);
          const search = full.getByTestId('staff-module-search');
          await search.fill('no-module-matches-this-test');
          await full.getByText('No modules match this filter or your current access.').waitFor();
          await page.getByTestId('role-modules-back').click();
          await summary.waitFor();
        }
        await page.getByTestId('tab-more').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="tab-more"]')?.getAttribute('aria-selected') === 'true');
        await page.getByTestId('staff-module-search').waitFor();
        await page.waitForFunction(() => !document.body.innerText.includes('Checking staff permissions…'));
        const moreCards = page.locator('[data-testid="role-module-directory"]:has([data-testid="staff-module-search"]) [data-testid^="role-module-"]');
        const moreKeys = await moreCards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
        assert.equal(new Set(moreKeys).size, moreKeys.length, role + ' duplicated a More card');
        for (const key of moreKeys) {
          assert(['role-module-public-plant-profile', 'role-module-my-payslip'].includes(key),
            role + ' More must contain only account and personal documents');
          assert(!homeKeys.includes(key), role + ' repeats ' + key + ' between Home and More');
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          role + ' More horizontal overflow at ' + width);
        if (width === 390) await page.screenshot({ path: out + '/' + role + '-more-390.png', fullPage: true });
        assert.deepEqual(errors, [], role + ' produced runtime browser errors');
        if (role === 'quality_engineer' && width === 390) {
          // Home and Quality contain the same record. The full register must
          // receive the click even while Home's preview remains mounted.
          await page.getByTestId('tab-quality').click();
          await page.waitForFunction(() => document.querySelector('[data-testid="tab-quality"]')?.getAttribute('aria-selected') === 'true');
          const register = page.getByTestId('staff-collection-quality');
          await register.getByTestId('open-isolated-quality').click();
          await page.getByTestId('qt-save').waitFor();
          assert.equal(await page.getByTestId('qt-save').isDisabled(), true);
          assert.deepEqual(errors, [], 'Quality navigation produced runtime browser errors');
          console.log('PASS quality: More to full register to inspection form, with cached Home preview');
        }
        await context.close();
        console.log('PASS staff: ' + role + ' ' + width + 'px — unique Home/More, responsive layout');
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
