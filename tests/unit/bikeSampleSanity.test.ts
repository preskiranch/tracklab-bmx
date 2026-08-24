import { describe, expect, it } from 'vitest';
import {
  cleanBikeBattery,
  cleanBikeCadenceRpm,
  cleanBikeSpeedKph,
  cleanBikeWatts,
  maximumAcceptedWattbikeCadenceRpm,
  recordedBikeMetricsAreAccepted,
  sanitizeBikeMetricPatch,
  sanitizeBikeSample,
} from '../../src/lib/bikeSampleSanity';
import type { BikeSample } from '../../src/types';

describe('bike sample sanitization', () => {
  it('accepts 200 RPM exactly and rejects any higher cadence without clamping', () => {
    expect(cleanBikeWatts(-1)).toBeNull();
    expect(cleanBikeWatts(4001)).toBeNull();
    expect(cleanBikeCadenceRpm(Number.NaN)).toBeNull();
    expect(cleanBikeCadenceRpm(-1)).toBeNull();
    expect(maximumAcceptedWattbikeCadenceRpm).toBe(200);
    expect(cleanBikeCadenceRpm(maximumAcceptedWattbikeCadenceRpm)).toBe(200);
    expect(cleanBikeCadenceRpm(200.01)).toBeNull();
    expect(cleanBikeCadenceRpm(201)).toBeNull();
    expect(cleanBikeCadenceRpm(923_334)).toBeNull();
    expect(cleanBikeSpeedKph(81)).toBeNull();
    expect(cleanBikeBattery(101)).toBeUndefined();
  });

  it('drops an invalid cadence patch so it cannot refresh the last valid cadence timestamp', () => {
    expect(sanitizeBikeMetricPatch({ cadence: 200.01, watts: 740 })).toEqual({ watts: 740 });
  });

  it('validates recorded meter-per-second aliases without changing their units', () => {
    expect(recordedBikeMetricsAreAccepted({ peakSpeedMps: 83 / 3.6 })).toBe(true);
    expect(recordedBikeMetricsAreAccepted({ peakSpeedMps: (83 / 3.6) + 0.01 })).toBe(false);
    expect(recordedBikeMetricsAreAccepted({ averageSpeedMps: 20, peakSpeedMps: 19 })).toBe(false);
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
    expect(sanitizeBikeSample({
      ...base,
      cadence: 923_334,
      cadenceAt: 2_000,
    })).toMatchObject({
      cadence: null,
      cadenceAt: undefined,
    });
  });
});
