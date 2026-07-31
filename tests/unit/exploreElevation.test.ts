import { describe, expect, it } from 'vitest';
import {
  exploreElevationAtMeter,
  exploreGradeAtMeter,
  exploreSlopeDirection,
  formatExploreElevation,
  formatExploreGrade,
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
});
