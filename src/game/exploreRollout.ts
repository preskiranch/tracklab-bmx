export const exploreRolloutConfig = {
  frontChainringTeeth: 54,
  rearCogTeeth: 17,
  rolloutMetersPerCrankRevolution: 6.9,
  targetCadenceRpm: 90,
} as const;

export const exploreGearRatio =
  exploreRolloutConfig.frontChainringTeeth / exploreRolloutConfig.rearCogTeeth;

export const exploreRolloutFeetPerCrankRevolution =
  exploreRolloutConfig.rolloutMetersPerCrankRevolution * 3.28084;

export function exploreVelocityMpsFromCadence(cadenceRpm: number | null | undefined) {
  return Math.max(0, cadenceRpm ?? 0) / 60
    * exploreRolloutConfig.rolloutMetersPerCrankRevolution;
}

export function exploreCadenceRpmFromVelocityMps(velocityMps: number | null | undefined) {
  return Math.max(0, velocityMps ?? 0)
    / exploreRolloutConfig.rolloutMetersPerCrankRevolution
    * 60;
}

export function exploreSpeedKphFromCadence(cadenceRpm: number | null | undefined) {
  return exploreVelocityMpsFromCadence(cadenceRpm) * 3.6;
}
