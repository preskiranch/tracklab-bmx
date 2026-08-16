import { describe, expect, it } from 'vitest';
import {
  canControlRaceStagingCountdown,
  createRaceStagingSteps,
  liveRaceStagingSeconds,
  raceStagingDurationMs,
} from '../../src/lib/raceStartSequence';

describe('live race staging sequence', () => {
  it('counts visibly from 20 through 1 before starting the gate cadence', () => {
    const steps = createRaceStagingSteps();

    expect(steps).toHaveLength(liveRaceStagingSeconds);
    expect(steps[0]).toEqual({ delayMs: 0, secondsRemaining: 20 });
    expect(steps.at(-1)).toEqual({ delayMs: 19_000, secondsRemaining: 1 });
    expect(raceStagingDurationMs()).toBe(20_000);
  });

  it('normalizes invalidly short staging durations', () => {
    expect(createRaceStagingSteps(0)).toEqual([{ delayMs: 0, secondsRemaining: 1 }]);
    expect(raceStagingDurationMs(0)).toBe(1_000);
  });

  it('allows solo staging controls whenever no private multiplayer room is active', () => {
    expect(canControlRaceStagingCountdown({
      gateActive: true,
      gatePhase: 'staging',
      multiplayerRoomActive: false,
    })).toBe(true);

    expect(canControlRaceStagingCountdown({
      gateActive: true,
      gatePhase: 'staging',
      multiplayerRoomActive: true,
    })).toBe(false);
    expect(canControlRaceStagingCountdown({
      gateActive: true,
      gatePhase: 'cadence',
      multiplayerRoomActive: false,
    })).toBe(false);
  });
});
