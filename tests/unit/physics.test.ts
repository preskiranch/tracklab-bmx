import { describe, expect, it } from 'vitest';
import { createInitialRiders, stepRiders } from '../../src/game/physics';
import type { BikeSample, PlayerSlot, TrackZone } from '../../src/types';

const player: PlayerSlot = {
  id: 1,
  name: 'Rider One',
  colorName: 'lime',
  accent: '#7ade36',
  deviceId: 58701,
};

function sample(at: number): BikeSample {
  return {
    at,
    source: 'bluetooth',
    deviceId: 58701,
    label: 'WattbikePM25058701',
    watts: 900,
    wattsAt: at,
    cadence: 100,
    cadenceAt: at,
    speedKph: null,
    signal: 1,
  };
}

function step(at: number, sampleAt: number, zones: TrackZone[] = [], distance = 0) {
  const riders = createInitialRiders([player]);
  riders[0] = { ...riders[0], distance };
  return stepRiders(
    riders,
    [player],
    new Map([[58701, sample(sampleAt)]]),
    0.1,
    9_000,
    400,
    {},
    [],
    zones,
    at,
  )[0];
}

describe('race physics input gating', () => {
  it('moves immediately from a fresh bike signal', () => {
    const rider = step(10_000, 10_000);
    expect(rider.driveAllowed).toBe(true);
    expect(rider.driveSource).toBe('cadence');
    expect(rider.velocity).toBeGreaterThan(0);
    expect(rider.distance).toBeGreaterThan(0);
  });

  it('does not propel a rider from stale telemetry', () => {
    const rider = step(10_000, 7_000);
    expect(rider.driveSource).toBe('coast');
    expect(rider.velocity).toBe(0);
    expect(rider.distance).toBe(0);
  });

  it('blocks drive outside configured pedal zones after the first zone', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 0,
      endMeter: 10,
      type: 'pedal',
    }];
    const rider = step(10_000, 10_000, zones, 20);
    expect(rider.driveAllowed).toBe(false);
    expect(rider.driveSource).toBe('blocked');
    expect(rider.distance).toBe(20);
  });

  it('treats a zero-valued finish timestamp as finished', () => {
    const riders = createInitialRiders([player]);
    riders[0] = { ...riders[0], finishedAt: 0, distance: 400 };
    const result = stepRiders(
      riders,
      [player],
      new Map([[58701, sample(10_000)]]),
      0.1,
      9_000,
      400,
      {},
      [],
      [],
      10_000,
    )[0];
    expect(result).toEqual(riders[0]);
  });
});
