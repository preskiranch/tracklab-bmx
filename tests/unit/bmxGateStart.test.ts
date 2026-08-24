import { describe, expect, it } from 'vitest';
import {
  bikeSampleHasDriveSignalSince,
  bmxCStartBackoffMeters,
  cStartVisualDistance,
  latestBikeDriveSignalAt,
} from '../../src/lib/bmxGateStart';
import type { BikeSample } from '../../src/types';

function bikeSample(overrides: Partial<BikeSample> = {}): BikeSample {
  return {
    at: 10_000,
    source: 'bluetooth',
    deviceId: 58_701,
    label: 'WattbikePM25058701',
    watts: 0,
    wattsAt: 10_000,
    cadence: 0,
    cadenceAt: 10_000,
    speedKph: 0,
    speedAt: 10_000,
    signal: 1,
    ...overrides,
  };
}

describe('BMX gate start presentation', () => {
  it('loads the rider exactly three inches behind the staged position', () => {
    expect(bmxCStartBackoffMeters).toBeCloseTo(0.0762, 10);
    expect(cStartVisualDistance(12, bmxCStartBackoffMeters)).toBeCloseTo(11.9238, 10);
    expect(cStartVisualDistance(12)).toBe(12);
    expect(cStartVisualDistance(12, bmxCStartBackoffMeters / 2)).toBeCloseTo(11.9619, 10);
  });

  it.each([
    { cadence: 1, cadenceAt: 10_001 },
    { speedKph: 0.1, speedAt: 10_001 },
    { watts: 1, wattsAt: 10_001 },
  ])('accepts a fresh post-red drive signal: %o', (signal) => {
    expect(bikeSampleHasDriveSignalSince(bikeSample(signal), 10_000)).toBe(true);
  });

  it('rejects a drive metric whose value predates the red light', () => {
    expect(bikeSampleHasDriveSignalSince(bikeSample({
      cadence: 90,
      cadenceAt: 9_999,
      watts: 500,
      wattsAt: 9_999,
      speedKph: 24,
      speedAt: 9_999,
    }), 10_000)).toBe(false);
  });

  it('does not treat a fresh zero-watt packet as fresh retained cadence', () => {
    const retained = bikeSample({
      at: 10_010,
      cadence: 90,
      cadenceAt: 9_999,
      watts: 0,
      wattsAt: 10_010,
      speedKph: 0,
      speedAt: 10_010,
    });
    expect(latestBikeDriveSignalAt(retained)).toBe(9_999);
    expect(bikeSampleHasDriveSignalSince(retained, 10_000)).toBe(false);
  });

  it('keeps the accepted drive time when a later unrelated packet advances the sample clock', () => {
    const merged = bikeSample({
      at: 10_100,
      cadence: 90,
      cadenceAt: 10_001,
      watts: 0,
      wattsAt: 10_100,
      speedKph: 0,
      speedAt: 10_100,
    });
    expect(latestBikeDriveSignalAt(merged) - 10_000).toBe(1);
  });
});
