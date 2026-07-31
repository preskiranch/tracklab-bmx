import { describe, expect, it } from 'vitest';
import {
  exploreElevationAtMeter,
  exploreGradeAtMeter,
  exploreSlopeDirection,
  formatExploreElevation,
  formatExploreGrade,
  recommendedExploreAirSetting,
  stabilizeExploreAirSetting,
} from '../../src/lib/exploreElevation';

const samples = [
  { distanceMeters: 0, elevationMeters: 100 },
  { distanceMeters: 100, elevationMeters: 108 },
  { distanceMeters: 200, elevationMeters: 104 },
];

describe('Explore elevation display', () => {
  it('interpolates elevation and grade at the rider position', () => {
    expect(exploreElevationAtMeter(samples, 50)).toBeCloseTo(104, 8);
    expect(exploreElevationAtMeter(samples, 250)).toBe(104);
    expect(exploreGradeAtMeter(samples, 50)).toBeCloseTo(8, 8);
    expect(exploreGradeAtMeter(samples, 150)).toBeCloseTo(-4, 8);
  });

  it('labels climbs, descents, and level ground with readable units', () => {
    expect(exploreSlopeDirection(1.2)).toBe('climb');
    expect(exploreSlopeDirection(-1.2)).toBe('descent');
    expect(exploreSlopeDirection(0.4)).toBe('level');
    expect(formatExploreElevation(100, 'mi')).toBe('328 ft');
    expect(formatExploreElevation(100, 'km')).toBe('100 m');
    expect(formatExploreGrade(3.25)).toBe('+3.3%');
    expect(formatExploreGrade(-2)).toBe('-2.0%');
  });

  it('uses level Market Street and steep Bradford Street as the manual air-setting anchors', () => {
    expect(recommendedExploreAirSetting(-12)).toBe(1);
    expect(recommendedExploreAirSetting(0)).toBe(1);
    expect(recommendedExploreAirSetting(0.9)).toBe(1);
    expect(recommendedExploreAirSetting(1)).toBe(2);
    expect(recommendedExploreAirSetting(4)).toBe(3);
    expect(recommendedExploreAirSetting(8.5)).toBe(5);
    expect(recommendedExploreAirSetting(12)).toBe(7);
    expect(recommendedExploreAirSetting(15)).toBe(9);
    expect(recommendedExploreAirSetting(20)).toBe(10);
    expect(recommendedExploreAirSetting(24)).toBe(10);
  });

  it('uses a grade buffer so the recommendation does not flicker at a threshold', () => {
    expect(stabilizeExploreAirSetting(1, 1.1)).toBe(1);
    expect(stabilizeExploreAirSetting(1, 1.3)).toBe(2);
    expect(stabilizeExploreAirSetting(2, 0.9)).toBe(2);
    expect(stabilizeExploreAirSetting(2, 0.69)).toBe(1);
    expect(stabilizeExploreAirSetting(1, 24)).toBe(10);
  });
});
