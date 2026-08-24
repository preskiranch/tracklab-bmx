import { describe, expect, it } from 'vitest';
import {
  createMetricAccumulator,
  recordRaceMetricSample,
} from '../../src/hooks/useRaceEngine';
import { bmxSpeedKphFromCadence } from '../../src/game/bmxRollout';
import type { BikeSample } from '../../src/types';

function sample(overrides: Partial<BikeSample> = {}): BikeSample {
  return {
    at: 1_000,
    source: 'bluetooth',
    deviceId: 1,
    label: 'Wattbike 1',
    watts: 400,
    wattsAt: 1_000,
    cadence: 120,
    cadenceAt: 1_000,
    speedKph: null,
    signal: 1,
    ...overrides,
  };
}

describe('race metric accumulation', () => {
  it('counts a cadence timestamp once while fresh power packets keep arriving', () => {
    const stats = createMetricAccumulator('Wattbike 1');
    recordRaceMetricSample(stats, sample(), 30, 900);
    recordRaceMetricSample(stats, sample({ at: 1_100, watts: 500, wattsAt: 1_100 }), 30, 900);

    expect(stats).toMatchObject({
      cadenceSamples: 1,
      cadenceTotal: 120,
      lastCadenceAt: 1_000,
      wattsSamples: 2,
      wattsTotal: 900,
    });
  });

  it('does not advance the valid cadence clock for an over-ceiling sample', () => {
    const stats = createMetricAccumulator('Wattbike 1');
    recordRaceMetricSample(stats, sample(), 30, 900);
    recordRaceMetricSample(stats, sample({
      at: 1_100,
      cadence: 200.01,
      cadenceAt: 1_100,
      wattsAt: 1_100,
    }), 151_080.1, 900);

    expect(stats).toMatchObject({
      cadenceSamples: 1,
      cadenceTotal: 120,
      lastCadenceAt: 1_000,
      speedSamples: 1,
      topSpeedKph: bmxSpeedKphFromCadence(120),
    });

    recordRaceMetricSample(stats, sample({
      at: 1_200,
      cadence: 200,
      cadenceAt: 1_200,
      wattsAt: 1_200,
    }), 40, 900);
    expect(stats).toMatchObject({ cadenceSamples: 2, cadenceTotal: 320, lastCadenceAt: 1_200 });
  });
});
