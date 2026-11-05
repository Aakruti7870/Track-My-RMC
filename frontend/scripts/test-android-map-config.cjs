const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("plugins/with-play-store-compatibility.js", "utf8");
const KEY_NAME = "com.google.android.geo.API_KEY";

function runConfig(key, metadata = []) {
  const module = { exports: {} };
  const mocked = {
    withGradleProperties(config, modify) {
      config._gradle = modify;
      return config;
    },
    withAndroidManifest(config, modify) {
      config._android = modify;
      return config;
    },
  };
  vm.runInNewContext(source, {
    module,
    process: { env: key ? { GOOGLE_MAPS_ANDROID_KEY: key } : {} },
    require(name) {
      assert.equal(name, "@expo/config-plugins");
      return mocked;
    },
  });
  const config = module.exports({});
  const modResults = { manifest: { application: [{ "meta-data": metadata }] } };
  config._android({ modResults });
  return modResults.manifest.application[0]["meta-data"];
}

test("native Google Maps key is inserted while preserving other metadata", () => {
  const entries = runConfig("android-restricted-test-key", [
    { $: { "android:name": "com.example.keep", "android:value": "ok" } },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.$["android:name"] === KEY_NAME).$["android:value"], "android-restricted-test-key");
  assert.equal(entries.find(entry => entry.$["android:name"] === "com.example.keep").$["android:value"], "ok");
});

test("stale or duplicate native Google Maps keys are replaced with exactly one key", () => {
  const entries = runConfig("new-test-key", [
    { $: { "android:name": KEY_NAME, "android:value": "old" } },
    { $: { "android:name": KEY_NAME, "android:value": "duplicate" } },
    { $: { "android:name": "another.entry", "android:value": "preserved" } },
  ]);
  assert.equal(entries.filter(entry => entry.$["android:name"] === KEY_NAME).length, 1);
  assert.equal(entries.find(entry => entry.$["android:name"] === KEY_NAME).$["android:value"], "new-test-key");
});

test("no key is baked into the manifest during keyless web builds", () => {
  const entries = runConfig("", [
    { $: { "android:name": "com.example.keep", "android:value": "ok" } },
  ]);
  assert.equal(entries.filter(entry => entry.$["android:name"] === KEY_NAME).length, 0);
});
