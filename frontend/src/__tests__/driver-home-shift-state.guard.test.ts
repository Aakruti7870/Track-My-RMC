import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('driver home completed-shift guard', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const driverHome = fs.readFileSync(path.join(root, 'app/driver/index.tsx'), 'utf8');

  it('reads the driver attendance record alongside home data', () => {
    assert.match(driverHome, /useGet<Attendance>\("\/driver\/attendance"\)/);
  });

  it('shows a completed state after checkout instead of a new check-in prompt', () => {
    assert.match(driverHome, /const shiftComplete = !!attendance\?\.check_out/);
    assert.match(driverHome, /"Shift complete"/);
    assert.match(driverHome, /"Shift Done"/);
  });

  it('keeps the completed-shift action useful by opening attendance', () => {
    assert.match(driverHome, /accessibilityLabel=\{data\.active_trip \? "Open active trip" : "Open attendance"\}/);
    assert.match(driverHome, /router\.push\("\/driver\/attendance"\)/);
  });

  it('preserves the Google Play review location guidance added on main', () => {
    assert.match(driverHome, /PLAY_REVIEW_DRIVER_NAME/);
    assert.match(driverHome, /play-review-location-hint/);
  });
});
