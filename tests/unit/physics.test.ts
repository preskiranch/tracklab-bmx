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
    const rider = step(13_001, 9_001);
    expect(rider.driveSource).toBe('coast');
    expect(rider.velocity).toBe(0);
    expect(rider.distance).toBe(0);
  });

  it('keeps a post-gate cadence live through a fresh partial Wattbike packet', () => {
    const initialRider = step(10_000, 10_000);
    const retainedCadencePacket: BikeSample = {
      ...sample(10_000),
      // A power characteristic arrived, but the cadence characteristic was not
      // repeated. Browser Bluetooth preserves the latest cadence in this case.
      at: 12_200,
      watts: 0,
      wattsAt: 12_200,
      cadenceAt: 10_000,
    };
    const rider = stepRiders(
      [initialRider],
      [player],
      new Map([[58701, retainedCadencePacket]]),
      0.1,
      9_000,
      400,
      {},
      [],
      [],
      12_200,
    )[0];

    expect(rider.driveSource).toBe('cadence');
    expect(rider.velocity).toBeGreaterThan(initialRider.velocity);
  });

  it('does not derive speed, distance, or a finish from over-limit cadence', () => {
    const riders = createInitialRiders([player]);
    const corruptCadenceSample = {
      ...sample(10_000),
      watts: 0,
      cadence: 923_334,
    };
    const rider = stepRiders(
      riders,
      [player],
      new Map([[58701, corruptCadenceSample]]),
      0.1,
      9_000,
      1,
      {},
      [],
      [],
      10_000,
    )[0];

    expect(rider.driveSource).toBe('coast');
    expect(rider.velocity).toBe(0);
    expect(rider.distance).toBe(0);
    expect(rider.finishedAt).toBeNull();
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

  it('does not make pre-gate cadence eligible when a later packet arrives', () => {
    const riders = createInitialRiders([player]);
    const rider = stepRiders(
      riders,
      [player],
      new Map([[58701, {
        ...sample(9_999),
        at: 10_000,
        watts: 0,
        wattsAt: 10_000,
        cadenceAt: 9_999,
      }]]),
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

  it('moves on the first one-watt post-gate drive packet', () => {
    const riders = createInitialRiders([player]);
    const launchSample = {
      ...sample(10_000),
      watts: 1,
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

  it('blocks rider input before the first configured pedal zone', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 10,
      endMeter: 20,
      type: 'pedal',
    }];
    const rider = step(10_000, 10_000, zones, 5);

    expect(rider.driveAllowed).toBe(false);
    expect(rider.driveSource).toBe('blocked');
    expect(rider.pedalPhase).toBe(0);
    expect(rider.distance).toBe(5);
  });

  it('shares mapped zones before and after a split but blocks the unmapped branch interior', () => {
    const splitDecisionPoints = [{
      id: 'split-1',
      index: 1,
      splitMeter: 10,
      mergeMeterByBranch: { a: 20, b: 25 },
      branchLengthByBranch: { a: 10, b: 15 },
    }];
    const amateurZones: TrackZone[] = [
      {
        id: 'shared-before',
        name: 'Shared before',
        startMeter: 0,
        endMeter: 8,
        type: 'pedal',
        branchSelections: { 'split-1': 'a' },
      },
      {
        id: 'amateur-branch',
        name: 'Amateur branch',
        startMeter: 10,
        endMeter: 20,
        type: 'pedal',
        branchSelections: { 'split-1': 'a' },
      },
      {
        id: 'shared-after',
        name: 'Shared after',
        startMeter: 30,
        endMeter: 40,
        type: 'pedal',
        branchSelections: { 'split-1': 'a' },
      },
    ];
    const stepProRider = (distance: number, zones = amateurZones) => stepRiders(
      [{
        ...createInitialRiders([player], { 1: 'b' })[0],
        distance,
        actualBranches: { 'split-1': 'b' },
      }],
      [player],
      new Map([[58701, sample(10_000)]]),
      0.1,
      9_000,
      400,
      { 1: 'b' },
      splitDecisionPoints,
      zones,
      10_000,
    )[0];

    expect(stepProRider(5).driveAllowed).toBe(true);
    expect(stepProRider(12)).toMatchObject({
      driveAllowed: false,
      driveSource: 'blocked',
      pedalPhase: 0,
    });
    expect(stepProRider(35).driveAllowed).toBe(true);

    const proZones: TrackZone[] = [
      ...amateurZones,
      {
        id: 'pro-branch',
        name: 'Pro branch',
        startMeter: 10,
        endMeter: 25,
        type: 'pedal',
        branchSelections: { 'split-1': 'b' },
      },
    ];
    expect(stepProRider(12, proZones).driveAllowed).toBe(true);
  });

  it('locks the crank level on the same frame a rider exits a pedal zone', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal 1',
      startMeter: 0,
      endMeter: 10,
      type: 'pedal',
    }];
    const rider = {
      ...createInitialRiders([player])[0],
      distance: 9.8,
      velocity: 8,
      pedalPhase: 0.73,
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

    expect(result.distance).toBeGreaterThanOrEqual(10);
    expect(result.driveAllowed).toBe(false);
    expect(result.driveSource).toBe('blocked');
    expect(result.pedalPhase).toBe(0);
    expect(result.lastWatts).toBe(0);
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

  it('finishes only when the front tire reaches the exact finish distance', () => {
    const beforeLine = {
      ...createInitialRiders([player])[0],
      distance: 399.3,
      velocity: 1,
    };
    const staged = stepRiders(
      [beforeLine],
      [player],
      new Map(),
      0.1,
      9_000,
      400,
      {},
      [],
      [],
      10_000,
    )[0];

    expect(staged.distance).toBeLessThan(400);
    expect(staged.finishedAt).toBeNull();

    const touchingLine = stepRiders(
      [{ ...staged, distance: 399.95, velocity: 1 }],
      [player],
      new Map(),
      0.1,
      9_100,
      400,
      {},
      [],
      [],
      10_100,
    )[0];

    expect(touchingLine.distance).toBe(400);
    expect(touchingLine.finishedAt).not.toBeNull();
  });
});
