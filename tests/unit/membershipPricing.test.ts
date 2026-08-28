import { describe, expect, it } from 'vitest';
import {
  clampAppleWattbikeConnections,
  clampBillingBikeSeats,
  maxAppleWattbikeConnections,
  maxBillingBikeSeats,
} from '../../src/lib/membership';

describe('Wattbike membership connection limits', () => {
  it('offers fixed one-through-four App Store connection tiers', () => {
    expect(maxAppleWattbikeConnections).toBe(4);
    expect(clampAppleWattbikeConnections(0)).toBe(1);
    expect(clampAppleWattbikeConnections(3)).toBe(3);
    expect(clampAppleWattbikeConnections(99)).toBe(4);
  });

  it('never projects more capacity than the four App Store tiers', () => {
    expect(maxBillingBikeSeats).toBe(4);
    expect(clampBillingBikeSeats(20)).toBe(4);
    expect(clampBillingBikeSeats(maxBillingBikeSeats + 1)).toBe(maxBillingBikeSeats);
    expect(clampBillingBikeSeats(0)).toBe(1);
  });
});
