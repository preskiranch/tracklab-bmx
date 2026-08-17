import { describe, expect, it } from 'vitest';
import {
  bikeSeatMonthlyCents,
  clampBillingBikeSeats,
  maxBillingBikeSeats,
  racerMonthlyCents,
} from '../../src/lib/membership';

describe('Wattbike seat billing', () => {
  it('prices every personal or club seat at $9.99 per month', () => {
    expect(bikeSeatMonthlyCents).toBe(999);
    expect(racerMonthlyCents(1)).toBe(999);
    expect(racerMonthlyCents(4)).toBe(3_996);
    expect(racerMonthlyCents(20)).toBe(19_980);
  });

  it('supports large clubs without using the four-racer event limit as a billing cap', () => {
    expect(maxBillingBikeSeats).toBeGreaterThanOrEqual(20);
    expect(clampBillingBikeSeats(20)).toBe(20);
    expect(clampBillingBikeSeats(maxBillingBikeSeats + 1)).toBe(maxBillingBikeSeats);
    expect(clampBillingBikeSeats(0)).toBe(1);
  });
});
