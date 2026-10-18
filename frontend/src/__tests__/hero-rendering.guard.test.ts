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

  it('renders exactly five new banners in the approved order', () => {
    assert.ok(home.includes('HomeCarousel'));
    assert.ok(carousel.includes('const AUTO_MS = 4500'));
    assert.ok(carousel.includes('const SLIDE_COUNT = SLIDES.length'));
    assert.ok(carousel.includes('pagingEnabled'));
    assert.ok(carousel.includes('aspectRatio: 16 / 9'));
    const filenames = ['Mixer.png', 'KYC-verification.png', 'Free-Calculator.png', 'Cashfree.png', 'CountryMap.png'];
    const imports = carousel.split("\n").filter(line => line.includes('source: require('))
      .map(line => line.split('assets/images/')[1]?.split('"')[0]);
    assert.deepEqual(imports.map(file => path.basename(file)), filenames);
    for (const file of imports) assert.ok(fs.existsSync(path.resolve(root, 'src/components', file)), file);
    assert.ok(carousel.includes('contentFit="contain"'));
    assert.ok(!carousel.includes('support.png'));
  });

  it('uses two theme backgrounds with a 35 percent image layer and glass card surfaces', () => {
    const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
    const scene = fs.readFileSync(path.join(root, 'src/theme/sceneBackground.ts'), 'utf8');
    const activePage = fs.readFileSync(path.join(root, 'src/components/ThemedScreen.tsx'), 'utf8');
    const colors = fs.readFileSync(path.join(root, 'src/theme/tokens.ts'), 'utf8');
    const card = fs.readFileSync(path.join(root, 'src/components/ui/Card.tsx'), 'utf8');
    for (const image of ['Background Light Theme.png', 'Background Dark Theme.png']) {
      assert.ok(scene.includes(image));
      assert.ok(activePage.includes(image));
      assert.ok(fs.existsSync(path.join(root, 'assets/images', image)));
    }
    assert.ok(fs.existsSync(path.join(root, 'assets/images', 'Background Light Theme.PNG')));
    assert.ok(activePage.includes('opacity: 0.35'));
    assert.ok(scene.includes('rgba(247,248,249,0.65)'));
    assert.ok(scene.includes('rgba(14,17,22,0.65)'));
    assert.ok(layout.includes('contentStyle: getThemedSceneStyle(colors)'));
    assert.ok(!layout.includes('contentStyle: { backgroundColor: "transparent" }'));
    assert.ok(colors.includes('surfaceSecondary: "rgba('));
    assert.ok(card.includes('backgroundColor: colors.surfaceSecondary'));
  });

  it('isolates tab scenes and keeps each customer tab artwork behind its own content', () => {
    for (const role of ['customer', 'owner', 'driver']) {
      const layout = fs.readFileSync(path.join(root, 'app', role, '_layout.tsx'), 'utf8');
      assert.ok(!layout.includes("sceneStyle: { backgroundColor: 'transparent' }"), role);
    }
    const staff = fs.readFileSync(path.join(root, 'src/screens/StaffTabs.tsx'), 'utf8');
    assert.ok(staff.includes('sceneStyle: getThemedSceneStyle(colors)'));
    const customerLayout = fs.readFileSync(path.join(root, 'app/customer/_layout.tsx'), 'utf8');
    assert.ok(customerLayout.includes('getThemedCanvasColor(colors)'));
    for (const route of ['index', 'orders', 'plants', 'more']) {
      const screen = fs.readFileSync(path.join(root, 'app/customer', route + '.tsx'), 'utf8');
      assert.ok(screen.includes('<ThemedScreen>'), route);
      assert.ok(screen.includes('</ThemedScreen>'), route);
    }
  });
});
