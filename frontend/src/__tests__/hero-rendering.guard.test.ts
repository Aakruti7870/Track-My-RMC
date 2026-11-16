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

  it('keeps reviewer access and the login legal/footer order', () => {
    const terms = login.indexOf('Terms & Conditions');
    const privacy = login.indexOf('Privacy Policy');
    const deletion = login.indexOf('Delete Account');
    const secured = login.indexOf('Secured with 6-digit OTP verification');
    const review = login.indexOf('testID="login-review-access"');
    const powered = login.indexOf('Powered by');

    for (const value of [terms, privacy, deletion, secured, review, powered]) assert.ok(value >= 0);
    assert.ok(terms < privacy);
    assert.ok(privacy < deletion);
    assert.ok(secured < review);
    assert.ok(deletion < powered);
    assert.ok(review < terms);
    assert.doesNotMatch(login, /Contact Us/);
    assert.match(login, /legalLink: \{[^\n]*textDecorationLine: "underline"/);
  });

  it('renders the six uploaded banners in carousel order', () => {
    assert.ok(home.includes('HomeCarousel'));
    assert.ok(carousel.includes('const AUTO_MS = 4500'));
    assert.ok(carousel.includes('const SLIDE_COUNT = SLIDES.length'));
    assert.ok(carousel.includes('pagingEnabled'));
    assert.ok(carousel.includes('aspectRatio: 16 / 9'));
    const filenames = ['order-concrete.webp', 'track-order.webp', 'nearby-plants.webp', 'rmc-calculator.webp', 'bulk-concrete.webp', 'delivery-challans.webp'];
    const imports = carousel.split("\n").filter(line => line.includes('source: require('))
      .map(line => line.split('assets/images/')[1]?.split('"')[0]);
    assert.deepEqual(imports.map(file => path.basename(file)), filenames);
    for (const file of imports) assert.ok(fs.existsSync(path.join(root, 'assets/images', file)), file);
    assert.ok(carousel.includes('contentFit="contain"'));
    assert.ok(!carousel.includes('support.png'));
  });

  it('uses two theme backgrounds with a subdued image layer and matte card surfaces', () => {
    const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
    const scene = fs.readFileSync(path.join(root, 'src/theme/sceneBackground.ts'), 'utf8');
    const activePage = fs.readFileSync(path.join(root, 'src/components/ThemedScreen.tsx'), 'utf8');
    const colors = fs.readFileSync(path.join(root, 'src/theme/tokens.ts'), 'utf8');
    const card = fs.readFileSync(path.join(root, 'src/components/ui/Card.tsx'), 'utf8');
    for (const image of ['Background Light Theme.webp', 'Background Dark Theme.webp']) {
      assert.ok(scene.includes(image));
      assert.ok(activePage.includes(image));
      assert.ok(fs.existsSync(path.join(root, 'assets/images', image)));
    }
    assert.ok(fs.existsSync(path.join(root, 'assets/images', 'Background Light Theme.PNG')));
    assert.ok(activePage.includes('opacity: 0.15'));
    assert.ok(scene.includes('rgba(233,228,222,0.85)'));
    assert.ok(scene.includes('rgba(7,8,13,0.85)'));
    assert.ok(layout.includes('contentStyle: getThemedSceneStyle(colors)'));
    assert.ok(!layout.includes('contentStyle: { backgroundColor: "transparent" }'));
    assert.match(colors, /surfaceSecondary: "#[0-9A-F]{6}"/);
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
