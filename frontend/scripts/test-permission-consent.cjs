const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Run the actual TypeScript with controlled native/API boundaries. No Android
// permission prompts or backend connections are made by these regression tests.
function load(file, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function storageFixture() {
  const values = new Map();
  return { values, storage: {
    getItem: async (key, fallback) => values.get(key) ?? fallback,
    setItem: async (key, value) => { values.set(key, value); return true; },
  } };
}

test('later notification approval survives relogin and preserves the other cards', async () => {
  const { storage, values } = storageFixture();
  const key = 'tmrmc_post_login_permission_cards_v2:customer-1:customer';
  values.set(key, JSON.stringify({ version: 2, completed: true, choices: { location: 'skipped', notifications: 'skipped' } }));
  const mocks = { '@/src/utils/storage': { storage } };
  const consent = load('src/notifications/notificationConsent.ts', mocks);
  assert.equal(await consent.hasNotificationConsent('customer-1:customer'), false);
  await consent.saveNotificationConsent('customer-1:customer', 'granted');
  const nextSession = load('src/notifications/notificationConsent.ts', mocks);
  assert.equal(await nextSession.hasNotificationConsent('customer-1:customer'), true);
  assert.equal(await nextSession.hasNotificationConsent('customer-2:customer'), false);
  assert.deepEqual(JSON.parse(values.get(key)).choices, { location: 'skipped', notifications: 'granted' });
  await consent.saveNotificationConsent('driver-1:driver', 'granted');
  assert.equal(JSON.parse(values.get('tmrmc_post_login_permission_cards_v2:driver-1:driver')).completed, false);
});

test('token rotations recheck current consent, OS permission and listener cleanup', async () => {
  const { storage } = storageFixture();
  const consent = load('src/notifications/notificationConsent.ts', { '@/src/utils/storage': { storage } });
  let listener;
  let permission = 'granted';
  const registrations = [];
  const native = {
    setNotificationHandler() {},
    getPermissionsAsync: async () => ({ status: permission }),
    setNotificationChannelAsync: async () => {},
    getDevicePushTokenAsync: async () => ({ data: 'initial' }),
    AndroidImportance: { HIGH: 4 },
    addPushTokenListener(callback) { listener = callback; return { remove() {} }; },
  };
  const push = load('src/notifications/pushClient.ts', {
    'expo-constants': { expoConfig: {} }, 'react-native': { Platform: { OS: 'android' } },
    'expo-notifications': native,
    '@/src/api/client': { apiPost: async (...args) => registrations.push(args) },
  });
  const effects = [];
  load('src/notifications/PushNotificationBridge.tsx', {
    react: { useEffect: fn => effects.push(fn), useRef: value => ({ current: value }) },
    'react-native': { Platform: { OS: 'android' } },
    'expo-router': { useRouter: () => ({}) },
    '@/src/auth/AuthContext': { useAuth: () => ({ token: 'session', user: { id: '1', role: 'driver' } }) },
    '@/src/notifications/notificationConsent': consent,
    '@/src/notifications/pushClient': push,
  }).PushNotificationBridge();
  const cleanup = effects[0]();
  await tick();
  listener({ data: 'skipped-token' }); await tick();
  assert.equal(registrations.length, 0);
  await consent.saveNotificationConsent('1:driver', 'granted');
  listener({ data: 'allowed-token' }); await tick();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][2].token, 'allowed-token');
  await consent.saveNotificationConsent('1:driver', 'skipped');
  listener({ data: 'revoked-token' }); await tick();
  assert.equal(registrations.length, 1);
  await consent.saveNotificationConsent('1:driver', 'granted');
  permission = 'denied';
  listener({ data: 'os-denied-token' }); await tick();
  assert.equal(registrations.length, 1);
  permission = 'granted'; cleanup();
  listener({ data: 'old-session-token' }); await tick();
  assert.equal(registrations.length, 1);
});

test('fresh customer location approval wins over delayed saved denial', async () => {
  const { storage, values } = storageFixture();
  values.set('permission-user-1', JSON.stringify({ version: 1, location_choice: 'denied', notification_choice: 'manual' }));
  let completeHydration;
  const pending = new Promise(resolve => { completeHydration = resolve; });
  const effects = [], states = [], updates = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => ({}),
    useCallback: fn => fn, useRef: value => ({ current: value }),
    useEffect: fn => effects.push(fn),
    useState: value => { const index = states.length; states.push(value); return [value, next => updates.push([index, next])]; },
  };
  const mocks = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: x => x }, AppState: {} },
    '@expo/vector-icons': { Ionicons: {} }, 'expo-router': { useRouter: () => ({}) },
    'expo-location': { getForegroundPermissionsAsync: async () => ({ status: 'granted' }) },
    'expo-image-picker': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({}) },
    '@/src/auth/AuthContext': { useAuth: () => ({ token: 'session', user: { id: '1', role: 'customer' }, hydrating: false }) },
    '@/src/api/client': { apiGet: () => pending, apiPut: async () => {} },
    '@/src/notifications/pushClient': {}, '@/src/notifications/notificationConsent': {},
    '@/src/theme/ThemeProvider': { useTheme: () => ({ colors: {} }) },
    '@/src/theme/tokens': { radius: {}, spacing: {} }, '@/src/utils/storage': { storage },
  };
  for (const name of ['ThemedScreen', 'ui/AppText', 'ui/Button', 'ui/Card']) mocks[`@/src/components/${name}`] = {};
  const provider = load('src/permissions/PermissionProvider.tsx', mocks).PermissionProvider({ children: null });
  effects[1](); await tick();
  await provider.props.value.enableDiscoveryLocation();
  completeHydration({ consent: { version: 1, location_choice: 'denied', notification_choice: 'manual' } });
  await tick();
  assert.equal(updates.filter(([index]) => index === 0).at(-1)[1], true);
});
