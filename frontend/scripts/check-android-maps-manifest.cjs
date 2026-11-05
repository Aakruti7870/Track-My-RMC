#!/usr/bin/env node
// Release gate: the Android Maps key must actually be present in the generated
// native manifest. Checking that AWS returned a nonempty key is insufficient.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const key = (process.env.GOOGLE_MAPS_ANDROID_KEY || '').trim();
assert(key, 'GOOGLE_MAPS_ANDROID_KEY is missing from the Android release environment');

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
assert(fs.existsSync(manifestPath), 'Android manifest missing: run expo prebuild first');
const manifest = fs.readFileSync(manifestPath, 'utf8');
const tags = [...manifest.matchAll(/<meta-data\b[^>]*>/gs)].map(match => match[0]);
const mapTags = tags.filter(tag => /android:name\s*=\s*["']com\.google\.android\.geo\.API_KEY["']/.test(tag));
assert.equal(mapTags.length, 1, 'Expected exactly one Google Maps SDK API key entry in AndroidManifest.xml');
const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
assert(
  new RegExp('android:value\\s*=\\s*["\']' + escaped + '["\']').test(mapTags[0]),
  'AndroidManifest.xml Google Maps SDK key does not match the release configuration',
);
console.log('Android Maps SDK manifest gate passed (key value not displayed).');
