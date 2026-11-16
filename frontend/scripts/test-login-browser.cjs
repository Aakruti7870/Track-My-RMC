const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium } = require('../../admin-web/node_modules/playwright');

const origin = 'http://127.0.0.1:8765';
const previewDir = 'login-previews';
const accessToken = { access_token: 'browser-test-session' };
mkdirSync(previewDir, { recursive: true });

const fixtureAccount = (role) => ({
  id: 'browser-test-user',
  name: 'Test User',
  role,
  roles: [role],
  phone: '+919000000000',
  is_active: true,
  status: 'active',
  kyc_status: 'VERIFIED',
  mfa_enabled: role === 'dispatcher',
  plant_id: role === 'dispatcher' ? 'browser-test-plant' : null,
});

async function openLogin(browser, { width = 390, colorScheme = 'dark', role = 'customer', reducedMotion = 'reduce' } = {}, endpoints = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, reducedMotion });
  await page.route('https://trackmyrmc.com/api/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (endpoints[endpoint]) return endpoints[endpoint](route);
    if (endpoint === '/me') return route.fulfill({ json: fixtureAccount(role) });
    if (endpoint === '/customer/home') return route.fulfill({
      json: { name: 'Test User', kyc_status: 'VERIFIED', active_order: null, recent_orders: [] },
    });
    if (endpoint === '/driver/home') return route.fulfill({
      json: { name: 'Test User', checked_in: false, completed_today: 0 },
    });
    if (endpoint === '/driver/identity') return route.fulfill({
      json: { driver_name: 'Test User', employment: {} },
    });
    if (endpoint === '/auth/logout') return route.fulfill({ status: 204 });
    if (endpoint === '/auth/refresh') return route.fulfill({ status: 401, json: { message: 'Sign in required' } });
    if (endpoint.startsWith('/auth/')) return route.fulfill({ status: 500, json: { message: 'Unexpected authentication request' } });
    return route.fulfill({ json: {} });
  });
  await page.route(origin + '/login', (route) => route.continue({ url: origin + '/login.html' }));
  await page.goto(origin + '/login');
  await page.getByTestId('login-card').waitFor();
  await page.getByTestId('login-help-widget').waitFor();
  return page;
}

async function assertFits(page, id, shellId = 'login-card') {
  const box = await page.getByTestId(id).boundingBox();
  const shell = await page.getByTestId(shellId).boundingBox();
  assert(box && shell && box.x >= shell.x - 1 && box.x + box.width <= shell.x + shell.width + 1, id + ' fits its container');
}

