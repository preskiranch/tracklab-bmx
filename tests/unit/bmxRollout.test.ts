import { describe, expect, it } from 'vitest';
import {
  bmxCadenceRpmFromVelocityMps,
  bmxGearInches,
  bmxGearRatio,
  bmxRolloutInchesPerCrankRevolution,
  bmxRolloutMetersPerCrankRevolution,
  bmxSpeedKphFromCadence,
} from '../../src/game/bmxRollout';

describe('44/16 BMX rollout', () => {
  it('uses the expected gear inches and rollout per crank revolution', () => {
    expect(bmxGearRatio).toBe(2.75);
    expect(bmxGearInches).toBe(55);
    expect(bmxRolloutInchesPerCrankRevolution).toBeCloseTo(172.7876, 4);
    expect(bmxRolloutMetersPerCrankRevolution).toBeCloseTo(4.3888, 4);
  });

  it('converts cadence into deterministic road speed', () => {
    expect(bmxSpeedKphFromCadence(0)).toBe(0);
    expect(bmxSpeedKphFromCadence(100)).toBeCloseTo(26.3328, 4);
  });

  it('converts a target velocity back to the cadence required by the same rollout', () => {
    const cadence = bmxCadenceRpmFromVelocityMps(15 * 0.44704);

    expect(cadence).toBeCloseTo(91.67, 1);
    expect(bmxSpeedKphFromCadence(cadence) / 1.609344).toBeCloseTo(15, 5);
  });
});
