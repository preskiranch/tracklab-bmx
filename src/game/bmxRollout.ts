import { acceptedBikeCadenceRpm, acceptedTrainingSpeedKph } from '../lib/bikeSampleSanity';

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

// Demo riders should live in a believable elite BMX sprint envelope. Preserve
// lower cadence as generated, then compress synthetic peaks above 150 RPM so
// the simulator cannot invent 250+ RPM riders. At 44/16 on a 20-inch wheel,
// the 30 MPH ceiling is about 183 RPM.
export const bmxDemoCadenceCompressionStartsRpm = 150;
export const bmxDemoCadenceCompressionRatio = 0.2;
export const bmxDemoMaximumSpeedMph = 30;

export function bmxVelocityMpsFromCadence(cadenceRpm: number | null | undefined) {
  const cadence = acceptedBikeCadenceRpm(cadenceRpm) ?? 0;
  return cadence / 60 * bmxRolloutMetersPerCrankRevolution;
}

export function bmxCadenceRpmFromVelocityMps(velocityMps: number | null | undefined) {
  return Math.max(0, velocityMps ?? 0) / bmxRolloutMetersPerCrankRevolution * 60;
}

export function bmxSpeedKphFromCadence(cadenceRpm: number | null | undefined) {
  return bmxVelocityMpsFromCadence(cadenceRpm) * 3.6;
}

export const bmxDemoMaximumCadenceRpm = bmxCadenceRpmFromVelocityMps(
  bmxDemoMaximumSpeedMph * 0.44704,
);

export function realisticDemoCadenceRpm(rawCadenceRpm: number | null | undefined) {
  const rawCadence = Math.max(0, rawCadenceRpm ?? 0);
  if (rawCadence <= bmxDemoCadenceCompressionStartsRpm) {
    return rawCadence;
  }
  return Math.min(
    bmxDemoMaximumCadenceRpm,
    bmxDemoCadenceCompressionStartsRpm
      + (rawCadence - bmxDemoCadenceCompressionStartsRpm) * bmxDemoCadenceCompressionRatio,
  );
}

export function reportedBmxTopSpeedKph(
  topCadenceRpm: number | null | undefined,
  courseTopSpeedKph: number | null | undefined,
) {
  return Math.max(
    bmxSpeedKphFromCadence(topCadenceRpm),
    acceptedTrainingSpeedKph(courseTopSpeedKph) ?? 0,
  );
}