async function checkLayout(browser) {
  for (const width of [320, 390, 1440]) {
    for (const colorScheme of ['dark', 'light']) {
      const page = await openLogin(browser, { width, colorScheme });
      const hero = page.getByTestId('login-hero');
      const image = hero.locator('img');
      await image.waitFor();
      await page.waitForFunction((element) => element.complete && element.naturalWidth > 0, await image.elementHandle());
      const heroBounds = await hero.boundingBox();
      const shell = await page.getByTestId('login-card').boundingBox();
      assert(Math.abs(heroBounds.width - Math.min(width, 760)) <= 1, 'User Login renders the full hero width');
      assert(Math.abs(heroBounds.width / heroBounds.height - (colorScheme === 'dark' ? 1229 : 1227) / 615) < 0.02);
      assert(shell.y >= heroBounds.y + heroBounds.height - 1, 'The card sits below the uncropped hero');
      assert(Math.abs(shell.x + shell.width / 2 - width / 2) <= 1, 'The card is centered');
      assert(await page.getByTestId('login-send-otp').isDisabled());
      for (const id of ['login-user-tab', 'login-plant-tab', 'login-mobile-input', 'login-send-otp', 'login-review-access', 'login-terms-link', 'login-privacy-link', 'login-delete-account']) {
        await assertFits(page, id);
      }
      const reviewer = await page.getByTestId('login-review-access').boundingBox();
      const legal = await page.getByTestId('login-terms-link').boundingBox();
      assert(reviewer.height >= 44 && reviewer.y + reviewer.height <= legal.y);
      const pill = await page.getByTestId('login-review-access').locator(':scope > div').boundingBox();
      assert(pill.height >= 39 && pill.height <= 41);
      const support = page.getByTestId('login-help-widget');
      const supportBox = await support.boundingBox();
      await assertFits(page, 'login-help-widget');
      assert(supportBox.x >= reviewer.x + reviewer.width, 'Support is to the right of the reviewer pill');
      assert(Math.abs(supportBox.y + supportBox.height / 2 - reviewer.y - reviewer.height / 2) <= 1, 'Support and reviewer share a row');
      assert.equal(supportBox.width, 44);
      assert.equal(supportBox.height, 44);
      const supportStyle = await support.evaluate((element) => {
        const style = getComputedStyle(element);
        return { radius: style.borderTopLeftRadius, border: style.borderTopWidth, fill: style.backgroundColor };
      });
      assert.deepEqual(supportStyle, {
        radius: '22px', border: '1px', fill: colorScheme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(250, 249, 245)',
      });
      assert.equal(await support.locator('svg').count(), 1);
      assert.equal(await support.locator('img').count(), 0);
      assert.equal(await page.getByTestId('login-theme-toggle').count(), 0);
      assert.equal(await page.getByRole('button', { name: /switch light or dark mode/i }).count(), 0);
      const credit = await page.getByTestId('login-powered-by').boundingBox();
      assert(credit.y + credit.height <= 900, 'The full login footer fits the normal-height viewport');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({ path: `${previewDir}/login-${colorScheme}-${width}.png`, fullPage: true });
      if (width === 390) {
        await page.setViewportSize({ width, height: 700 });
        const assertHeroWidth = async (tab) => {
          const bounds = await hero.boundingBox();
          assert(Math.abs(bounds.width - width) <= 1 && Math.abs(bounds.x) <= 1, tab + ' uses the full mobile hero width');
          assert.equal(await page.getByTestId('login-card').locator('radialGradient').count(), colorScheme === 'dark' ? 1 : 0);
        };
        await assertHeroWidth('User Login');
        await page.getByTestId('login-plant-tab').click();
        await page.getByTestId('login-plant-send-otp').waitFor();
        await assertHeroWidth('Plant Staff');
        await page.getByTestId('login-user-tab').click();
        await page.getByTestId('login-send-otp').waitFor();
        await assertHeroWidth('User Login after tab switch');
        await page.setViewportSize({ width, height: 900 });
      }
      if (width === 390 && colorScheme === 'dark') {
        await support.click();
        await page.getByTestId('login-help-panel').waitFor();
        await page.getByTestId('login-help-login-issue').click();
        await page.getByTestId('login-help-login-card').getByText(/6-digit WhatsApp OTP/).waitFor();
        await page.getByTestId('login-help-close').click();
        await page.getByTestId('login-help-panel').waitFor({ state: 'hidden' });
        await page.getByTestId('login-review-access').click();
        await page.waitForURL((url) => url.pathname === '/review-access');
      }
      await page.close();
    }
  }
}

