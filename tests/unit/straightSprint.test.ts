import { describe, expect, it } from 'vitest';
import {
  clipRouteAtMeter,
  normalizeStraightSprintAirSetting,
  normalizeStraightSprintDistance,
  straightSprintCameraPreferenceKey,
  straightSprintDistanceOptions,
  straightSprintFeetToMeters,
} from '../../src/lib/straightSprint';
import { distanceBetweenTrackPoints, routeLengthMeters } from '../../src/lib/trackMapping';

describe('straight sprint configurations', () => {
  it('offers 30 ft and every 100 ft distance through 1,500 ft', () => {
    expect(straightSprintDistanceOptions).toEqual([
      30,
      100, 200, 300, 400, 500, 600, 700, 800,
      900, 1000, 1100, 1200, 1300, 1400, 1500,
    ]);
  });

  it('normalizes unsupported choices and keeps Air within 1 through 10', () => {
    expect(normalizeStraightSprintDistance(500)).toBe(500);
    expect(normalizeStraightSprintDistance(550)).toBe(100);
    expect(normalizeStraightSprintAirSetting(0)).toBe(1);
    expect(normalizeStraightSprintAirSetting(11)).toBe(10);
  });

  it('places the active finish at the selected measured distance', () => {
    const route = [
      { lat: 38.0, lng: -122.0 },
      { lat: 38.0, lng: -121.99 },
    ];
    const selectedMeters = straightSprintFeetToMeters(500);
    const clipped = clipRouteAtMeter(route, selectedMeters);

    expect(routeLengthMeters(clipped)).toBeCloseTo(selectedMeters, 4);
    expect(distanceBetweenTrackPoints(route[0], clipped[clipped.length - 1])).toBeCloseTo(selectedMeters, 4);
  });

  it('keeps a separate saved camera key for every sprint distance', () => {
    expect(straightSprintCameraPreferenceKey('custom-drag-strip', 100))
      .toBe('custom-drag-strip:sprint:100ft');
    expect(straightSprintCameraPreferenceKey('custom-drag-strip', 500))
      .toBe('custom-drag-strip:sprint:500ft');
  });
});
