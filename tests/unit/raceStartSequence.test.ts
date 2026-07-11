import { describe, expect, it } from 'vitest';
import {
  createRaceStagingSteps,
  liveRaceStagingSeconds,
  raceStagingDurationMs,
} from '../../src/lib/raceStartSequence';

describe('live race staging sequence', () => {
  it('counts visibly from 15 through 1 before starting the gate cadence', () => {
    const steps = createRaceStagingSteps();

    expect(steps).toHaveLength(liveRaceStagingSeconds);
    expect(steps[0]).toEqual({ delayMs: 0, secondsRemaining: 15 });
    expect(steps.at(-1)).toEqual({ delayMs: 14_000, secondsRemaining: 1 });
    expect(raceStagingDurationMs()).toBe(15_000);
  });

  it('normalizes invalidly short staging durations', () => {
    expect(createRaceStagingSteps(0)).toEqual([{ delayMs: 0, secondsRemaining: 1 }]);
    expect(raceStagingDurationMs(0)).toBe(1_000);
  });
});
