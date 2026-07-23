import { describe, expect, it } from 'vitest';
import {
  countdownSeconds,
  detectFalseStart,
  falseStartSpeedThresholdKph,
  nextRaceFinishDeadline,
  raceFinishCountdownMs,
} from '../../src/lib/raceLifecycle';
import type { BikeSample, PlayerSlot, RiderState } from '../../src/types';

const player: PlayerSlot = {
  id: 1,
  name: 'Rider One',
  colorName: 'lime',
  accent: '#7ade36',
  deviceId: 58701,
};

function bikeSample(overrides: Partial<BikeSample> = {}): BikeSample {
  return {
    at: 10_100,
    source: 'bluetooth',
    deviceId: 58701,
    label: 'WattbikePM25058701',
    watts: 0,
    wattsAt: 10_100,
    cadence: 0,
    cadenceAt: 10_100,
    speedKph: 0,
    speedAt: 10_100,
    signal: 1,
    ...overrides,
  };
}

function rider(finishedAt: number | null): RiderState {
  return {
    playerId: 1,
    distance: finishedAt == null ? 20 : 100,
    velocity: 0,
    phase: finishedAt == null ? 'pedaling' : 'finished',
    airY: 0,
    airVelocity: 0,
    pitch: 0,
    rank: 1,
    finishedAt,
    thirtyFootTimeMs: null,
    reactionTimeMs: null,
    selectedBranch: 'a',
    actualBranches: {},
    proPenaltyApplied: false,
    driveAllowed: true,
    driveSource: 'coast',
  };
}

describe('race lifecycle timing', () => {
  it('starts one ten-second finish window when the first rider finishes', () => {
    expect(nextRaceFinishDeadline(null, [rider(null)], 20_000)).toBeNull();
    expect(nextRaceFinishDeadline(null, [rider(19_500)], 20_000)).toBe(20_000 + raceFinishCountdownMs);
    expect(nextRaceFinishDeadline(30_000, [rider(19_500)], 21_000)).toBe(30_000);
  });

  it('reports stable whole-second countdown values', () => {
    expect(countdownSeconds(30_000, 20_000)).toBe(10);
    expect(countdownSeconds(30_000, 20_001)).toBe(10);
    expect(countdownSeconds(30_000, 21_001)).toBe(9);
    expect(countdownSeconds(30_000, 29_999)).toBe(1);
    expect(countdownSeconds(30_000, 30_000)).toBe(0);
  });
});

describe('false-start detection', () => {
  it('ignores telemetry recorded before the cadence began', () => {
    const sample = bikeSample({
      at: 10_100,
      speedKph: 20,
      speedAt: 9_999,
      cadence: 100,
      cadenceAt: 9_999,
    });
    expect(detectFalseStart([player], new Map([[58701, sample]]), 10_000, 10_100)).toBeNull();
  });

  it('ignores power-only noise while the rider remains stopped', () => {
    const sample = bikeSample({ watts: 18, wattsAt: 10_100 });
    expect(detectFalseStart([player], new Map([[58701, sample]]), 10_000, 10_100)).toBeNull();
  });

  it('detects measured speed at the one-mile-per-hour threshold', () => {
    const sample = bikeSample({ speedKph: falseStartSpeedThresholdKph });
    expect(detectFalseStart([player], new Map([[58701, sample]]), 10_000, 10_100)).toMatchObject({
      playerId: 1,
      deviceId: 58701,
      source: 'speed',
    });
  });

  it('detects BMX rollout speed derived from cadence', () => {
    const sample = bikeSample({ speedKph: null, cadence: 20 });
    expect(detectFalseStart([player], new Map([[58701, sample]]), 10_000, 10_100)).toMatchObject({
      playerId: 1,
      source: 'cadence',
    });
  });
});
