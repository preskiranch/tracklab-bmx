import { describe, expect, it } from 'vitest';
import { monitorMetrics } from '../../src/components/MonitorView';
import { bmxSpeedKphFromCadence } from '../../src/game/bmxRollout';
import type { BikeSample } from '../../src/types';

function sample(overrides: Partial<BikeSample> = {}): BikeSample {
  return {
    at: 1_000,
    cadence: 66,
    cadenceAt: 1_000,
    deviceId: 58_701,
    label: 'WattbikePM25058701',
    signal: 1,
    source: 'bluetooth',
    speedAt: 1_000,
    speedKph: 0,
    watts: 63,
    wattsAt: 1_000,
    ...overrides,
  };
}

describe('Monitor View metrics', () => {
  it('derives speed from cadence using the shared 44/16 BMX rollout', () => {
    const metrics = monitorMetrics(sample(), 1_000);

    expect(metrics.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(66), 6);
    expect(metrics.speedKph).toBeGreaterThan(0);
  });

  it('does not display Wattbike speed in place of BMX rollout speed', () => {
    const metrics = monitorMetrics(sample({ cadence: 60, speedKph: 80 }), 1_000);

    expect(metrics.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(60), 6);
    expect(metrics.speedKph).not.toBe(80);
  });
});
