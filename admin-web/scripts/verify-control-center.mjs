import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

assert.equal(process.env.APP_ENV, 'test');
const testAuthorityKey = Buffer.from('12345678901234567890');
let authenticatorKey = testAuthorityKey;

function decodeBase32(key) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of key) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid synthetic authenticator setup key');
    bits += value.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) || []).map(byte => parseInt(byte, 2)));
}

// RFC 6238 public test credential, seeded only in the disposable CI database.
function currentCode(){
const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
const mac = createHmac('sha1', authenticatorKey).update(counter).digest();
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
async function verifySupport(page,role) {
  await page.getByRole('button',{name:role==='authority'?'Customer Support':'support',exact:true}).click();
  const inbox=page.getByLabel('Internal support follow-up alerts');
  await inbox.getByRole('button',{name:/Review due case/}).waitFor();
  await inbox.getByRole('button',{name:/Review due case/}).click();
  await inbox.getByText('No unread follow-up reminders.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Reply or note',{exact:true}).inputValue(),'','another operator/case draft must never carry over');
  assert.equal(await page.getByRole('checkbox',{name:'Internal note (not visible to customer)',exact:true}).isChecked(),false);
  const message='Synthetic '+role+' support response';
  await page.getByLabel('Reply or note',{exact:true}).fill(message);
  const response=page.waitForResponse(r=>r.url().includes('/staff/cases/') && r.url().endsWith('/replies') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Send support reply',exact:true}).click();
  assert.equal((await response).status(),200);
  await page.getByText(message,{exact:true}).waitFor();
  // Deliberately leave an unsent private draft before logout/role switching.
  await page.getByLabel('Reply or note',{exact:true}).fill('Unsent private '+role+' note');
  await page.getByRole('checkbox',{name:'Internal note (not visible to customer)',exact:true}).check();
  if(role==='authority') assert.equal(await page.getByRole('button',{name:'CLOSED',exact:true}).count(),0);
  console.log('PASS: '+role+' sees own support alert, opens and acknowledges it, and submits an authorized visible reply');
}
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173');
  const adminEmail = 'support@trackmyrmc.com';
  // OTP delivery is tested through the real Rust route with an in-memory
  // transport. This browser uses a disposable SQL OTP fixture and no provider.
  await page.route('http://127.0.0.1:8000/api/admin/auth/otp/send', route => {
    assert.deepEqual(route.request().postDataJSON(), { email: adminEmail });
    return route.fulfill({json:{status:'EMAIL_OTP_SENT'}});
  });
  assert.equal(await page.getByLabel('Account password', { exact: true }).count(), 0);
  await page.getByLabel('Approved administrator email').fill(adminEmail);
  await page.getByRole('button', {name:'Send email verification code',exact:true}).click();
  await page.getByLabel('Email verification code', {exact:true}).fill('123456');
  await page.getByRole('button', {name:'Verify email code',exact:true}).click();
  authenticatorKey = decodeBase32(await page.getByLabel('Authenticator setup key').inputValue());
  await page.getByLabel('6-digit authenticator code', {exact:true}).fill(await freshCode());
  const adminLogin = page.waitForResponse(response=>response.url().endsWith('/api/admin/auth/verify-totp'));
  await page.getByRole('button', {name:'Confirm authenticator setup',exact:true}).click();
  const adminResponse = await adminLogin;
  assert.equal(adminResponse.status(), 200);
  const token = (await adminResponse.json()).token;
  await page.getByRole('heading', {name:'Save your recovery codes',exact:true}).waitFor();
  await page.getByLabel('I have saved the recovery codes', {exact:true}).check();
  await page.getByRole('button', {name:'Continue to Control Center',exact:true}).click();
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
  await verifySupport(page,'central_admin');
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
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token')),null,'bearer must not persist in browser storage');
  await page.getByRole('button', { name: 'Sign out and revoke session', exact: true }).click();
  await page.getByRole('heading', { name: 'Central Admin sign in', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('trackmyrmc_admin_token')), null);
  const revoked=await page.request.get('http://127.0.0.1:8000/api/admin/auth/me',{headers:{Authorization:'Bearer '+token}});
  // A successfully revoked access token is unauthenticated, not merely forbidden.
  assert.equal(revoked.status(), 401, 'signed-out admin session must be unauthorized');
  console.log('PASS: real Central Admin MFA, authorized workspaces and browser logout');
  authenticatorKey = testAuthorityKey;
  await page.getByRole('button', {name:'Delegated Authority sign in',exact:true}).click();
  await page.getByLabel('Approved Authority email').fill('ci-authority@example.invalid');
  await page.getByLabel('Account password', {exact:true}).fill(process.env.CI_CONTROL_CENTER_TEST_PASSWORD || '');
  await page.getByLabel('Authenticator code', {exact:true}).fill(currentCode());
  const authorityLogin = page.waitForResponse(response=>response.url().endsWith('/api/authority/auth/verify-totp'));
  await page.getByRole('button', {name:'Sign in with password + authenticator',exact:true}).click();
  const authorityToken = (await (await authorityLogin).json()).token;
  await page.getByRole('heading', {name:'Command Center',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token')),null);
  for (const kind of ['users','plants','orders','support']) {
    const response = await page.request.get('http://127.0.0.1:8000/api/authority/collections/'+kind,{headers:{Authorization:'Bearer '+authorityToken}});
    assert.equal(response.status(),200);
  }
  await verifySupport(page,'authority');
  const closeDenied=await page.request.post('http://127.0.0.1:8000/api/assistant/support/staff/cases/00000000-0000-4000-8000-000000000044/status',{headers:{Authorization:'Bearer '+authorityToken},data:{status:'CLOSED'}});
  assert.equal(closeDenied.status(),403);
  const denied = await page.request.get('http://127.0.0.1:8000/api/admin/auth/me',{headers:{Authorization:'Bearer '+authorityToken}});
  assert.equal(denied.status(),403);
  await page.getByRole('button', {name:'Sign out and revoke session',exact:true}).click();
  await page.getByRole('heading', {name:'Central Admin sign in',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('trackmyrmc_admin_token')),null);
  const authorityRevoked = await page.request.get('http://127.0.0.1:8000/api/authority/auth/me',{headers:{Authorization:'Bearer '+authorityToken}});
  assert.equal(authorityRevoked.status(),401);
  console.log('PASS: real Authority browser sign-in, scoped collections, cross-role denial and logout');
} finally {
  await browser.close();
}
