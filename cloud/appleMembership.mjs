import { publicBetaAccessStatus } from './betaAccess.mjs';

function clampSeats(value, maximum) {
  return Math.max(1, Math.min(maximum, Math.round(Number(value) || 1)));
}

/**
 * Computes only the Wattbike entitlement. Apple-managed accounts never fall
 * back to denormalized or legacy racer columns after their verified window
 * ends, and the final cutover disables legacy grants for ordinary accounts.
 */
export function wattbikeMembershipForAccount(user, {
  appleOnlyCutover = false,
  operator = false,
  maximumSeats = 4,
  now = Date.now(),
} = {}) {
  const safeMaximum = Math.max(1, Math.min(4, Math.round(Number(maximumSeats) || 4)));
  if (operator) return { tier: 'racer', bikeSeats: safeMaximum };

  // Beta access is independent of billing. Expiry/revocation is evaluated on
  // every projection, including cached sessions, without changing paid state.
  const beta = publicBetaAccessStatus(user?.betaAccess, now);
  const betaSeats = beta?.active ? clampSeats(beta.bikeSeats, safeMaximum) : 0;

  if (user?.appleBillingManaged === true) {
    const active = user.appleEntitlementActive === true && user.membershipTier === 'racer';
    return {
      tier: active || betaSeats > 0 ? 'racer' : 'spectator',
      bikeSeats: Math.max(active ? clampSeats(user.bikeSeats, safeMaximum) : 1, betaSeats),
    };
  }

  if (appleOnlyCutover) return {
    tier: betaSeats > 0 ? 'racer' : 'spectator',
    bikeSeats: Math.max(1, betaSeats),
  };

  const tier = user?.membershipTier === 'racer' ? 'racer' : 'spectator';
  return {
    tier: tier === 'racer' || betaSeats > 0 ? 'racer' : 'spectator',
    bikeSeats: Math.max(tier === 'racer' ? clampSeats(user?.bikeSeats, safeMaximum) : 1, betaSeats),
  };
}
