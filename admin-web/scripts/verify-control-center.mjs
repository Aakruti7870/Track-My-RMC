import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

// RFC 6238 public test credential, seeded only in the disposable CI database.
const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
const mac = createHmac('sha1', '12345678901234567890').update(counter).digest();
const offset = mac[19] & 15;
const code = String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Approved administrator email').fill('ci-admin@example.invalid');
  await page.getByLabel('Authenticator code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Sign in with authenticator', exact: true }).click();
  await page.getByRole('heading', { name: 'Command Center', exact: true }).waitFor();
  await page.getByRole('button', { name: 'users', exact: true }).click();
  await page.locator('tbody').getByText('CI Central Admin', { exact: true }).waitFor();
  for (const kind of ['plants', 'orders', 'support', 'audit', 'sessions']) {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/control-center/collections/' + kind)),
      page.getByRole('button', { name: kind, exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);

    await page.getByRole('heading', { name: kind, exact: true }).waitFor();
  }
  assert.equal(await page.getByRole('alert').count(), 0);
  const token=await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token'));
  await page.getByRole('button', { name: 'Sign out and revoke session', exact: true }).click();
  await page.getByRole('heading', { name: 'Central Admin sign in', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('trackmyrmc_admin_token')), null);
  const revoked=await page.request.get('http://127.0.0.1:8000/api/admin/auth/me',{headers:{Authorization:'Bearer '+token}});
  assert.equal(revoked.status(),403);
  console.log('PASS: real Central Admin MFA, authorized workspaces and browser logout');
} finally {
  await browser.close();
}
