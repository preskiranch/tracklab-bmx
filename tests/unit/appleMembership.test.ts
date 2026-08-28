import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Server module under test.
import { wattbikeMembershipForAccount } from '../../cloud/appleMembership.mjs';

describe('Apple-only Wattbike membership cutover', () => {
  it('refuses to start the final cutover while Apple verification is disabled', () => {
    const result = spawnSync(process.execPath, ['cloud/server.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        PORT: '0',
        TRACKLAB_APPLE_IAP_ENABLED: '0',
        TRACKLAB_APPLE_ONLY_CUTOVER: '1',
      },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'TRACKLAB_APPLE_ONLY_CUTOVER requires a complete, enabled Apple IAP configuration.',
    );
  });

  it('honors legacy racer access only before the final cutover', () => {
    const legacyRacer = { membershipTier: 'racer', bikeSeats: 4, appleBillingManaged: false };
    expect(wattbikeMembershipForAccount(legacyRacer)).toEqual({ tier: 'racer', bikeSeats: 4 });
    expect(wattbikeMembershipForAccount(legacyRacer, { appleOnlyCutover: true })).toEqual({
      tier: 'spectator',
      bikeSeats: 1,
    });
  });

  it('requires a current verified entitlement for every Apple-managed account', () => {
    const storedRacer = { membershipTier: 'racer', bikeSeats: 4, appleBillingManaged: true };
    expect(wattbikeMembershipForAccount(storedRacer)).toEqual({ tier: 'spectator', bikeSeats: 1 });
    expect(wattbikeMembershipForAccount({
      ...storedRacer,
      appleEntitlementActive: true,
    })).toEqual({ tier: 'racer', bikeSeats: 4 });
  });

  it('never grants more than four simultaneous Wattbike connections', () => {
    expect(wattbikeMembershipForAccount({
      membershipTier: 'racer',
      bikeSeats: 999,
      appleBillingManaged: true,
      appleEntitlementActive: true,
    })).toEqual({ tier: 'racer', bikeSeats: 4 });
  });

  it('keeps the explicit Preski Ranch operator override separate from customer plans', () => {
    expect(wattbikeMembershipForAccount(null, { operator: true })).toEqual({
      tier: 'racer',
      bikeSeats: 4,
    });
  });
});
