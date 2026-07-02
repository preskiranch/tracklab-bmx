export const bmxRolloutConfig = {
  wheelDiameterInches: 20,
  frontSprocketTeeth: 44,
  rearCogTeeth: 16,
} as const;

export const bmxGearRatio =
  bmxRolloutConfig.frontSprocketTeeth / bmxRolloutConfig.rearCogTeeth;

export const bmxGearInches =
  bmxRolloutConfig.wheelDiameterInches * bmxGearRatio;

export const bmxRolloutInchesPerCrankRevolution =
  bmxGearInches * Math.PI;

export const bmxRolloutMetersPerCrankRevolution =
  bmxRolloutInchesPerCrankRevolution * 0.0254;

export function bmxVelocityMpsFromCadence(cadenceRpm: number | null | undefined) {
  return Math.max(0, cadenceRpm ?? 0) / 60 * bmxRolloutMetersPerCrankRevolution;
}

export function bmxSpeedKphFromCadence(cadenceRpm: number | null | undefined) {
  return bmxVelocityMpsFromCadence(cadenceRpm) * 3.6;
}