async function checkWhatsApp(browser, role, resumeKyc = false) {
  let sends = 0;
  let attempts = 0;
  const phone = role === 'driver' ? '+12025550101' : '+919000000000';
  const page = await openLogin(browser, { width: 320, role, reducedMotion: resumeKyc ? 'reduce' : 'no-preference' }, {
    '/auth/otp/whatsapp/send': (route) => {
      assert.deepEqual(route.request().postDataJSON(), { phone });
      sends += 1;
      return route.fulfill({ status: 204 });
    },
    '/auth/otp/whatsapp/verify': (route) => {
      attempts += 1;
      const { phone: submittedPhone, otp } = route.request().postDataJSON();
      assert.equal(submittedPhone, phone);
      return otp === '111111'
        ? route.fulfill({ status: 401, json: { message: 'Incorrect code for this test' } })
        : route.fulfill({ json: accessToken });
    },
  });
  if (resumeKyc) {
    await page.evaluate(() => localStorage.setItem('kyc_pending', JSON.stringify(Date.now())));
  }
  const mobile = page.getByTestId('login-mobile-input');
  await mobile.fill(role === 'driver' ? '+1 202 555 0101' : '9000000000');
  await mobile.press('Enter');
  const otp = page.getByTestId('login-user-otp-input');
  await otp.waitFor();
  assert.equal(sends, 1);
  await assertFits(page, 'login-user-otp-input-slots', 'login-user-otp-input-card');
  await page.getByText(/Resend in \d+s/).waitFor();
  await page.screenshot({ path: `${previewDir}/whatsapp-otp-320-${role}-${resumeKyc ? 'kyc' : 'home'}.png`, fullPage: true });
  if (role === 'customer' && !resumeKyc) {
    await otp.fill('111111', { force: true });
    await page.getByText('Incorrect code for this test').waitFor();
    assert.equal(await otp.inputValue(), '');
    assert(await otp.isEditable());
  }
  await otp.fill('222222', { force: true });
  await page.waitForURL((url) => resumeKyc
    ? url.pathname === '/kyc' && url.searchParams.get('returned') === '1'
    : url.pathname === '/' + role);
  assert.equal(attempts, role === 'customer' && !resumeKyc ? 2 : 1);
  if (!resumeKyc) {
    const more = page.getByTestId('tab-more');
    await more.click();
    await page.waitForURL(url => url.pathname === '/' + role + '/more');
    if (role === 'customer') await page.getByTestId('customer-account-profile').waitFor();
    await more.click({ clickCount: 3 });
    assert.equal(await more.getAttribute('aria-selected'), 'true');
    assert.equal(new URL(page.url()).pathname, '/' + role + '/more');
    if (role === 'customer') {
      await page.getByTestId('tab-home').click();
      await page.waitForURL((url) => url.pathname === '/customer');
      const headerSymbol = page.getByTestId('header-help').locator('svg');
      await headerSymbol.waitFor();
      const supportShape = await headerSymbol.innerHTML();
      await page.getByTestId('header-theme').click();
      await page.waitForFunction(() => localStorage.getItem('tmrmc_theme_mode') === JSON.stringify('light'));
      await page.getByTestId('tab-more').click();
      await page.getByTestId('logout-button').click();
      await page.waitForURL((url) => url.pathname === '/login');

      async function checkSavedLightLogin() {
        await page.waitForFunction(() => {
          const hero = document.querySelector('[data-testid="login-hero"] img');
          const support = document.querySelector('[data-testid="login-help-widget"]');
          return hero?.complete && hero.naturalWidth === 1227
            && support && getComputedStyle(support).backgroundColor === 'rgb(250, 249, 245)';
        });
        assert.equal(await page.getByTestId('login-help-widget').locator('svg').innerHTML(), supportShape);
        assert.equal(await page.getByTestId('login-theme-toggle').count(), 0);
      }

      await checkSavedLightLogin();
      await page.reload();
      await checkSavedLightLogin();
    }
  }
  await page.close();
}

