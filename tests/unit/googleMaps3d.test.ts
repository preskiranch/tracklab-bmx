import { describe, expect, it } from 'vitest';
import {
  elevatedPath,
  isGoogleMaps3DSteadyEvent,
  previewRangeMeters,
  projectScreenPointToGround,
  terrainRelativeCamera,
} from '../../src/lib/googleMaps3d';

describe('Google Maps 3D pedal-zone mapping helpers', () => {
  const center = { lat: 38.2702, lng: -122.2835 };

  it('keeps a useful minimum camera range for compact tracks', () => {
    expect(previewRangeMeters([center], center)).toBe(280);
  });

  it('expands the camera range to include longer routes', () => {
    const distantPoint = { lat: center.lat + 0.004, lng: center.lng };
    expect(previewRangeMeters([center, distantPoint], center)).toBeGreaterThan(1_000);
  });

  it('draws mapping paths just above terrain without changing coordinates', () => {
    expect(elevatedPath([center], 1.5)).toEqual([{ ...center, altitude: 1.5 }]);
  });

  it('targets the track relative to its terrain instead of sea level', () => {
    expect(terrainRelativeCamera(center, 120, 56, 320)).toEqual({
      altitudeMode: 'RELATIVE_TO_GROUND',
      center: { ...center, altitude: 0 },
      heading: 120,
      range: 320,
      tilt: 56,
    });
  });

  it('recognizes the current Google steady-change event contract', () => {
    expect(isGoogleMaps3DSteadyEvent(Object.assign(new Event('gmp-steadychange'), { isSteady: true }))).toBe(true);
    expect(isGoogleMaps3DSteadyEvent(Object.assign(new Event('gmp-steadychange'), { isSteady: false }))).toBe(false);
    expect(isGoogleMaps3DSteadyEvent(new Event('gmp-steadychange'))).toBe(false);
  });

  it('projects a centered touch onto the temporary 3D mapping ground plane', () => {
    expect(projectScreenPointToGround(
      { x: 500, y: 300 },
      { width: 1_000, height: 600 },
      { center, heading: 0, range: 320, tilt: 56 },
    )).toEqual(center);
  });
});
