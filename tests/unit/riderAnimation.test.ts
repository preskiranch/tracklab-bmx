import { describe, expect, it } from 'vitest';
import {
  riderAnimationState,
  riderCoastFrameIndex,
  riderPedalFrameCount,
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
    })).toMatchObject({ frameIndex: Math.floor(0.42 * riderPedalFrameCount), pedaling: true });
  });

  it('advances through a complete 360-degree cycle without reversing', () => {
    const frameAt = (pedalPhase: number) => riderAnimationState({
      raceState: 'racing',
      distanceMeters: 12,
      pedalPhase,
      driveAllowed: true,
      driveSource: 'cadence',
      cadenceRpm: 90,
      watts: 600,
    });
    const frames = Array.from({ length: riderPedalFrameCount }, (_, index) => (
      frameAt(index / riderPedalFrameCount).frameIndex
    ));

    expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(frameAt(0.99)).toMatchObject({ frameIndex: 7, nextFrameIndex: 0 });
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
    })).toMatchObject({ frameIndex: riderCoastFrameIndex, pedaling: false });
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
      frameIndex: riderCoastFrameIndex,
      nextFrameIndex: riderCoastFrameIndex,
      frameBlend: 0,
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
