import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('final login and customer hero guards', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const login = fs.readFileSync(path.join(root, 'src/screens/LoginScreen.tsx'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'app/customer/index.tsx'), 'utf8');
  const carousel = fs.readFileSync(path.join(root, 'src/components/HomeCarousel.tsx'), 'utf8');

  it('switches dedicated light and dark login heroes without cropping', () => {
    assert.ok(login.includes('HERO_LIGHT'));
    assert.ok(login.includes('HERO_DARK'));
    assert.ok(login.includes('colors.isDark ? HERO_DARK : HERO_LIGHT'));
    assert.ok(login.includes('contentFit="contain"'));
    assert.doesNotMatch(login, /source=\{heroSource\}[\s\S]{0,160}contentFit="cover"/);
  });

  it('keeps the required login legal/footer order and removes Contact Us', () => {
    const terms = login.indexOf('Terms & Conditions');
    const privacy = login.indexOf('Privacy Policy');
    const deletion = login.indexOf('Delete Account');
    const secured = login.indexOf('Secured with 6-digit OTP verification');
    const review = login.indexOf('REVIEW APP · Google Play reviewer access');
    const powered = login.indexOf('Powered by');

    for (const value of [terms, privacy, deletion, secured, review, powered]) assert.ok(value >= 0);
    assert.ok(terms < privacy);
    assert.ok(privacy < deletion);
    assert.ok(deletion < secured);
    assert.ok(secured < review);
    assert.ok(review < powered);
    assert.doesNotMatch(login, /Contact Us/);
    assert.doesNotMatch(login, /textDecorationLine\s*:\s*["']underline["']/);
  });

  it('renders the final four-slide customer carousel in the required order', () => {
    assert.ok(home.includes('HomeCarousel'));
    assert.ok(carousel.includes('const AUTO_MS = 4500'));
    assert.ok(carousel.includes('const SLIDE_COUNT = 4'));
    assert.ok(carousel.includes('pagingEnabled'));
    assert.ok(carousel.includes('aspectRatio: 16 / 9'));

    const hero = carousel.indexOf('<HeroSlide');
    const cashfree = carousel.indexOf('<CashfreeSlide');
    const kyc = carousel.indexOf('<KycSlide');
    const india = carousel.indexOf('<IndiaSlide');
    assert.ok(hero >= 0 && hero < cashfree && cashfree < kyc && kyc < india);
  });

  it('keeps slide one theme-aware and promo slides on their permanent themes', () => {
    assert.ok(carousel.includes('home-hero-light.jpg'));
    assert.ok(carousel.includes('home-hero-dark.jpg'));
    assert.ok(carousel.includes('colors.isDark ? HERO_DARK : HERO_LIGHT'));
    assert.ok(carousel.includes('Cashfree Payments'));
    assert.ok(carousel.includes('KYC MANDATORY'));
    assert.ok(carousel.includes('DigiLocker'));
  });

  it('limits the India coverage banner to the approved launch regions', () => {
    assert.ok(carousel.includes('Maharashtra, Goa & Karnataka'));
    assert.ok(carousel.includes('Maharashtra · Goa · Karnataka'));
  });
});
