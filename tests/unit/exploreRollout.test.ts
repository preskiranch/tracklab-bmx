import { describe, expect, it } from 'vitest';
import {
  exploreCadenceRpmFromVelocityMps,
  exploreGearRatio,
  exploreRolloutConfig,
  exploreRolloutFeetPerCrankRevolution,
  exploreSpeedKphFromCadence,
  exploreVelocityMpsFromCadence,
} from '../../src/game/exploreRollout';
import { bmxRolloutConfig } from '../../src/game/bmxRollout';

describe('Explore-only road rollout', () => {
  it('uses the requested 54/17 gearing and 6.9 meter rollout', () => {
    expect(exploreRolloutConfig.frontChainringTeeth).toBe(54);
    expect(exploreRolloutConfig.rearCogTeeth).toBe(17);
    expect(exploreGearRatio).toBeCloseTo(54 / 17, 8);
    expect(exploreRolloutConfig.rolloutMetersPerCrankRevolution).toBe(6.9);
    expect(exploreRolloutFeetPerCrankRevolution).toBeCloseTo(22.6, 1);
    expect(exploreRolloutConfig.targetCadenceRpm).toBe(90);
  });

  it('converts cadence and velocity through the Explore rollout', () => {
    const velocityMps = exploreVelocityMpsFromCadence(90);

    expect(velocityMps).toBeCloseTo(10.35, 8);
    expect(exploreSpeedKphFromCadence(90)).toBeCloseTo(37.26, 8);
    expect(exploreCadenceRpmFromVelocityMps(velocityMps)).toBeCloseTo(90, 8);
  });

  it('does not change BMX race gearing', () => {
    expect(bmxRolloutConfig).toEqual({
      wheelDiameterInches: 20,
      frontSprocketTeeth: 44,
      rearCogTeeth: 16,
    });
  });
});
