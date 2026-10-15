import { chromium, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// The real Expo UI, Rust router and disposable PostgreSQL database are used.
// Only delivery is replaced. All transient codes remain in process memory;
// no traces, screenshots, response bodies or credential-bearing errors are saved.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.APP_ENV, 'test');
const root = fileURLToPath(new URL('../../', import.meta.url));
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
try {
  const api = start('cargo', ['run', '--manifest-path', 'backend/Cargo.toml', '--example', 'mobile_browser_fixture']);
  api.stdin.end(JSON.stringify({ capture_token: captureToken, totp_secrets: Object.fromEntries([...authenticators].map(([role, bytes]) => [role, base32(bytes)])) }));
  await ready('http://127.0.0.1:8301/health', api);
  phase = 'Expo startup';
  const web = start(process.execPath, ['node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--offline', '--port', '8081', '--max-workers', '2'], {
    cwd: fileURLToPath(new URL('../../frontend/', import.meta.url)),
    env: { ...process.env, CI: 'true', EXPO_PUBLIC_BACKEND_URL: 'http://127.0.0.1:8301' },
  });
  await ready('http://127.0.0.1:8081', web);
  browser = await chromium.launch();
  for (const user of manifest.users) {
    activeRole = user.role;
    assert.ok(!['admin', 'authority', 'central_admin'].includes(user.role));
    phase = 'login';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const failures = [], runtimeErrors = [];
    safeDiagnostics = failures;
    const successfulPaths = new Set();
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
    phase = 'dashboard';
    const summary = user.role === 'customer' ? 'customer-home-scroll' : `${['plant_owner', 'driver'].includes(user.role) ? rolePath : 'staff'}-home-summary`;
    await expect(page.getByTestId(summary)).toBeVisible();
    const homePath = `/api/${['customer', 'driver', 'plant_owner'].includes(user.role) ? rolePath : 'staff'}/home`;
    await expect.poll(() => successfulPaths.has(homePath)).toBe(true);
    await expect.poll(() => currentIdentity?.role).toBe(user.role);
    assert.ok(currentIdentity.name && token);
    if (user.role !== 'customer') assert.ok(currentIdentity.plant_id);
    if (user.role === 'customer') {
      phase = 'orders';
      await page.getByText('Orders', { exact: true }).last().click();
      await expect(page.getByTestId('orders-list')).toBeVisible();
      await expect(page.getByText('Browser site', { exact: true }).first()).toBeVisible();
      assert.ok(successfulPaths.has('/api/customer/orders'));
    } else if (!['plant_owner', 'driver'].includes(user.role)) {
      phase = 'authorized collection';
      await expect.poll(() => [...successfulPaths].some(path => path.startsWith('/api/staff/collection/'))).toBe(true);
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
} catch {
  // Playwright errors can contain fill values. Never print the original error.
  console.error(`FAIL: synthetic mobile browser role=${activeRole} phase=${phase}. No credential-bearing diagnostics retained.`);
  for (const diagnostic of safeDiagnostics) console.error(diagnostic);
  for (const diagnostic of startupDiagnostics) console.error(diagnostic);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  deliveries.clear();
  authenticators.clear();
  await new Promise(resolve => sink.close(resolve));
}
