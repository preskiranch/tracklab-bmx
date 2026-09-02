import { describe, expect, it } from 'vitest';
import { racePhysicsFrameSteps } from '../../src/hooks/useRaceEngine';

describe('race animation frame timing', () => {
  it('recovers a delayed foreground frame without dropping live-rider time', () => {
    const steps = racePhysicsFrameSteps(250);

    expect(steps).toHaveLength(5);
    expect(steps.every((step) => step > 0 && step <= 0.05)).toBe(true);
    expect(steps.reduce((total, step) => total + step, 0)).toBeCloseTo(0.25, 10);
  });

  it('keeps normal frames immediate and bounds long background catch-up work', () => {
    expect(racePhysicsFrameSteps(16.667)).toEqual([0.016667]);

    const backgroundSteps = racePhysicsFrameSteps(30_000);
    expect(backgroundSteps).toHaveLength(40);
    expect(backgroundSteps.reduce((total, step) => total + step, 0)).toBeCloseTo(2, 10);
  });

  it('always advances at least one millisecond for a duplicate frame timestamp', () => {
    expect(racePhysicsFrameSteps(0)).toEqual([0.001]);
    expect(racePhysicsFrameSteps(Number.NaN)).toEqual([0.001]);
  });
});
