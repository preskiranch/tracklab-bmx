import { describe, expect, it } from 'vitest';
import {
  riderAirPixelsToMeters,
  riderLaneOffsetsByPlayer,
  riderMarkerCanvasSize,
  riderMarkerDrawSize,
  riderMarkerMaximumShadowBlurPixels,
  riderMarkerShadowOffsetYPixels,
  riderScreenLaneOffsetsByPlayer,
  riderScreenLaneTranslation,
  uprightRiderOrientation,
} from '../../src/lib/riderPresentation';
import type { PlayerSlot } from '../../src/types';

const players: PlayerSlot[] = [
  { id: 1, name: 'One', colorName: 'lime', accent: '#7ade36', deviceId: 1 },
  { id: 2, name: 'Two', colorName: 'red', accent: '#ef4444', deviceId: 2 },
  { id: 3, name: 'Three', colorName: 'blue', accent: '#38bdf8', deviceId: 3 },
  { id: 4, name: 'Four', colorName: 'yellow', accent: '#facc15', deviceId: 4 },
];

describe('3D rider presentation', () => {
  it('keeps rider art upright while mirroring it for reverse travel', () => {
    expect(uprightRiderOrientation(0)).toEqual({ leanDegrees: 0, mirrored: false });
    expect(uprightRiderOrientation(180)).toEqual({ leanDegrees: 0, mirrored: true });
    expect(uprightRiderOrientation(270)).toEqual({ leanDegrees: -24, mirrored: false });
    expect(uprightRiderOrientation(135)).toEqual({ leanDegrees: -24, mirrored: true });
  });

  it('keeps the complete rider inside the marker canvas at every supported lean', () => {
    for (let leanDegrees = -24; leanDegrees <= 24; leanDegrees += 2) {
      const radians = Math.abs(leanDegrees) * (Math.PI / 180);
      const rotatedHalfExtent = (riderMarkerDrawSize / 2)
        * (Math.cos(radians) + Math.sin(radians));
      const horizontalExtent = rotatedHalfExtent + riderMarkerMaximumShadowBlurPixels;
      const downwardExtent = horizontalExtent + riderMarkerShadowOffsetYPixels;
      const availableHalfExtent = riderMarkerCanvasSize / 2;

      expect(horizontalExtent).toBeLessThanOrEqual(availableHalfExtent);
      expect(downwardExtent).toBeLessThanOrEqual(availableHalfExtent);
    }
  });

  it('converts game air pixels to a bounded terrain altitude', () => {
    expect(riderAirPixelsToMeters(0)).toBe(0);
    expect(riderAirPixelsToMeters(20)).toBeCloseTo(0.5);
    expect(riderAirPixelsToMeters(34)).toBeCloseTo(0.85);
    expect(riderAirPixelsToMeters(100)).toBeCloseTo(0.85);
  });

  it('keeps four local riders inside a compact track-width spread', () => {
    const offsets = riderLaneOffsetsByPlayer(players);
    expect(offsets.get(1)).toBeCloseTo(-0.63);
    expect(offsets.get(2)).toBeCloseTo(-0.21);
    expect(offsets.get(3)).toBeCloseTo(0.21);
    expect(offsets.get(4)).toBeCloseTo(0.63);
  });

  it('keeps extra screen-space spread neutral so all four riders stay on track', () => {
    const offsets = riderScreenLaneOffsetsByPlayer(players);
    expect(offsets.get(1)).toBe(-0);
    expect(offsets.get(2)).toBe(-0);
    expect(offsets.get(3)).toBe(0);
    expect(offsets.get(4)).toBe(0);

    offsets.forEach((offset) => {
      const forwardTranslation = riderScreenLaneTranslation(0, offset);
      const turnTranslation = riderScreenLaneTranslation(90, offset);
      expect(forwardTranslation.x).toBeCloseTo(0);
      expect(forwardTranslation.y).toBeCloseTo(0);
      expect(turnTranslation.x).toBeCloseTo(0);
      expect(turnTranslation.y).toBeCloseTo(0);
    });
  });
});
