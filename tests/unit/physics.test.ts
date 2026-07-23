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

  it('does not reuse a moving sample captured before the gate drop', () => {
    const riders = createInitialRiders([player]);
    const rider = stepRiders(
      riders,
      [player],
      new Map([[58701, sample(9_999)]]),
      0.1,
      10_000,
      400,
      {},
      [],
      [],
      10_000,
    )[0];

    expect(rider.driveSource).toBe('coast');
    expect(rider.distance).toBe(0);
  });

  it('uses a valid post-red sample immediately on the first gate-drop frame', () => {
    const riders = createInitialRiders([player]);
    const rider = stepRiders(
      riders,
      [player],
      new Map([[58701, sample(9_999)]]),
      0.1,
      10_000,
      400,
      {},
      [],
      [],
      10_000,
      9_500,
    )[0];

    expect(rider.driveAllowed).toBe(true);
    expect(rider.driveSource).toBe('cadence');
    expect(rider.distance).toBeGreaterThan(0);
  });

  it('moves on the first low but valid post-gate drive packet', () => {
    const riders = createInitialRiders([player]);
    const launchSample = {
      ...sample(10_000),
      watts: 20,
      cadence: 0,
      speedKph: null,
    };
    const rider = stepRiders(
      riders,
      [player],
      new Map([[58701, launchSample]]),
      0.1,
      10_000,
      400,
      {},
      [],
      [],
      10_000,
    )[0];

    expect(rider.driveAllowed).toBe(true);
    expect(rider.velocity).toBeGreaterThan(0);
    expect(rider.distance).toBeGreaterThan(0);
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

  it('holds the exact entry speed throughout a coasting section', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 0,
      endMeter: 10,
      type: 'pedal',
    }];
    const entryVelocityMps = 25 * 0.44704;
    let rider = {
      ...createInitialRiders([player])[0],
      distance: 20,
      velocity: entryVelocityMps,
    };

    for (let frame = 0; frame < 12; frame += 1) {
      rider = stepRiders(
        [rider],
        [player],
        new Map([[58701, sample(10_000 + frame * 100)]]),
        0.1,
        9_000,
        400,
        {},
        [],
        zones,
        10_000 + frame * 100,
      )[0];
      expect(rider.driveAllowed).toBe(false);
      expect(rider.driveSource).toBe('blocked');
      expect(rider.velocity).toBeCloseTo(entryVelocityMps, 10);
    }

    expect(rider.distance).toBeCloseTo(20 + entryVelocityMps * 1.2, 8);
  });

  it('locks the crank phase level while coasting and resumes at Wattbike cadence', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 0,
      endMeter: 10,
      type: 'pedal',
    }];
    const coastingRider = {
      ...createInitialRiders([player])[0],
      distance: 20,
      velocity: 8,
      pedalPhase: 0.73,
    };
    const coastResult = stepRiders(
      [coastingRider],
      [player],
      new Map([[58701, sample(10_000)]]),
      0.1,
      9_000,
      400,
      {},
      [],
      zones,
      10_000,
    )[0];

    expect(coastResult.driveAllowed).toBe(false);
    expect(coastResult.pedalPhase).toBe(0);

    const pedalResult = stepRiders(
      [{ ...coastResult, distance: 0 }],
      [player],
      new Map([[58701, sample(10_100)]]),
      0.1,
      9_000,
      400,
      {},
      [],
      zones,
      10_100,
    )[0];

    expect(pedalResult.driveSource).toBe('coast');
    expect(pedalResult.pedalPhase).toBeCloseTo((100 / 60) * 0.1);
  });

  it('does not launch over an obstacle while inside a coasting section', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 0,
      endMeter: 10,
      type: 'pedal',
    }];
    const takeoffMeter = 340 * 0.19;
    const rider = {
      ...createInitialRiders([player])[0],
      distance: takeoffMeter - 0.4,
      velocity: 8,
    };

    const result = stepRiders(
      [rider],
      [player],
      new Map([[58701, sample(10_000)]]),
      0.1,
      9_000,
      400,
      {},
      [],
      zones,
      10_000,
    )[0];

    expect(result.driveAllowed).toBe(false);
    expect(result.phase).toBe('pedaling');
    expect(result.air).toBe(0);
  });

  it('enters the next pedal zone without losing the held coasting speed', () => {
    const zones: TrackZone[] = [
      {
        id: 'pedal-1',
        name: 'Pedal 1',
        startMeter: 0,
        endMeter: 10,
        type: 'pedal',
      },
      {
        id: 'pedal-2',
        name: 'Pedal 2',
        startMeter: 30,
        endMeter: 60,
        type: 'pedal',
      },
    ];
    const entryVelocityMps = 25 * 0.44704;
    const blockedRider = {
      ...createInitialRiders([player])[0],
      distance: 30,
      velocity: entryVelocityMps,
      driveAllowed: false,
      driveSource: 'blocked' as const,
    };

    const resumedRider = stepRiders(
      [blockedRider],
      [player],
      new Map([[58701, sample(10_000)]]),
      0.1,
      9_000,
      400,
      {},
      [],
      zones,
      10_000,
    )[0];

    expect(resumedRider.driveAllowed).toBe(true);
    expect(resumedRider.driveSource).toBe('coast');
    expect(resumedRider.velocity).toBeCloseTo(entryVelocityMps, 10);
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
