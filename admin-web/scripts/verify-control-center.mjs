import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

// RFC 6238 public test credential, seeded only in the disposable CI database.
function currentCode(){
const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
const mac = createHmac('sha1', '12345678901234567890').update(counter).digest();
const offset = mac[19] & 15;
return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
// Replayed possession proofs must fail. Wait for a fresh authenticator step
// between login and each new step-up rather than weakening the server guard.
let lastStep = -1;
async function freshCode() {
  while (Math.floor(Date.now()/30000) <= lastStep) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  lastStep = Math.floor(Date.now()/30000);
  return currentCode();
}
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Approved administrator email').fill('ci-admin@example.invalid');
  await page.getByLabel('Account password', { exact: true }).fill(process.env.CI_CONTROL_CENTER_TEST_PASSWORD || '');
  await page.getByLabel('Authenticator code', { exact: true }).fill(await freshCode());
  await page.getByRole('button', { name: 'Sign in with password + authenticator', exact: true }).click();
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
  await page.getByRole('button',{name:'Plant Owner approvals and access',exact:true}).click();
  const application=page.locator('article').filter({has:page.getByRole('heading',{name:/CI Approval Plant/})});
  await application.getByLabel('city',{exact:true}).fill('Test City');
  await application.getByLabel('state',{exact:true}).fill('Test Region');
  await application.getByLabel('pincode',{exact:true}).fill('400001');
  await page.getByLabel('Fresh authenticator code',{exact:true}).fill(await freshCode());
  await page.getByLabel('Reason for privileged change',{exact:true}).fill('Approve synthetic Owner registration');
  const approved=page.waitForResponse(response=>response.url().endsWith('/approve') && response.request().method()==='POST');
  await application.getByRole('button',{name:'Approve Plant Owner and plant',exact:true}).click();
  const approval=await approved;assert.equal(approval.status(),200);const identity=await approval.json();
  await page.getByText('No pending Plant Owner requests.',{exact:true}).waitFor();
  await page.getByLabel('Registered Plant Owner account ID',{exact:true}).fill(identity.owner_id);
  await page.getByLabel('Fresh authenticator code',{exact:true}).fill(await freshCode());
  await page.getByLabel('Reason for privileged change',{exact:true}).fill('Suspend compromised synthetic Owner');
  const suspended=page.waitForResponse(response=>response.url().endsWith('/status') && response.request().method()==='POST');
  await page.getByRole('button',{name:'Suspend / revoke Owner access',exact:true}).click();
  assert.equal((await suspended).status(),200);
  console.log('PASS: real Control Center Owner approval and revocation require authenticated step-up');
  const token=await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token'));
  await page.getByRole('button', { name: 'Sign out and revoke session', exact: true }).click();
  await page.getByRole('heading', { name: 'Central Admin sign in', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('trackmyrmc_admin_token')), null);
  const revoked=await page.request.get('http://127.0.0.1:8000/api/admin/auth/me',{headers:{Authorization:'Bearer '+token}});
  // A successfully revoked access token is unauthenticated, not merely forbidden.
  assert.equal(revoked.status(), 401, 'signed-out admin session must be unauthorized');
  console.log('PASS: real Central Admin MFA, authorized workspaces and browser logout');
  await page.getByRole('button', {name:'Delegated Authority sign in',exact:true}).click();
  await page.getByLabel('Approved Authority email').fill('ci-authority@example.invalid');
  await page.getByLabel('Account password', {exact:true}).fill(process.env.CI_CONTROL_CENTER_TEST_PASSWORD || '');
  await page.getByLabel('Authenticator code', {exact:true}).fill(currentCode());
  await page.getByRole('button', {name:'Sign in with password + authenticator',exact:true}).click();
  await page.getByRole('heading', {name:'Command Center',exact:true}).waitFor();
  const authorityToken = await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token'));
  for (const kind of ['users','plants','orders','support']) {
    const response = await page.request.get('http://127.0.0.1:8000/api/authority/collections/'+kind,{headers:{Authorization:'Bearer '+authorityToken}});
    assert.equal(response.status(),200);
  }
  const denied = await page.request.get('http://127.0.0.1:8000/api/admin/auth/me',{headers:{Authorization:'Bearer '+authorityToken}});
  assert.equal(denied.status(),403);
  await page.getByRole('button', {name:'Sign out and revoke session',exact:true}).click();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token')),null);
  const authorityRevoked = await page.request.get('http://127.0.0.1:8000/api/authority/auth/me',{headers:{Authorization:'Bearer '+authorityToken}});
  assert.equal(authorityRevoked.status(),401);
  console.log('PASS: real Authority browser sign-in, scoped collections, cross-role denial and logout');
} finally {
  await browser.close();
}
