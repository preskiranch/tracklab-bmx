import { describe, expect, it } from 'vitest';
import {
  addGetPulledSample,
  addGetPulledSampleThroughEnd,
  createGetPulledAccumulator,
  getPulledDemoMetrics,
  getPulledMetrics,
  getPulledResultFromAccumulator,
  getPulledTakeoffSignal,
  normalizeGetPulledAirSetting,
  normalizeGetPulledSeconds,
} from '../../src/lib/getPulled';
import { bmxSpeedKphFromCadence } from '../../src/game/bmxRollout';
import {
  bindGetPulledResultToSession,
  authorizeGetPulledSessionArm,
  createGetPulledSessionArm,
  createGetPulledSessionCancellation,
  getPulledSessionArmMatchesLiveBinding,
  getPulledSecondsFromInput,
  getPulledSessionStartFromArm,
} from '../../src/components/GetPulledView';
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
  it('keeps the committed pull time while an editable duration is empty or invalid', () => {
    expect(getPulledSecondsFromInput('')).toBeNull();
    expect(getPulledSecondsFromInput('invalid')).toBeNull();
    expect(getPulledSecondsFromInput('12')).toBe(12);
    expect(getPulledSecondsFromInput('12.5')).toBeNull();
    expect(getPulledSecondsFromInput('600')).toBeNull();
  });

  it('allocates the immutable athlete/bike arm before countdown and cancels that same ID', () => {
    const arm = createGetPulledSessionArm(player, 6_000, 8, 10_000, () => 'arm-1');
    expect(arm).toEqual({
      sessionId: 'get-pulled:arm-1',
      playerId: 1,
      riderId: 'studio-rasheem',
      riderName: 'Rasheem "The Machine" Hicks',
      deviceId: 250_439_950,
      armedAt: 10_000,
      durationMs: 6_000,
      airSetting: 8,
    });
    expect(Object.isFrozen(arm)).toBe(true);

    const cancellation = createGetPulledSessionCancellation(
      arm!,
      'countdown',
      'user-cancelled',
      10_250,
    );
    expect(cancellation).toMatchObject({
      sessionId: 'get-pulled:arm-1',
      playerId: 1,
      deviceId: 250_439_950,
      phase: 'countdown',
      reason: 'user-cancelled',
      canceledAt: 10_250,
    });
  });

  it('keeps an armed physical bike and rider valid when surviving bikes are reindexed', () => {
    const armedPlayer = { ...player, id: 2 as const };
    const arm = createGetPulledSessionArm(armedPlayer, 6_000, 8, 10_000, () => 'reindexed')!;
    const reindexedPlayer = { ...player, id: 1 as const };

    expect(getPulledSessionArmMatchesLiveBinding(
      arm,
      [reindexedPlayer],
      { [player.deviceId!]: 'studio-rasheem' },
      false,
    )).toBe(true);
    expect(arm.playerId).toBe(2);
  });

  it('invalidates an armed pull on a real device disconnect or rider reassignment', () => {
    const arm = createGetPulledSessionArm(player, 6_000, 8, 10_000, () => 'changed-binding')!;

    expect(getPulledSessionArmMatchesLiveBinding(
      arm,
      [],
      { [player.deviceId!]: 'studio-rasheem' },
      false,
    )).toBe(false);
    expect(getPulledSessionArmMatchesLiveBinding(
      arm,
      [player],
      { [player.deviceId!]: 'studio-someone-else' },
      false,
    )).toBe(false);
  });

  it('waits for an asynchronous owner arm decision and can cancel before countdown', async () => {
    const arm = createGetPulledSessionArm(player, 6_000, 8, 10_000, () => 'delayed-arm')!;
    let decide!: (allowed: boolean) => void;
    const decision = new Promise<boolean>((resolve) => { decide = resolve; });
    let settled = false;
    const pending = authorizeGetPulledSessionArm(arm, () => decision).then((allowed) => {
      settled = true;
      return allowed;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    decide(false);
    await expect(pending).resolves.toBe(false);
    await expect(authorizeGetPulledSessionArm(arm, () => undefined)).resolves.toBe(true);
  });

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
    expect(getPulledMetrics(sample({ watts: 0, cadence: 10 }), 1_000)).toEqual({
      live: true,
      watts: 0,
      cadence: 0,
      speedKph: 0,
    });
    expect(getPulledMetrics(sample({ watts: 1, cadence: 0 }), 1_000)).toEqual({
      live: true,
      watts: 1,
      cadence: 0,
      speedKph: 0,
    });
    expect(getPulledMetrics(sample({ watts: 940, cadence: 923_334 }), 1_000)).toEqual({
      live: true,
      watts: 940,
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

  it('arms indefinitely and starts only on a fresh post-countdown 1-watt power packet', () => {
    const armedAt = 10_000;

    expect(getPulledTakeoffSignal(sample({
      at: 10_100,
      cadenceAt: 10_100,
      wattsAt: 10_100,
      cadence: 0,
      watts: 0,
    }), armedAt, 10_100)).toBeNull();
    expect(getPulledTakeoffSignal(sample({
      at: 10_200,
      cadenceAt: 10_200,
      wattsAt: 10_200,
      cadence: 90,
      watts: 0,
    }), armedAt, 10_200)).toBeNull();
    expect(getPulledTakeoffSignal(sample({
      at: 10_100,
      cadenceAt: 9_999,
      wattsAt: 9_999,
      cadence: 90,
      watts: 1,
    }), armedAt, 10_100)).toBeNull();

    const takeoff = getPulledTakeoffSignal(sample({
      at: 11_250,
      cadenceAt: 11_250,
      wattsAt: 11_250,
      cadence: 90,
      watts: 1,
    }), armedAt, 11_260);

    expect(takeoff).toEqual({
      at: 11_250,
      metrics: {
        live: true,
        watts: 1,
        cadence: 90,
        speedKph: bmxSpeedKphFromCadence(90),
      },
    });

    expect(getPulledTakeoffSignal(sample({
      at: 11_300,
      cadenceAt: 11_300,
      wattsAt: 11_300,
      cadence: 923_334,
      watts: 1,
    }), armedAt, 11_310)).toMatchObject({
      metrics: { cadence: 0, speedKph: 0 },
    });

    const arm = createGetPulledSessionArm(player, 6_000, 8, 10_000, () => 'first-watt');
    const session = getPulledSessionStartFromArm(arm!, takeoff!.at);
    expect(session).toMatchObject({
      sessionId: 'get-pulled:first-watt',
      armedAt: 10_000,
      startedAt: 11_250,
      deviceId: 250_439_950,
      riderId: 'studio-rasheem',
    });
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

    const arm = createGetPulledSessionArm(player, 6_000, 8, 500, () => 'history-relay-id');
    const session = getPulledSessionStartFromArm(arm!, 1_000);
    expect(bindGetPulledResultToSession(result, session).id).toBe('get-pulled:history-relay-id');
  });

  it('clamps a delayed timer sample to the official pull finish', () => {
    let accumulator = createGetPulledAccumulator();
    const metrics = { live: true, watts: 500, cadence: 90, speedKph: 36 };
    accumulator = addGetPulledSample(accumulator, metrics, 1_900);
    accumulator = addGetPulledSampleThroughEnd(accumulator, metrics, 2_075, 2_000);

    expect(accumulator.lastAt).toBe(2_000);
    expect(accumulator.distanceMeters).toBeCloseTo(1, 8);
  });

  it('drops an invalid cadence sample without advancing its integration clock', () => {
    const boundary = addGetPulledSample(
      createGetPulledAccumulator(),
      { live: true, watts: 500, cadence: 200, speedKph: 52.6 },
      1_000,
    );
    const rejected = addGetPulledSample(
      boundary,
      { live: true, watts: 500, cadence: 200.01, speedKph: 151_080.1 },
      1_500,
    );
    expect(boundary).toMatchObject({ sampleCount: 1, peakCadence: 200, lastAt: 1_000 });
    expect(rejected).toBe(boundary);
    expect(rejected.distanceMeters).toBe(boundary.distanceMeters);
  });
});