async function checkStaff(browser, enrollmentRequired) {
  let emailVerifications = 0;
  let setupAttempts = 0;
  let confirmed = false;
  const email = 'dispatcher@example.test';
  const page = await openLogin(browser, { width: 320, role: 'dispatcher' }, {
    '/auth/otp/email/send': (route) => {
      assert.deepEqual(route.request().postDataJSON(), { email });
      return route.fulfill({ json: { status: 'OTP_SENT', channel: 'email' } });
    },
    '/auth/otp/email/verify': (route) => {
      emailVerifications += 1;
      assert.deepEqual(route.request().postDataJSON(), { email, otp: '222222' });
      return route.fulfill({ json: {
        status: enrollmentRequired ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED',
        mfa_setup_required: enrollmentRequired,
        challenge_token: 'fixture-first-factor',
        email,
      } });
    },
    '/auth/staff/mfa/enroll/start': (route) => {
      assert.deepEqual(route.request().postDataJSON(), { challenge_token: 'fixture-first-factor' });
      setupAttempts += 1;
      return setupAttempts === 1
        ? route.fulfill({ status: 503, json: { message: 'Setup temporarily unavailable' } })
        : route.fulfill({ json: {
          status: 'MFA_ENROLLMENT_STARTED',
          manual_key: 'TEST SETUP KEY',
          otpauth_uri: 'otpauth://totp/TrackMyRMC:Fixture',
          recovery_codes: ['CODE-TEST-ONE', 'CODE-TEST-TWO'],
        } });
    },
    '/auth/staff/mfa/enroll/confirm': (route) => {
      assert.deepEqual(route.request().postDataJSON(), { challenge_token: 'fixture-first-factor', code: '333333' });
      confirmed = true;
      return route.fulfill({ json: { status: 'MFA_ENABLED', challenge_token: 'fixture-enrolled', recovery_codes: [] } });
    },
    '/auth/staff/mfa/verify-totp': (route) => {
      assert(confirmed);
      assert.deepEqual(route.request().postDataJSON(), { challenge_token: 'fixture-enrolled', code: '444444' });
      return route.fulfill({ json: accessToken });
    },
    '/auth/staff/mfa/verify-recovery': (route) => {
      assert.deepEqual(route.request().postDataJSON(), { challenge_token: 'fixture-first-factor', code: 'CODE-TEST-ONE' });
      return route.fulfill({ json: accessToken });
    },
  });

  await page.getByTestId('login-plant-tab').click();
  await page.getByTestId('login-plant-email-input').fill(email);
  await page.getByTestId('login-plant-send-otp').click();
  await page.screenshot({ path: `${previewDir}/plant-staff-320.png`, fullPage: true });
  await page.getByTestId('login-plant-otp-input').fill('222222', { force: true });
  if (enrollmentRequired) {
    await page.getByText('The service is temporarily unavailable. Please try again.').waitFor();
    assert.equal(await page.getByTestId('login-plant-otp-input').count(), 0);
    await page.getByRole('button', { name: 'Retry setup' }).click();
    await page.getByText('TEST SETUP KEY', { exact: true }).waitFor();
    await page.getByTestId('login-staff-enroll-input').fill('333333', { force: true });
    await page.getByText('CODE-TEST-ONE', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'I Saved Them — Continue' }).click();
    await page.getByTestId('login-plant-authenticator-input').fill('444444', { force: true });
    assert.equal(setupAttempts, 2);
  } else {
    await page.getByTestId('login-use-recovery').click();
    await page.getByRole('button', { name: 'Back to Authenticator' }).click();
    await page.getByTestId('login-plant-authenticator-input').waitFor();
    await page.getByTestId('login-use-recovery').click();
    await page.getByTestId('login-plant-recovery-input').fill('code-test-one');
    await page.getByRole('button', { name: 'Recover & Login' }).click();
  }
  await page.waitForURL((url) => url.pathname === '/dispatcher');
  assert.equal(emailVerifications, 1);
  await page.close();
}

async function checkOnboarding(browser) {
  const email = 'owner@example.test';
  const page = await openLogin(browser, {}, {
    '/auth/otp/email/send': (route) => route.fulfill({ json: { status: 'ONBOARDING_REQUIRED', email } }),
  });
  await page.getByTestId('login-plant-tab').click();
  await page.getByTestId('login-plant-email-input').fill(email);
  await page.getByTestId('login-plant-send-otp').click();
  await page.getByTestId('login-get-onboard').click();
  await page.waitForURL((url) => url.pathname === '/plant-onboarding'
    && url.searchParams.get('email') === email && url.searchParams.get('mode') === 'owner_registration');
  await page.getByTestId('onboarding-register-official-email').waitFor();
  assert.equal(await page.getByTestId('onboarding-email').inputValue(), '');
  assert.equal(new URL(page.url()).searchParams.has('email'), false);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.HEADER_CHROMIUM_PATH ? { executablePath: process.env.HEADER_CHROMIUM_PATH } : {}),
  });
  try {
    await checkLayout(browser);
    await checkWhatsApp(browser, 'customer');
    await checkWhatsApp(browser, 'driver');
    await checkWhatsApp(browser, 'customer', true);
    await checkStaff(browser, true);
    await checkStaff(browser, false);
    await checkOnboarding(browser);
    console.log('Login layout, shared support, saved theme, and customer, driver, KYC, staff and onboarding journeys passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
