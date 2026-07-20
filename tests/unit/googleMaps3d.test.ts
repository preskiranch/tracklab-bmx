import { describe, expect, it } from 'vitest';
import { elevatedPath, previewRangeMeters } from '../../src/lib/googleMaps3d';

describe('Google Maps 3D preview helpers', () => {
  const center = { lat: 38.2702, lng: -122.2835 };

  it('keeps a useful minimum camera range for compact tracks', () => {
    expect(previewRangeMeters([center], center)).toBe(180);
  });

  it('expands the camera range to include longer routes', () => {
    const distantPoint = { lat: center.lat + 0.004, lng: center.lng };
    expect(previewRangeMeters([center, distantPoint], center)).toBeGreaterThan(1_000);
  });

  it('adds a small terrain-relative altitude without changing coordinates', () => {
    expect(elevatedPath([center], 1.5)).toEqual([{ ...center, altitude: 1.5 }]);
  });
});
