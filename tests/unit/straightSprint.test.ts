import { describe, expect, it } from 'vitest';
import {
  clipRouteAtMeter,
  normalizeStraightSprintAirSetting,
  normalizeStraightSprintDistance,
  resolveStraightSprintCamera,
  straightSprintCameraPreferenceKey,
  straightSprintDistanceOptions,
  straightSprintFeetToMeters,
} from '../../src/lib/straightSprint';
import { distanceBetweenTrackPoints, routeLengthMeters } from '../../src/lib/trackMapping';

describe('straight sprint configurations', () => {
  it('offers 30 ft, 145 ft, and every 100 ft distance through 1,500 ft', () => {
    expect(straightSprintDistanceOptions).toEqual([
      30, 100, 145, 200, 300, 400, 500, 600, 700, 800,
      900, 1000, 1100, 1200, 1300, 1400, 1500,
    ]);
  });

  it('normalizes unsupported choices and keeps Air within 1 through 10', () => {
    expect(normalizeStraightSprintDistance(500)).toBe(500);
    expect(normalizeStraightSprintDistance(145)).toBe(145);
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
    expect(straightSprintCameraPreferenceKey('custom-drag-strip', 145))
      .toBe('custom-drag-strip:sprint:145ft');
    expect(straightSprintCameraPreferenceKey('custom-drag-strip', 500))
      .toBe('custom-drag-strip:sprint:500ft');
  });

  it('keeps exact sprint angles while restoring a complete venue composition', () => {
    const camera = resolveStraightSprintCamera({
      'custom-drag-strip': {
        angle: 47,
        heading: 180,
        center: { lat: 38.41, lng: -121.96 },
        zoom: 20.78,
        referenceViewport: { width: 1366, height: 1024 },
        updatedAt: 10,
      },
      'custom-drag-strip:sprint:100ft': {
        angle: 32,
        heading: 90,
        updatedAt: 20,
      },
    }, 'custom-drag-strip', 100);

    expect(camera).toEqual({
      angle: 32,
      heading: 90,
      center: { lat: 38.41, lng: -121.96 },
      zoom: 20.78,
      referenceViewport: { width: 1366, height: 1024 },
      updatedAt: 20,
    });
  });

  it('falls back to the newest saved sprint view when the selected distance and base view are absent', () => {
    const camera = resolveStraightSprintCamera({
      'custom-drag-strip:sprint:300ft': {
        angle: 30,
        heading: 80,
        center: { lat: 38.4, lng: -121.9 },
        zoom: 19.5,
        updatedAt: 30,
      },
      'custom-drag-strip:sprint:400ft': {
        angle: 40,
        heading: 100,
        center: { lat: 38.5, lng: -121.8 },
        zoom: 20.5,
        updatedAt: 40,
      },
    }, 'custom-drag-strip', 100);

    expect(camera).toMatchObject({
      angle: 40,
      heading: 100,
      center: { lat: 38.5, lng: -121.8 },
      zoom: 20.5,
      updatedAt: 40,
    });
  });
});
