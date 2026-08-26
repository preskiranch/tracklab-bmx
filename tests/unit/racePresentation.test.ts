import { describe, expect, it } from 'vitest';
import {
  legacyRacePresentationViewport,
  normalizeRacePresentationViewport,
  racePresentationFrame,
  raceRiderOverlayRectForPresentation,
  satelliteZoomDeltaForRacePresentation,
  satelliteZoomForRacePresentation,
  threeDimensionalRangeForAspect,
  threeDimensionalRangeScaleForAspect,
} from '../../src/lib/racePresentation';

describe('race presentation geometry', () => {
  it('uses the original owner iPad frame for legacy saved presentations', () => {
    expect(legacyRacePresentationViewport).toEqual({ width: 1366, height: 1024 });
  });

  it('normalizes a bounded CSS-pixel viewport without device-pixel assumptions', () => {
    expect(normalizeRacePresentationViewport({ width: 1366.125, height: 1024.555 })).toEqual({
      width: 1366.13,
      height: 1024.56,
    });
    expect(normalizeRacePresentationViewport({ width: '1366', height: 1024 })).toBeNull();
    expect(normalizeRacePresentationViewport({ width: 200, height: 1024 })).toBeNull();
    expect(normalizeRacePresentationViewport({ width: 1024, height: Number.NaN })).toBeNull();
    expect(normalizeRacePresentationViewport({ width: 20_000, height: 1024 })).toBeNull();
  });

  it('uniformly contains an authored frame and centers aspect-ratio overflow', () => {
    expect(racePresentationFrame(
      { width: 1600, height: 900 },
      { width: 1024, height: 768 },
    )).toMatchObject({
      uniformScale: 0.64,
      offsetX: 0,
      offsetY: 96,
      width: 1024,
      height: 576,
    });
  });

  it('uses CSS uniform scale only for satellite zoom containment', () => {
    const reference = { width: 1366, height: 1024 };
    const target = { width: 1024, height: 768 };
    expect(satelliteZoomDeltaForRacePresentation(reference, target)).toBeCloseTo(
      Math.log2(1024 / 1366),
      10,
    );
    expect(satelliteZoomForRacePresentation(20, reference, target)).toBeCloseTo(19.584, 3);
    expect(satelliteZoomForRacePresentation(0.1, reference, { width: 240, height: 240 })).toBe(0);
  });

  it('keeps 3D range independent of absolute CSS resolution at the same aspect', () => {
    const reference = { width: 1200, height: 900 };
    expect(threeDimensionalRangeScaleForAspect(reference, { width: 800, height: 600 })).toBe(1);
    expect(threeDimensionalRangeForAspect(500, reference, { width: 800, height: 600 })).toBe(500);
    expect(threeDimensionalRangeForAspect(500, reference, { width: 1600, height: 900 })).toBe(500);
    expect(threeDimensionalRangeForAspect(500, reference, { width: 600, height: 600 })).toBeCloseTo(
      500 * (4 / 3),
      8,
    );
  });

  it('maps the rider overlay through the same contained camera frame', () => {
    const rect = raceRiderOverlayRectForPresentation({
      xPct: 0.04,
      yPct: 0.7,
      width: 940,
      height: 220,
      referenceViewport: { width: 1366, height: 1024 },
    }, { width: 1024, height: 768 });

    expect(rect).not.toBeNull();
    expect(rect?.left).toBeCloseTo(40.96, 5);
    expect(rect?.top).toBeCloseTo(537.525, 3);
    expect(rect?.width).toBeCloseTo(704.66, 2);
    expect(rect?.height).toBeCloseTo(164.92, 2);
    expect(rect?.uniformScale).toBeCloseTo(1024 / 1366, 8);
  });

  it('uses an explicit fallback reference and otherwise declines unsafe mapping', () => {
    const layout = { xPct: 0.1, yPct: 0.2, width: 900, height: 220 };
    expect(raceRiderOverlayRectForPresentation(layout, { width: 1024, height: 768 })).toBeNull();
    expect(raceRiderOverlayRectForPresentation(
      layout,
      { width: 800, height: 600 },
      { width: 1200, height: 900 },
    )).toMatchObject({
      left: 80,
      top: 120,
      width: 600,
      height: 146.66666666666666,
      uniformScale: 2 / 3,
    });
  });
});
