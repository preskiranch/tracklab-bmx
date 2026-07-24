import { describe, expect, it } from 'vitest';
import {
  pedalZoneLabelAnchor,
  pedalZoneLabelPosition,
  pedalZoneLabelSizePixels,
} from '../../src/lib/mapZoneLabels';
import { distanceBetweenTrackPoints } from '../../src/lib/trackMapping';

const route = [
  { lat: 38.355, lng: -121.978 },
  { lat: 38.355, lng: -121.977 },
];

describe('pedal-zone map labels', () => {
  it('places a zone number at the measured center of its own line', () => {
    const routeLength = distanceBetweenTrackPoints(route[0], route[1]);
    const position = pedalZoneLabelPosition(route, 10, routeLength - 10);

    expect(position).not.toBeNull();
    expect(distanceBetweenTrackPoints(route[0], position!)).toBeCloseTo(routeLength / 2, 4);
  });

  it('anchors the complete number icon directly above the route centerline', () => {
    expect(pedalZoneLabelAnchor.x).toBe(pedalZoneLabelSizePixels / 2);
    expect(pedalZoneLabelAnchor.y).toBeGreaterThan(pedalZoneLabelSizePixels);
    expect(pedalZoneLabelAnchor.y - pedalZoneLabelSizePixels).toBe(10);
  });

  it('does not place a label for an invalid zone span', () => {
    expect(pedalZoneLabelPosition(route, 20, 20)).toBeNull();
    expect(pedalZoneLabelPosition([route[0]], 0, 20)).toBeNull();
  });
});
