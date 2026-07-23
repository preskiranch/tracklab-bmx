import { describe, expect, it } from 'vitest';
import {
  riderAnimationState,
  riderCrankStepCount,
} from '../../src/lib/riderAnimation';

describe('rider animation', () => {
  it('follows the live pedal phase while rider input is allowed', () => {
    expect(riderAnimationState({
      raceState: 'racing',
      distanceMeters: 12,
      pedalPhase: 0.42,
      driveAllowed: true,
      driveSource: 'cadence',
      cadenceRpm: 92,
      watts: 640,
    })).toMatchObject({
      crankStep: Math.floor(0.42 * riderCrankStepCount),
      pedaling: true,
    });
  });

  it('advances the crank forward through a complete 360-degree cycle without reversing', () => {
    const animationAt = (pedalPhase: number) => riderAnimationState({
      raceState: 'racing',
      distanceMeters: 12,
      pedalPhase,
      driveAllowed: true,
      driveSource: 'cadence',
      cadenceRpm: 90,
      watts: 600,
    });
    const steps = Array.from({ length: riderCrankStepCount }, (_, index) => (
      animationAt(index / riderCrankStepCount).crankStep
    ));

    expect(steps).toEqual(Array.from({ length: riderCrankStepCount }, (_, index) => index));
    expect(animationAt(0).crankAngleRadians).toBe(0);
    expect(animationAt(0.25).crankAngleRadians).toBeCloseTo(Math.PI / 2);
    expect(animationAt(0.5).crankAngleRadians).toBeCloseTo(Math.PI);
    expect(animationAt(0.75).crankAngleRadians).toBeCloseTo(Math.PI * 1.5);
    expect(animationAt(0.99).crankStep).toBe(riderCrankStepCount - 1);
  });

  it.each([
    { driveAllowed: false, driveSource: 'blocked' as const, cadenceRpm: 110, watts: 900 },
    { driveAllowed: true, driveSource: 'coast' as const, cadenceRpm: 0, watts: 0 },
  ])('uses the coasting posture when rider input cannot propel the bike', (input) => {
    expect(riderAnimationState({
      raceState: 'racing',
      distanceMeters: 12,
      pedalPhase: 0.8,
      ...input,
    })).toMatchObject({ crankAngleRadians: 0, crankStep: 0, pedaling: false });
  });

  it('shows fresh Wattbike cadence in a pedal zone even before it adds rollout speed', () => {
    expect(riderAnimationState({
      raceState: 'racing',
      distanceMeters: 30,
      pedalPhase: 0.25,
      driveAllowed: true,
      driveSource: 'coast',
      cadenceRpm: 100,
      watts: 700,
    })).toMatchObject({
      crankAngleRadians: Math.PI / 2,
      pedaling: true,
    });
  });

  it('does not animate pedaling before the race starts', () => {
    expect(riderAnimationState({
      raceState: 'ready',
      distanceMeters: 0,
      pedalPhase: 0.2,
      driveAllowed: true,
      driveSource: 'cadence',
      cadenceRpm: 80,
      watts: 500,
    })).toEqual({
      crankAngleRadians: 0,
      crankStep: 0,
      pedaling: false,
      wheelFrameIndex: 0,
    });
  });

  it('keeps wheel motion tied to track distance while coasting', () => {
    const animationAt = (distanceMeters: number) => riderAnimationState({
      raceState: 'racing',
      distanceMeters,
      pedalPhase: 0.5,
      driveAllowed: false,
      driveSource: 'blocked',
      cadenceRpm: 100,
      watts: 800,
    });

    expect(animationAt(0).pedaling).toBe(false);
    expect(animationAt(0.5).wheelFrameIndex).not.toBe(animationAt(0).wheelFrameIndex);
  });
});
