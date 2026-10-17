const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const code = ts.transpileModule(fs.readFileSync("src/maps/googleMapsLoader.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const scripts = [];
  const timers = new Map();
  const window = {
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, window, URLSearchParams,
    document: {
      createElement() { return { remove() { this.removed = true; } }; },
      head: { appendChild(script) { scripts.push(script); } },
    },
  });
  return { window, exports, scripts, timers };
}

test("missing key never sends a Google request", async () => {
  const h = harness();
  await assert.rejects(h.exports.loadGoogleMaps(""), /MAPS_KEY_MISSING/);
  assert.equal(h.scripts.length, 0);
});
test("concurrent and later mounts share exactly one API script", async () => {
  const h = harness();
  const a = h.exports.loadGoogleMaps("browser-only-key");
  const b = h.exports.loadGoogleMaps("browser-only-key");
  assert.equal(a, b);
  assert.equal(h.scripts.length, 1);
  const url = new URL(h.scripts[0].src);
  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.searchParams.get("auth_referrer_policy"), "origin");
  assert.equal(h.scripts[0].referrerPolicy, "strict-origin-when-cross-origin");
  const maps = { Map: function Map() {} };
  h.window.google = { maps };
  h.window.__trackMyRmcMapsReady();
  assert.equal(await a, maps);
  assert.equal(await h.exports.loadGoogleMaps("browser-only-key"), maps);
  assert.equal(h.scripts.length, 1);
  assert.equal(h.timers.size, 0);
});
test("asynchronous authentication failure reaches mounted consumers only", async () => {
  const h = harness();
  let failures = 0;
  const stop = h.exports.onMapsAuthFailure(() => failures++);
  const pending = h.exports.loadGoogleMaps("wrong-key");
  h.window.gm_authFailure();
  assert.equal(failures, 1);
  stop();
  h.window.gm_authFailure();
  assert.equal(failures, 1);
  let lateFailure = 0;
  h.exports.onMapsAuthFailure(() => lateFailure++);
  assert.equal(lateFailure, 1);
  h.window.__trackMyRmcMapsReady();
  await assert.rejects(pending, /MAPS_LOAD_FAILED/);
  await assert.rejects(h.exports.loadGoogleMaps("wrong-key"), /MAPS_AUTH_FAILED/);
});
test("script/network error and timeout reject without leaving timers", async () => {
  for (const mode of ["network", "timeout"]) {
    const h = harness();
    const pending = h.exports.loadGoogleMaps("browser-only-key");
    if (mode === "network") h.scripts[0].onerror();
    else [...h.timers.values()][0]();
    await assert.rejects(pending, /MAPS_LOAD_FAILED/);
    assert.equal(h.scripts[0].removed, true);
    assert.equal(h.timers.size, 0);
  }
});
