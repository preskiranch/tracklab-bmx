import type { RaceState, RiderDriveSource } from '../types';

export const riderCrankStepCount = 24;
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
  crankAngleRadians: number;
  crankStep: number;
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
  cadenceRpm,
}: RiderAnimationInput): RiderAnimationState {
  const wheelTurns = Math.max(0, distanceMeters) / bmxWheelCircumferenceMeters;
  const wheelFrameIndex = Math.floor(normalizedPedalPhase(wheelTurns) * riderWheelFrameCount) % riderWheelFrameCount;
  const hasFreshCadence = cadenceRpm >= 1;
  const pedaling = raceState === 'racing' && driveAllowed && hasFreshCadence;

  if (!pedaling) {
    return {
      crankAngleRadians: 0,
      crankStep: 0,
      pedaling: false,
      wheelFrameIndex,
    };
  }

  const crankStep = Math.floor(
    (normalizedPedalPhase(pedalPhase) * riderCrankStepCount) + Number.EPSILON * riderCrankStepCount,
  ) % riderCrankStepCount;

  return {
    crankAngleRadians: (crankStep / riderCrankStepCount) * Math.PI * 2,
    crankStep,
    pedaling: true,
    wheelFrameIndex,
  };
}
