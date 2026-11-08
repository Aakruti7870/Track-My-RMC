#!/usr/bin/env node
"use strict";

/**
 * Offline policy for the exact npm lockfile. Network-backed npm audit is a
 * separate mandatory check; this only prevents version/integrity regressions.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
assert.equal(lock.lockfileVersion, 3, "npm lockfile v3 required");
assert.equal(lock.name, manifest.name, "Manifest/lockfile name mismatch");
assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies, "Recreate lockfile with npm install --package-lock-only");
assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies, "Development dependencies changed without updating lock");
const entries = Object.entries(lock.packages);
function installed(name) {
  return entries.filter(([location]) => location === "node_modules/" + name || location.endsWith("/node_modules/" + name));
}
function >=(version, floor) {
  const parsed = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  assert(parsed, "Unsupported installed semver " + version);
  const a = parsed.slice(1, 4).map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}
const forged = installed("node-forge");
assert(forged.length > 0, "node-forge package missing; re-evaluate certificate tooling instead of silently skipping");
for (const [location, pkg] of forged) {
  assert(>=(pkg.version, "1.4.3"), location + " contains vulnerable/unverified node-forge " + pkg.version);
  assert(pkg.integrity && pkg.integrity.startsWith("sha512-"), "Require npm integrity for " + location);
}
const size = installed("image-size");
assert(size.length > 0, "Metro image-size missing; reassess adapter compatibility");
for (const [location, pkg] of size) {
  assert.equal(pkg.version, "2.0.4", "Metro image-size adapter was tested only against 2.0.4 at " + location);
  assert(pkg.integrity && pkg.integrity.startsWith("sha512-"), "Require npm integrity for " + location);
}
for (const [name, pkg] of entries) {
  if (!name) continue;
  assert(pkg.integrity || pkg.link || pkg.inBundle, "Missing integrity metadata: " + name);
}
console.log(JSON.stringify({status:"PASS",lockfile:lock.lockfileVersion,node_forge:forged.map(([p,v])=>({path:p,version:v.version})),image_size:size.map(([p,v])=>({path:p,version:v.version})),packages:entries.length}));
