import { describe, expect, it } from 'vitest';
import {
  trackLabTestFlightUrl,
  watchAppNeedsInstall,
} from '../../src/components/watchAppInstall';

const missingWatchApp = {
  version: 1 as const,
  supported: false,
  platform: 'iphone' as const,
  paired: true,
  watchAppInstalled: false,
  healthDataAvailable: true,
  minimumIOS: '17.0' as const,
  minimumWatchOS: '10.0' as const,
};

describe('Watch app installation', () => {
  it('uses a supported TestFlight destination without inventing a public beta code', () => {
    expect(trackLabTestFlightUrl).toBe('https://testflight.apple.com/');
    expect(trackLabTestFlightUrl).not.toContain('/join/');
  });

  it('offers installation only on the paired iPhone when its Watch app is missing', () => {
    expect(watchAppNeedsInstall(missingWatchApp)).toBe(true);
    expect(watchAppNeedsInstall({ ...missingWatchApp, paired: false })).toBe(false);
    expect(watchAppNeedsInstall({ ...missingWatchApp, platform: 'ipad' })).toBe(false);
    expect(watchAppNeedsInstall({ ...missingWatchApp, supported: true, watchAppInstalled: true })).toBe(false);
    expect(watchAppNeedsInstall(null)).toBe(false);
  });
});
