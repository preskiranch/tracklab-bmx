import { describe, expect, it } from 'vitest';
import {
  bmxCadenceRpmFromVelocityMps,
  bmxGearInches,
  bmxGearRatio,
  bmxRolloutInchesPerCrankRevolution,
  bmxRolloutMetersPerCrankRevolution,
  bmxDemoMaximumCadenceRpm,
  bmxDemoMaximumSpeedMph,
  bmxSpeedKphFromCadence,
  realisticDemoCadenceRpm,
  reportedBmxTopSpeedKph,
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
    expect(bmxSpeedKphFromCadence(200)).toBeCloseTo(52.6657, 4);
    expect(bmxSpeedKphFromCadence(200.01)).toBe(0);
    expect(bmxSpeedKphFromCadence(923_334)).toBe(0);
  });

  it('converts a target velocity back to the cadence required by the same rollout', () => {
    const cadence = bmxCadenceRpmFromVelocityMps(15 * 0.44704);

    expect(cadence).toBeCloseTo(91.67, 1);
    expect(bmxSpeedKphFromCadence(cadence) / 1.609344).toBeCloseTo(15, 5);
  });

  it('compresses impossible demo peaks into a realistic 44/16 sprint range', () => {
    const cadenceFrom263 = realisticDemoCadenceRpm(263);
    const cadenceFrom255 = realisticDemoCadenceRpm(255);
    const speedFrom263Mph = bmxSpeedKphFromCadence(cadenceFrom263) / 1.609344;
    const speedFrom255Mph = bmxSpeedKphFromCadence(cadenceFrom255) / 1.609344;

    expect(cadenceFrom263).toBeCloseTo(172.6, 6);
    expect(cadenceFrom255).toBeCloseTo(171, 6);
    expect(speedFrom263Mph).toBeCloseTo(28.24, 2);
    expect(speedFrom255Mph).toBeCloseTo(27.98, 2);
    expect(speedFrom263Mph).toBeGreaterThan(speedFrom255Mph);
    expect(bmxDemoMaximumCadenceRpm).toBeCloseTo(183.32, 1);
    expect(bmxDemoMaximumSpeedMph).toBe(30);
  });

  it('reports cadence rollout as the minimum peak speed without changing course average speed', () => {
    expect(reportedBmxTopSpeedKph(171, 44.8)).toBeCloseTo(bmxSpeedKphFromCadence(171), 6);
    expect(reportedBmxTopSpeedKph(120, 50)).toBe(50);
    expect(reportedBmxTopSpeedKph(923_334, 48.24)).toBe(48.24);
    expect(reportedBmxTopSpeedKph(120, 151_080.1)).toBeCloseTo(bmxSpeedKphFromCadence(120), 6);
    expect(reportedBmxTopSpeedKph(200, 83)).toBe(83);
  });
});
