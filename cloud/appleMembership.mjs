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
} = {}) {
  const safeMaximum = Math.max(1, Math.min(4, Math.round(Number(maximumSeats) || 4)));
  if (operator) return { tier: 'racer', bikeSeats: safeMaximum };

  if (user?.appleBillingManaged === true) {
    const active = user.appleEntitlementActive === true && user.membershipTier === 'racer';
    return {
      tier: active ? 'racer' : 'spectator',
      bikeSeats: active ? clampSeats(user.bikeSeats, safeMaximum) : 1,
    };
  }

  if (appleOnlyCutover) return { tier: 'spectator', bikeSeats: 1 };

  const tier = user?.membershipTier === 'racer' ? 'racer' : 'spectator';
  return {
    tier,
    bikeSeats: tier === 'racer' ? clampSeats(user?.bikeSeats, safeMaximum) : 1,
  };
}
