#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const frontendRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(frontendRoot, '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`PLAY REVIEW LOCATION CHECK FAILED: ${message}`);
    process.exitCode = 1;
  }
}

const nearby = read('frontend/app/customer/plants.tsx');
const consent = read('frontend/src/location/BackgroundLocationConsent.tsx');
const trip = read('frontend/app/trip/[id].tsx');
const tracking = read('frontend/src/location/tripTracking.ts');
const review = read('frontend/app/review-access.tsx');
const driverHome = read('frontend/app/driver/index.tsx');
const fixture = read('backend/play_review.py');

const nearbyConsent = nearby.indexOf('requestNearbyPlantsLocationConsent()');
const nearbyPrompt = nearby.indexOf('Location.requestForegroundPermissionsAsync()');
assert(nearbyConsent >= 0 && nearbyPrompt > nearbyConsent, 'Nearby Plants disclosure must run before the OS foreground-location prompt.');
assert(consent.includes('This customer feature does not use background location.'), 'Nearby Plants must explicitly state foreground-only location use.');
assert(nearby.includes('TrackMyRMC Play Review Plant'), 'Reviewer customer must see the seeded review plant hint.');

const bgConsent = tracking.indexOf('requestBackgroundLocationConsent()');
const bgPrompt = tracking.indexOf('Location.requestBackgroundPermissionsAsync()');
assert(bgConsent >= 0 && bgPrompt > bgConsent, 'Driver background consent must run before the OS background-location prompt.');
assert(trip.includes('even when the app is closed or not in use'), 'Driver trip must contain the prominent background-location disclosure.');
assert(trip.includes('Agree & Continue') && trip.includes('Not now'), 'Driver disclosure must offer affirmative consent and decline.');

assert(review.includes('Nearby Plants review path'), 'Reviewer login must explain the Nearby Plants review path.');
assert(review.includes('Background location review path'), 'Reviewer login must explain the background-location review path.');
assert(driverHome.includes('play-review-location-hint') && driverHome.includes('PLAY-REVIEW-001'), 'Reviewer Driver home must direct reviewers to the active review trip.');
assert(fixture.includes('TrackMyRMC Play Review Plant') && fixture.includes('PLAY-REVIEW-001'), 'Reviewer fixture must seed both review plant and active trip.');

if (process.exitCode) process.exit(process.exitCode);
console.log('Google Play reviewer location paths are wired correctly.');
