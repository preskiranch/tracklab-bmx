import { describe, expect, it } from 'vitest';
import {
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
});
