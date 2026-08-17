import { describe, expect, it } from 'vitest';
// The billing module is server-side JavaScript and intentionally has no TS surface.
// @ts-expect-error Server module under test.
import { racerMonthlyCents } from '../../cloud/squareBilling.mjs';

describe('Square Wattbike seat totals', () => {
  it('charges the same $9.99 rate for personal and club quantities', () => {
    expect(racerMonthlyCents(1)).toBe(999);
    expect(racerMonthlyCents(4)).toBe(3_996);
    expect(racerMonthlyCents(20)).toBe(19_980);
  });

  it('normalizes unsafe quantities at the server boundary', () => {
    expect(racerMonthlyCents(0)).toBe(999);
    expect(racerMonthlyCents(1_001)).toBe(999_000);
  });
});
