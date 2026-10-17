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

  it('renders all five uploaded banners followed by India coverage', () => {
    assert.ok(home.includes('HomeCarousel'));
    assert.ok(carousel.includes('const AUTO_MS = 4500'));
    assert.ok(carousel.includes('const SLIDE_COUNT = 6'));
    assert.ok(carousel.includes('pagingEnabled'));
    assert.ok(carousel.includes('aspectRatio: 16 / 9'));

    const slides = ['<HeroSlide', '<CalculatorSlide', '<CashfreeSlide', '<KycSlide', '<SupportSlide', '<IndiaSlide'];
    const positions = slides.map(slide => carousel.indexOf(slide));
    assert.ok(positions.every(position => position >= 0));
    assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
  });

  it('resolves every carousel image import to a real uploaded file', () => {
    const imports = [...carousel.matchAll(/require\\("(\\.\\.\\/\\.\\.\\/assets\\/images\\/[^"\\n]+)"\\)/g)];
    assert.equal(imports.length, 5);
    for (const [, relativeAsset] of imports) {
      const absoluteAsset = path.resolve(root, 'src/components', relativeAsset);
      assert.ok(fs.existsSync(absoluteAsset), `Missing carousel image: ${relativeAsset}`);
    }
    for (const filename of [
      'RMC truck Banner .png',
      'Calculator Banner.png',
      'Cashfree Banner.png',
      'KYC banner .png',
      'Customer support Banner .png',
    ]) {
      assert.ok(carousel.includes(filename));
    }
    assert.ok(carousel.includes('contentFit="contain"'));
  });

  it('limits the India coverage banner to the approved launch regions', () => {
    assert.ok(carousel.includes('Maharashtra, Goa & Karnataka'));
    assert.ok(carousel.includes('Maharashtra · Goa · Karnataka'));
  });
});
