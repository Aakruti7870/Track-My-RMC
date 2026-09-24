import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const releaseWorkflow = fs.readFileSync(new URL('../../.github/workflows/release-signed-aab.yml', import.meta.url), 'utf8');
const candidateWorkflow = fs.readFileSync(new URL('../../.github/workflows/pre-aab-candidate-validation.yml', import.meta.url), 'utf8');
const deployWorkflow = fs.readFileSync(new URL('../../.github/workflows/deploy-production-web.yml', import.meta.url), 'utf8');
const indexRoute = fs.readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8');

const iconPath = new URL('../assets/images/icon.png', import.meta.url);
const iconFile = iconPath.pathname;
const iconSource = new URL('../assets/images/trackmyrmc-launcher.svg', import.meta.url).pathname;
const iconTemp = `${iconFile}.generated.png`;
function requireInvariant(condition, message) { if (!condition) throw new Error(message); }

// Generate the actual launcher PNG from the checked-in vector source. Do not crop or
// zoom the artwork: the emblem is intentionally inside the Android launcher safe area.
try {
  const imageTool = (() => {
    for (const candidate of ['magick', 'convert']) {
      try {
        execFileSync(candidate, ['-version'], { stdio: 'ignore' });
        return candidate;
      } catch {}
    }
    return null;
  })();
  requireInvariant(imageTool, 'ImageMagick (magick/convert) is required to generate the Android launcher icon');
  execFileSync(imageTool, [
    '-background', 'white',
    iconSource,
    '-resize', '1024x1024!',
    'PNG24:' + iconTemp,
  ], { stdio: 'inherit' });
  fs.renameSync(iconTemp, iconFile);
  const header = fs.readFileSync(iconFile).subarray(0, 24);
  requireInvariant(header.toString('ascii', 1, 4) === 'PNG', 'Generated launcher icon is not a PNG');
  requireInvariant(header.readUInt32BE(16) === 1024 && header.readUInt32BE(20) === 1024, 'Generated launcher icon must be exactly 1024x1024');
  console.log('Android launcher icon generation: PASS (vector source -> exact 1024x1024 PNG; no crop)');
} finally {
  if (fs.existsSync(iconTemp)) fs.rmSync(iconTemp, { force: true });
}

requireInvariant(app.expo.version === '2.0.31', 'Expected Expo version 2.0.31');
requireInvariant(app.expo.android?.versionCode === 89, 'Expected Android versionCode 89');
requireInvariant(app.expo.android?.package === 'com.trackmyrmc.concreteking', 'Unexpected Android application id');
requireInvariant(indexRoute.includes('<Redirect href="/login"'), 'Root route must start at /login');
requireInvariant(releaseWorkflow.includes('EXPO_PUBLIC_BACKEND_URL: https://trackmyrmc.com'), 'Signed AAB must be pinned to https://trackmyrmc.com');
requireInvariant(releaseWorkflow.includes('android:versionCode=\"89\"') && releaseWorkflow.includes('android:versionName=\"2.0.31\"'), 'Signed AAB workflow must validate vc89 / v2.0.31');
requireInvariant(releaseWorkflow.includes('Legacy api.trackmyrmc.com origin detected'), 'Signed AAB workflow must reject the legacy api.trackmyrmc.com origin');
requireInvariant(!candidateWorkflow.includes('ref: feat/login-auth-rebuild'), 'Pre-AAB candidate validation must not check out the legacy login branch');
requireInvariant(candidateWorkflow.includes('ref: ${{ github.sha }}'), 'Push candidate validation must use the exact pushed SHA');
requireInvariant(deployWorkflow.includes('WWW_HOST: www.trackmyrmc.com'), 'Production web gate must validate the www host');
requireInvariant(deployWorkflow.includes('Built for every pour|Ready-Mix Concrete Tracking & RMC Plant Discovery'), 'Production web gate must reject legacy landing content');
console.log('Fresh production release invariants: PASS');
