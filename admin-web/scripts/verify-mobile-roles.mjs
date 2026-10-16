import { chromium, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The real Expo UI, Rust router and disposable PostgreSQL database are used.
// Only delivery is replaced. All transient codes remain in process memory;
// No traces, response bodies or credential-bearing errors are saved. Screenshots
// are limited to the consent screen and synthetic post-login discovery fixtures.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.APP_ENV, 'test');
const root = fileURLToPath(new URL('../../', import.meta.url));
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url));
const typescript = frontendRequire('typescript');
const catalogSource = await readFile(new URL('../../frontend/src/navigation/moduleCatalog.ts', import.meta.url), 'utf8');
const transpiledCatalog = typescript.transpileModule(catalogSource, {
  compilerOptions: { module: typescript.ModuleKind.ES2022, target: typescript.ScriptTarget.ES2022 },
}).outputText;
const { modulesForRole } = await import(`data:text/javascript;base64,${Buffer.from(transpiledCatalog).toString('base64')}`);

const manifest = JSON.parse(await readFile(new URL('../../backend/tests/fixtures/staging_identities.json', import.meta.url)));
assert.equal(manifest.live_provider_delivery_allowed, false);
assert.equal(manifest.persistent_privileged_accounts_allowed, false);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; }
  }
  return result;
}
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[19] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const authenticators = new Map(manifest.users.filter(user => user.email).map(user => [user.role, randomBytes(20)]));
const captureToken = randomBytes(32).toString('hex');
const deliveries = new Map();
const approved = new Set(manifest.users.map(user => user.email ?? user.phone.replace(/^\+/, '')));
const sink = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/capture' || req.headers.authorization !== `Bearer ${captureToken}`) {
    res.writeHead(403).end(); return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) throw new Error('Oversized fixture delivery');
    }
    const delivery = JSON.parse(body);
    assert.ok(approved.has(delivery.destination));
    assert.match(delivery.otp, /^\d{6}$/);
    deliveries.set(delivery.destination, delivery.otp);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  } catch { res.writeHead(400).end(); }
});
await new Promise(resolve => sink.listen(8302, '127.0.0.1', resolve));
const children = [];
const startupDiagnostics = [];
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['pipe', 'ignore', 'pipe'], ...options });
  let partial = '';
  child.stderr.on('data', chunk => {
    partial += chunk;
    const lines = partial.split('\n');
    partial = lines.pop().slice(-1024);
    for (const line of lines) {
      if (/^CI-FIXTURE: [a-z0-9=_ -]+$/i.test(line.trim())) startupDiagnostics.push(line.trim());
    }
  });
  child.on('error', () => {});
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error('Fixture process stopped');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Fixture startup deadline exceeded');
}
let browser;
let activeRole = 'startup', phase = 'fixture';
let safeDiagnostics = [];
let safeSuccessfulPaths = new Set();
try {
  const api = start('cargo', ['run', '--manifest-path', 'backend/Cargo.toml', '--example', 'mobile_browser_fixture']);
  api.stdin.end(JSON.stringify({ capture_token: captureToken, totp_secrets: Object.fromEntries([...authenticators].map(([role, bytes]) => [role, base32(bytes)])) }));
  await ready('http://127.0.0.1:8301/health', api);
  phase = 'Expo startup';
  const web = start(process.execPath, ['node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--port', '8081', '--max-workers', '2'], {
    cwd: fileURLToPath(new URL('../../frontend/', import.meta.url)),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      CI: 'true', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1',
      EXPO_PUBLIC_BACKEND_URL: 'http://127.0.0.1:8301',
    },
  });
  await ready('http://127.0.0.1:8081', web);
  browser = await chromium.launch();
  for (const user of manifest.users) {
    activeRole = user.role;
    assert.ok(!['admin', 'authority', 'central_admin'].includes(user.role));
    phase = 'login';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    if (user.role === 'customer') {
      // Even an existing OS grant must not override the user's manual choice.
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({latitude:19.076,longitude:72.877});
      await page.addInitScript(() => {
        window.__tmLocationRequests = 0;
        const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (...args) => {
          window.__tmLocationRequests++;
          return original(...args);
        };
      });
    }
    page.setDefaultTimeout(60000);
    const failures = [], runtimeErrors = [];
    safeDiagnostics = failures;
    const successfulPaths = new Set();
    safeSuccessfulPaths = successfulPaths;
    let token;
    let currentIdentity;
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:8301/api/')) {
        const authorization = request.headers().authorization;
        if (authorization?.startsWith('Bearer ')) token = authorization.slice(7);
      }
    });
    page.on('pageerror', () => {
      runtimeErrors.push('Browser runtime error');
      failures.push('Browser runtime error');
    });
    page.on('response', async response => {
      if (!response.url().startsWith('http://127.0.0.1:8301/api/')) return;
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400) failures.push(`${path}: ${response.status()}`);
      else {
        successfulPaths.add(path);
        if (path === '/api/me') currentIdentity = await response.json();
      }
    });
    await page.goto('http://127.0.0.1:8081/login', { timeout: 180000 });
    await expect(page.getByTestId('login-user-tab')).toBeVisible({ timeout: 180000 });
    const destination = user.email ?? user.phone.replace(/^\+/, '');
    if (user.email) {
      await page.getByTestId('login-plant-tab').click();
      await page.getByTestId('login-plant-email-input').fill(user.email);
      await page.getByTestId('login-plant-send-otp').click();
    } else {
      await page.getByTestId('login-mobile-input').fill(user.phone);
      await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
    }
    const otpInput = page.getByTestId(user.email ? 'login-plant-otp-input' : 'login-user-otp-input');
    phase = 'email/WhatsApp OTP';
    await expect(otpInput).toBeEditable();
    assert.ok(deliveries.has(destination), 'Approved in-memory OTP delivery missing');
    const otp = deliveries.get(destination);
    deliveries.delete(destination);
    await otpInput.fill(otp, { force: true });
    if (user.email) {
      phase = 'authenticator';
      const authenticatorInput = page.getByTestId('login-plant-authenticator-input');
      await expect(authenticatorInput).toBeEditable();
      await authenticatorInput.fill(totp(authenticators.get(user.role)), { force: true });
    }
    const rolePath = user.alias ?? user.role;
    phase = 'role navigation';
    await page.waitForURL(url => url.pathname === `/${rolePath}` || url.pathname === `/${rolePath}/`);
    if (user.role === 'customer') {
      phase = 'post OTP optional consent';
      await expect(page.getByTestId('permission-introduction')).toBeVisible();
      await mkdir(new URL('../../artifacts/customer-experience/',import.meta.url),{recursive:true});
      await page.screenshot({path:new URL('../../artifacts/customer-experience/consent-mobile.png',import.meta.url).pathname});
      await page.getByTestId('permission-continue').click();
      await expect(page.getByTestId('permission-introduction')).not.toBeVisible();
    }
    phase = 'dashboard';
    const summary = user.role === 'customer' ? 'customer-home-scroll' : `${['plant_owner', 'driver'].includes(user.role) ? rolePath : 'staff'}-home-summary`;
    await expect(page.getByTestId(summary)).toBeVisible();
    const homePath = `/api/${['customer', 'driver', 'plant_owner'].includes(user.role) ? rolePath : 'staff'}/home`;
    await expect.poll(() => successfulPaths.has(homePath)).toBe(true);
    await expect.poll(() => currentIdentity?.role).toBe(user.role);
    assert.ok(currentIdentity.name && token);
    if (user.role === 'customer') {
      phase = 'automatic nearby discovery with optional location off';
      await page.getByTestId('tab-plants').click();
      await expect(page.getByTestId('plants-list')).toBeVisible();
      await expect.poll(() => successfulPaths.has('/api/customer/plants/search')).toBe(true);
      await expect(page.getByText('Browser staging plant',{exact:true}).first()).toBeVisible();
      assert.equal(await page.evaluate(() => window.__tmLocationRequests),0,'Manual preference must prevent automatic GPS even with an OS grant');
      await page.screenshot({path:new URL('../../artifacts/customer-experience/plants-mobile.png',import.meta.url).pathname});
      await page.reload();
      await expect(page.getByTestId('plants-list')).toBeVisible();
      await expect(page.getByTestId('permission-introduction')).not.toBeVisible();
      phase = 'manual site and filtered plant search';
      await page.getByRole('button',{name:'Filters and site selection',exact:true}).click();
      await page.getByLabel('Site latitude',{exact:true}).fill('19.076');
      await page.getByLabel('Site longitude',{exact:true}).fill('72.877');
      await page.getByRole('button',{name:'Use this site',exact:true}).click();
      await page.getByLabel('Concrete grade',{exact:true}).fill('M25');
      await page.getByRole('button',{name:'Apply',exact:true}).click();
      await expect(page.getByText('Browser staging plant',{exact:true}).first()).toBeVisible();
      await page.getByRole('button',{name:'Hide filters and site selection',exact:true}).click();
      await page.getByRole('button',{name:'View Details',exact:true}).click();
      await expect(page.getByRole('button',{name:'Close details',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Close details',exact:true}).click();
      await expect(page.getByRole('button',{name:'Close details',exact:true})).not.toBeVisible();
      await page.setViewportSize({width:1280,height:900});
      await expect(page.getByText('Browser staging plant',{exact:true}).first()).toBeVisible();
      await page.screenshot({path:new URL('../../artifacts/customer-experience/plants-desktop.png',import.meta.url).pathname});
      await page.setViewportSize({width:390,height:844});
      phase = 'owned active delivery tracking and browser back';
      const ordersResponse = await context.request.get('http://127.0.0.1:8301/api/customer/orders',{headers:{Authorization:`Bearer ${token}`}});
      assert.equal(ordersResponse.status(),200);
      const ownedOrders = await ordersResponse.json();
      const activeDelivery = ownedOrders.orders.find(order => order.status === 'EN_ROUTE');
      assert.ok(activeDelivery);
      await page.goto(`http://127.0.0.1:8081/track/${activeDelivery.id}`);
      await expect(page.getByText('Mixer location',{exact:true})).toBeVisible();
      await expect(page.getByText('CI-MOBILE-TM',{exact:true}).first()).toBeVisible();
      await page.screenshot({path:new URL('../../artifacts/customer-experience/tracking-mobile.png',import.meta.url).pathname});
      await page.goBack();
      await expect(page.getByTestId('plants-list')).toBeVisible();
      await expect(page.getByTestId('permission-introduction')).not.toBeVisible();
      await page.getByTestId('tab-home').click();
    }
    if (user.role !== 'customer') assert.ok(currentIdentity.plant_id);
    phase = 'role module discovery';
    // Verify the rendered Expo menu against the same typed catalog that CI
    // checks for existing routes. Do not capture response bodies or credentials.
    if (user.role === 'customer') {
      await expect(page.getByTestId('customer-module-grid')).toBeVisible();
      await page.getByText('More', { exact: true }).last().click();
    }
    await expect(page.getByTestId('role-module-directory')).toBeVisible();
    for (const module of modulesForRole(user.role)) {
      await expect(page.getByTestId('role-module-' + module.key)).toBeVisible();
    }
    if (user.role === 'customer') {
      await page.getByText('Home', { exact: true }).last().click();
      await expect(page.getByTestId('customer-home-scroll')).toBeVisible();
    }
    if (user.role === 'customer') {
      phase = 'orders';
      await page.getByText('Orders', { exact: true }).last().click();
      await expect(page.getByTestId('orders-list')).toBeVisible();
      await expect(page.getByText('Browser site', { exact: true }).first()).toBeVisible();
      assert.ok(successfulPaths.has('/api/customer/orders'));
      phase = 'project hub: open More';
      await page.getByText('More', { exact: true }).last().click();
      phase = 'project hub: open module';
      await page.getByTestId('role-module-projects').click();
      phase = 'project hub: route navigation';
      await page.waitForURL(url => url.pathname === '/customer/projects' || url.pathname === '/customer/projects/');
      phase = 'project hub: route heading';
      await expect(page.getByTestId('project-hub-heading')).toBeVisible();
      phase = 'project hub: authorized API';
      await expect.poll(() => successfulPaths.has('/api/customer/project-sites')).toBe(true);
      phase = 'project hub: return to More';
      // The native header back button uses expo-router's history, which is
      // not necessarily equivalent to browser history in Expo web tests.
      await page.getByTestId('project-hub-back').click();
      await expect(page.getByTestId('role-module-directory')).toBeVisible();
      phase = 'support create';
      await page.getByTestId('customer-support-widget').click();
      await page.getByTestId('customer-support-open-center').click();
      await page.getByTestId('support-category-GENERAL').click();
      await page.getByTestId('support-choice-other').click();
      await page.getByTestId('support-message').fill('Synthetic browser issue');
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assistant/support' && response.request().method() === 'POST');
      await page.getByTestId('support-escalate').click();
      const supportResponse = await created;
      assert.equal(supportResponse.status(), 200);
      const supportCase = (await supportResponse.json()).case_id;
      await expect(page.getByTestId('support-case-confirmation')).toBeVisible();
      await page.getByTestId(`support-case-${supportCase}`).click();
      await expect(page.getByTestId('support-case-detail').getByText('Synthetic browser issue', { exact: true })).toBeVisible();
      phase = 'support reply persistence';
      await page.getByTestId('support-case-reply').fill('Synthetic customer follow-up');
      await page.getByTestId('support-case-send-reply').click();
      await expect(page.getByTestId('support-case-detail').getByText('Synthetic customer follow-up', { exact: true })).toBeVisible();
      await page.reload();
      await page.getByTestId(`support-case-${supportCase}`).click();
      await expect(page.getByTestId('support-case-detail').getByText('Synthetic customer follow-up', { exact: true })).toBeVisible();
      await page.goBack();
    } else if (!['plant_owner', 'driver'].includes(user.role)) {
      phase = 'authorized collection';
      await expect.poll(() => [...successfulPaths].some(path => path.startsWith('/api/staff/collection/'))).toBe(true);
    }
    if (user.role === 'quality_engineer') {
      phase = 'quality inspection';
      const qualityRow = page.getByTestId(/^open-/).filter({visible:true}).first();
      const inspectedRowId = await qualityRow.getAttribute('data-testid');
      await qualityRow.click();
      await expect(page.getByTestId('qt-save')).toBeDisabled();
      await page.getByTestId('qt-slump').fill('125');
      await page.getByTestId('qt-cube7').fill('22.35');
      await page.getByTestId('qt-remarks').fill('Synthetic quality observation');
      await page.getByTestId('qt-result-FAIL').click();
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/quality' && response.request().method() === 'POST');
      await page.getByTestId('qt-save').click();
      const recorded = await saved;
      assert.equal(recorded.status(), 200);
      const inspectionId = (await recorded.json()).test_id;
      await expect(page.getByTestId('qt-history-' + inspectionId)).toContainText('Engineer assessment: FAIL');
      await expect(page.getByTestId('qt-slump')).toHaveValue('');
      await expect(page.getByTestId('qt-save')).toBeDisabled();
      phase = 'quality persistence: reload';
      await page.reload();
      phase = 'quality persistence: recorded strength';
      await expect(page.getByTestId('qt-history-' + inspectionId)).toContainText('22.35 MPa');
      phase = 'quality persistence: recorded remarks';
      await expect(page.getByTestId('qt-history-' + inspectionId)).toContainText('Synthetic quality observation');
      phase = 'quality persistence: single assessment';
      await expect(page.getByTestId('qt-history').getByText('Engineer assessment: FAIL', { exact: true })).toHaveCount(1);
      phase = 'quality persistence: return to collection';
      await page.getByTestId('qt-back').click();
      phase = 'quality persistence: collection status';
      await expect(page.getByTestId(inspectedRowId).filter({visible:true}).getByText('Engineer FAIL', { exact: true })).toBeVisible();
    }
    phase = 'logout';
    await page.getByText('More', { exact: true }).last().click();
    const logout = user.role === 'plant_owner' ? 'owner-logout' : user.role === 'driver' ? 'driver-logout' : 'logout-button';
    await page.getByTestId(logout).click();
    await expect(page.getByTestId('login-user-tab')).toBeVisible();
    await expect.poll(() => successfulPaths.has('/api/auth/logout')).toBe(true);
    const revoked = await context.request.get('http://127.0.0.1:8301/api/me', { headers: { Authorization: `Bearer ${token}` } });
    assert.ok([401, 403].includes(revoked.status()), 'Logout must revoke the server session');
    assert.deepEqual(failures, [], 'Browser API failures');
    assert.deepEqual(runtimeErrors, [], 'Browser runtime failures');
    await context.close();
    console.log(`PASS: ${user.role} real Expo login, authorized dashboard/records and revoked logout`);
  }
} catch (error) {
  // Playwright errors can contain fill values. Never print the original error.
  console.error(`FAIL: synthetic mobile browser role=${activeRole} phase=${phase}. No credential-bearing diagnostics retained.`);
  const safeFailure = String(error?.message).includes('strict mode violation') ? 'Ambiguous locator' : String(error?.message).includes('Timeout') ? 'Timeout' : 'Assertion or runtime failure';
  console.error(`Failure category: ${safeFailure}`);
  for (const diagnostic of safeDiagnostics) console.error(diagnostic);
  console.error(`Completed API paths: ${[...safeSuccessfulPaths].join(', ')}`);
  for (const diagnostic of startupDiagnostics) console.error(diagnostic);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  deliveries.clear();
  authenticators.clear();
  await new Promise(resolve => sink.close(resolve));
}
