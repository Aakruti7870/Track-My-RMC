const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
const pushPath = path.join(root, "src/notifications/pushClient.ts");
const push = fs.readFileSync(pushPath, "utf8");
const plugin = app.plugins.find(p => Array.isArray(p) && p[0] === "expo-notifications");

test("Expo bundles both standard and loud native notification sounds", () => {
  assert.ok(plugin, "Expo notification plugin with custom sound list must exist");
  assert.deepEqual(plugin[1].sounds, [
    "./assets/sounds/trackmyrmc_standard.wav",
    "./assets/sounds/trackmyrmc_loud.wav",
  ]);
  for (const relative of plugin[1].sounds) {
    const sound = fs.readFileSync(path.join(root, relative.slice(2)));
    assert.equal(sound.toString("ascii", 0, 4), "RIFF");
    assert.equal(sound.toString("ascii", 8, 12), "WAVE");
    assert.equal(sound.readUInt16LE(20), 1, "Use uncompressed PCM");
    assert.equal(sound.readUInt16LE(22), 1, "Use a single channel for compact asset size");
    assert.equal(sound.readUInt16LE(34), 16, "Use signed 16-bit samples");
    assert.ok(sound.length > 2000 && sound.length < 200000);
  }
});

test("Versioned standard and loud Android channels configure bundled sounds", async () => {
  assert.match(push, /trackmyrmc_operations_standard_v1/);
  assert.match(push, /trackmyrmc_operations_loud_v1/);
  const output = ts.transpileModule(push, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  const registrations = [];
  const channels = [];
  const notifications = {
    setNotificationHandler() {},
    setNotificationChannelAsync: async (id, data) => channels.push([id, data]),
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: async () => ({ status: "granted" }),
    getDevicePushTokenAsync: async () => ({ data: "fcm-token" }),
  };
  new Function("require", "module", "exports", output)(name => ({
    "expo-constants": { expoConfig: { version: "test" } },
    "react-native": { Platform: { OS: "android" } },
    "expo-notifications": notifications,
    "@/src/api/client": { apiPost: async (...params) => { registrations.push(params); } },
  })[name], module, module.exports);

  await module.exports.registerPushDevice("auth-token");
  assert.equal(channels.length, 3);
  const standard = channels.find(([id]) => id === "trackmyrmc_operations_standard_v1");
  const loud = channels.find(([id]) => id === "trackmyrmc_operations_loud_v1");
  assert.equal(standard[1].sound, "trackmyrmc_standard.wav");
  assert.equal(loud[1].sound, "trackmyrmc_loud.wav");
  assert.equal(standard[1].importance, notifications.AndroidImportance.HIGH);
  assert.equal(loud[1].importance, notifications.AndroidImportance.HIGH);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][2].token, "fcm-token");
});

test("Existing push consent and foreground routing remain intact", () => {
  assert.match(push, /shouldPlaySound: true/);
  assert.match(push, /if \(permission\.status !== "granted"\) return null/);
  assert.match(push, /onRoute\(routeFromData\(/);
});
