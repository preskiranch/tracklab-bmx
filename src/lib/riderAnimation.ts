import type { RaceState, RiderDriveSource } from '../types';

export const riderPedalFrameCount = 5;
export const riderCoastFrameIndex = riderPedalFrameCount;
export const riderAtlasFrameCount = riderPedalFrameCount + 1;
export const riderWheelFrameCount = 4;
const bmxWheelCircumferenceMeters = Math.PI * 0.508;

type RiderAnimationInput = {
  raceState: RaceState;
  distanceMeters: number;
  pedalPhase: number;
  driveAllowed: boolean;
  driveSource: RiderDriveSource;
  cadenceRpm: number;
  watts: number;
};

export type RiderAnimationState = {
  frameIndex: number;
  pedaling: boolean;
  wheelFrameIndex: number;
};

function normalizedPedalPhase(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return ((value % 1) + 1) % 1;
}

export function riderAnimationState({
  raceState,
  distanceMeters,
  pedalPhase,
  driveAllowed,
  driveSource,
  cadenceRpm,
  watts,
}: RiderAnimationInput): RiderAnimationState {
  const wheelTurns = Math.max(0, distanceMeters) / bmxWheelCircumferenceMeters;
  const wheelFrameIndex = Math.floor(normalizedPedalPhase(wheelTurns) * riderWheelFrameCount) % riderWheelFrameCount;
  const driveIsEngaged = driveSource === 'cadence'
    || driveSource === 'power'
    || driveSource === 'speed';
  const hasPedalInput = cadenceRpm >= 1 || watts >= 10;
  const pedaling = raceState === 'racing' && driveAllowed && driveIsEngaged && hasPedalInput;

  if (!pedaling) {
    return { frameIndex: riderCoastFrameIndex, pedaling: false, wheelFrameIndex };
  }

  return {
    frameIndex: Math.floor(normalizedPedalPhase(pedalPhase) * riderPedalFrameCount) % riderPedalFrameCount,
    pedaling: true,
    wheelFrameIndex,
  };
}
