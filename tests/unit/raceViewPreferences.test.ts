import { describe, expect, it } from 'vitest';
import {
  defaultRaceRiderOverlayLayout,
  normalizeRaceRiderOverlayLayout,
  normalizeRaceViewPreferences,
} from '../../src/lib/raceViewPreferences';

describe('race view preferences', () => {
  it('uses a larger two-axis rider panel by default', () => {
    expect(defaultRaceRiderOverlayLayout).toMatchObject({
      width: 940,
      height: 220,
      locked: false,
    });
  });

  it('normalizes saved panel size, position, and lock state', () => {
    expect(normalizeRaceRiderOverlayLayout({
      xPct: -1,
      yPct: 4,
      width: 2400,
      height: 20,
      locked: true,
    })).toEqual({
      xPct: 0,
      yPct: 1,
      width: 1800,
      height: 190,
      locked: true,
    });
  });

  it('keeps camera and rider panel preferences separated by track', () => {
    const preferences = normalizeRaceViewPreferences({
      cameraLocked: true,
      earthCamerasByTrack: {
        north: { angle: 20, heading: 370, zoom: 19, updatedAt: 12 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0.1, yPct: 0.6, width: 1000, height: 180, locked: true },
      },
    });

    expect(preferences.cameraLocked).toBe(true);
    expect(preferences.earthCamerasByTrack.north.heading).toBe(10);
    expect(preferences.riderOverlaysByTrack.north).toMatchObject({
      width: 1000,
      height: 190,
      locked: true,
    });
  });
});
