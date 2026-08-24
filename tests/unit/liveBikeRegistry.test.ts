import { describe, expect, it } from 'vitest';
import {
  bikeMetricIsLive,
  bikeSampleIsLive,
  selectRaceBikeDevices,
  upsertBoundedBikeSample,
} from '../../src/lib/liveBikeRegistry';
import type { BikeSample, ConnectedBikeDevice } from '../../src/types';

function sample(deviceId: number, at: number): BikeSample {
  return {
    at,
    cadence: 100,
    deviceId,
    label: `Wattbike ${deviceId}`,
    signal: 1,
    source: 'bluetooth',
    speedKph: null,
    watts: 500,
  };
}

describe('live bike registry', () => {
  it('rejects stale samples and implausible future timestamps', () => {
    expect(bikeSampleIsLive(sample(1, 9_000), 10_000, 3_800)).toBe(true);
    expect(bikeSampleIsLive(sample(1, 6_000), 10_000, 3_800)).toBe(false);
    expect(bikeSampleIsLive(sample(1, 12_000), 10_000, 3_800)).toBe(false);
  });

  it('does not relabel preserved cadence as live when only another metric advances', () => {
    const retained = { ...sample(1, 10_000), cadenceAt: 6_000, wattsAt: 10_000 };
    expect(bikeSampleIsLive(retained, 10_000, 3_800)).toBe(true);
    expect(bikeMetricIsLive(retained.cadenceAt, 10_000, 3_800)).toBe(false);
    expect(bikeMetricIsLive(6_200, 10_000, 3_800)).toBe(true);
  });

  it('deduplicates devices, filters disconnected entries, and prefers primary power devices', () => {
    const devices: ConnectedBikeDevice[] = [
      {
        at: 9_000,
        connected: true,
        connectionOrigin: 'bridge-status',
        deviceId: 58701,
        label: 'WattbikePM25058701',
        source: 'bluetooth',
      },
      {
        at: 9_500,
        connected: true,
        connectionOrigin: 'bridge-sample',
        deviceId: 58701,
        label: 'Wattbike 58701',
        source: 'bluetooth',
      },
      {
        at: 9_500,
        connected: true,
        connectionOrigin: 'bridge-sample',
        deviceId: 70001,
        label: 'Speed/Cadence 70001',
        source: 'ant',
      },
      {
        at: 9_500,
        connected: false,
        connectionOrigin: 'bridge-status',
        deviceId: 58702,
        label: 'Wattbike 58702',
        source: 'bluetooth',
      },
    ];

    expect(selectRaceBikeDevices(devices, 10_000, {
      deviceTimeoutMs: 15_000,
      maxDevices: 4,
    })).toEqual([
      expect.objectContaining({ deviceId: 58701, label: 'Wattbike 58701' }),
    ]);
  });

  it('ignores out-of-order samples and bounds retained device history', () => {
    let samples = new Map<number, BikeSample>();
    samples = upsertBoundedBikeSample(samples, sample(1, 100), 2);
    samples = upsertBoundedBikeSample(samples, sample(1, 90), 2);
    samples = upsertBoundedBikeSample(samples, sample(2, 200), 2);
    samples = upsertBoundedBikeSample(samples, sample(3, 300), 2);

    expect(samples.has(1)).toBe(false);
    expect(samples.get(2)?.at).toBe(200);
    expect(samples.get(3)?.at).toBe(300);
  });
});
