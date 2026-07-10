import { describe, expect, it } from 'vitest';
import {
  cleanBikeBattery,
  cleanBikeCadenceRpm,
  cleanBikeSpeedKph,
  cleanBikeWatts,
  sanitizeBikeMetricPatch,
  sanitizeBikeSample,
} from '../../src/lib/bikeSampleSanity';
import type { BikeSample } from '../../src/types';

describe('bike sample sanitization', () => {
  it('rejects non-finite, negative, and implausible metrics', () => {
    expect(cleanBikeWatts(-1)).toBeNull();
    expect(cleanBikeWatts(4001)).toBeNull();
    expect(cleanBikeCadenceRpm(Number.NaN)).toBeNull();
    expect(cleanBikeCadenceRpm(261)).toBeNull();
    expect(cleanBikeSpeedKph(81)).toBeNull();
    expect(cleanBikeBattery(101)).toBeUndefined();
  });

  it('retains valid values while omitting invalid patch fields', () => {
    expect(sanitizeBikeMetricPatch({ watts: 740.4, cadence: 92.6, speedKph: -2, battery: 87.7 })).toEqual({
      watts: 740,
      cadence: 93,
      battery: 88,
    });
  });

  it('rejects invalid device identities and normalizes timestamps', () => {
    const base: BikeSample = {
      at: 1_000,
      source: 'bluetooth',
      deviceId: 58701,
      label: 'WattbikePM25058701',
      watts: 500,
      cadence: 90,
      speedKph: 24,
      signal: 0.9,
    };

    expect(sanitizeBikeSample({ ...base, deviceId: 0 })).toBeNull();
    expect(sanitizeBikeSample(base)).toMatchObject({
      deviceId: 58701,
      watts: 500,
      wattsAt: 1_000,
      cadence: 90,
      cadenceAt: 1_000,
      speedKph: 24,
      speedAt: 1_000,
    });
  });
});
