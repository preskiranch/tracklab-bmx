import { describe, expect, it } from 'vitest';
import { raceProgressPercent } from '../../src/components/RaceRiderOverlay';

describe('race progress percentage', () => {
  it('uses the selected sprint distance as 100 percent', () => {
    expect(raceProgressPercent(15.24, 30.48)).toBe(50);
    expect(raceProgressPercent(30.48, 30.48)).toBe(100);
    expect(raceProgressPercent(198.12, 396.24)).toBe(50);
    expect(raceProgressPercent(396.24, 396.24)).toBe(100);
  });

  it('clamps progress before the start and after the finish', () => {
    expect(raceProgressPercent(-1, 30.48)).toBe(0);
    expect(raceProgressPercent(31, 30.48)).toBe(100);
  });
});
