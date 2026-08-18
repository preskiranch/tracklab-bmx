import { describe, expect, it } from 'vitest';
import {
  addGetPulledSample,
  createGetPulledAccumulator,
  getPulledDemoMetrics,
  getPulledMetrics,
  getPulledResultFromAccumulator,
  normalizeGetPulledAirSetting,
  normalizeGetPulledSeconds,
} from '../../src/lib/getPulled';
import { bmxSpeedKphFromCadence } from '../../src/game/bmxRollout';
import type { BikeSample, PlayerSlot } from '../../src/types';

const sample = (overrides: Partial<BikeSample> = {}): BikeSample => ({
  at: 1_000,
  source: 'bluetooth',
  deviceId: 250_439_950,
  label: 'WattbikePM250439950',
  watts: 487,
  cadence: 90,
  speedKph: 99,
  signal: 100,
  ...overrides,
});

const player: PlayerSlot = {
  id: 1,
  name: 'Rasheem "The Machine" Hicks',
  colorName: 'lime',
  accent: '#74e430',
  deviceId: 250_439_950,
  riderId: 'studio-rasheem',
};

describe('Get Pulled test math and record categories', () => {
  it('normalizes duration and Wattbike Air settings to supported limits', () => {
    expect(normalizeGetPulledSeconds(0)).toBe(1);
    expect(normalizeGetPulledSeconds(600)).toBe(300);
    expect(normalizeGetPulledAirSetting(-3)).toBe(1);
    expect(normalizeGetPulledAirSetting(6.6)).toBe(7);
    expect(normalizeGetPulledAirSetting(20)).toBe(10);
  });

  it('uses 44/16 BMX rollout speed and removes idle sensor noise', () => {
    expect(getPulledMetrics(sample(), 1_000)).toEqual({
      live: true,
      watts: 487,
      cadence: 90,
      speedKph: bmxSpeedKphFromCadence(90),
    });
    expect(getPulledMetrics(sample({ watts: 8, cadence: 10 }), 1_000)).toEqual({
      live: true,
      watts: 0,
      cadence: 0,
      speedKph: 0,
    });
  });

  it('ramps demo pulls from rest and uses the same 44/16 rollout speed', () => {
    const atRest = getPulledDemoMetrics(0, 7);
    const underway = getPulledDemoMetrics(1_500, 7);

    expect(atRest).toMatchObject({ live: true, cadence: 0, speedKph: 0 });
    expect(underway.cadence).toBeGreaterThan(0);
    expect(underway.watts).toBeGreaterThan(0);
    expect(underway.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(underway.cadence), 6);
  });

  it('records averages, peaks, distance, duration, and the exact Air category', () => {
    let accumulator = createGetPulledAccumulator();
    accumulator = addGetPulledSample(accumulator, { live: true, watts: 400, cadence: 80, speedKph: 20 }, 1_000);
    accumulator = addGetPulledSample(accumulator, { live: true, watts: 600, cadence: 100, speedKph: 24 }, 1_500);
    const result = getPulledResultFromAccumulator(accumulator, player, 1_000, 7_000, 6, 8);

    expect(result).toMatchObject({
      riderId: 'studio-rasheem',
      durationSeconds: 6,
      airSetting: 8,
      averageWatts: 500,
      peakWatts: 600,
      averageCadence: 90,
      peakCadence: 100,
      averageSpeedKph: 22,
      peakSpeedKph: 24,
    });
    expect(result.distanceMeters).toBeCloseTo(24 / 3.6 / 2, 5);
  });
});
