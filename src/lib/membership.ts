import { safeSetLocalStorage } from './browserStorage';

export type MembershipTier = 'visitor' | 'spectator' | 'racer';

export type MembershipState = {
  tier: MembershipTier;
  bikeSeats: number;
  updatedAt: number;
};

export const membershipStorageKey = 'tracklab-bmx-membership-v1';
export const benchmarkDemoTrackId = 'north-bay-bmx-napa-valley';
export const maxAppleWattbikeConnections = 4;
// Wattbike access is sold only in the four App Store connection tiers. Keep
// every client-side projection inside that same one-through-four boundary.
export const maxBillingBikeSeats = maxAppleWattbikeConnections;
export const adminAccountEmail = 'preskiranch@gmail.com';

export function clampBillingBikeSeats(value: number) {
  return Math.max(1, Math.min(maxBillingBikeSeats, Math.round(value)));
}

export function clampAppleWattbikeConnections(value: number) {
  return Math.max(1, Math.min(maxAppleWattbikeConnections, Math.round(value)));
}

export function normalizeAccountEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAdminAccountEmail(email: string) {
  return normalizeAccountEmail(email) === adminAccountEmail;
}

export function createMembership(tier: MembershipTier, bikeSeats = 1): MembershipState {
  return {
    tier,
    bikeSeats: clampBillingBikeSeats(bikeSeats),
    updatedAt: Date.now(),
  };
}

export function readStoredMembership(): MembershipState {
  if (typeof window === 'undefined') {
    return createMembership('visitor');
  }

  try {
    const stored = window.localStorage.getItem(membershipStorageKey);
    if (!stored) {
      return createMembership('visitor');
    }

    const parsed = JSON.parse(stored) as Partial<MembershipState>;
    const tier: MembershipTier = parsed.tier === 'spectator' || parsed.tier === 'racer'
      ? parsed.tier
      : 'visitor';
    return {
      tier,
      bikeSeats: clampBillingBikeSeats(Number(parsed.bikeSeats ?? 1)),
      updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : Date.now(),
    };
  } catch {
    return createMembership('visitor');
  }
}

export function writeStoredMembership(membership: MembershipState) {
  if (typeof window === 'undefined') {
    return;
  }

  safeSetLocalStorage(membershipStorageKey, JSON.stringify({
    ...membership,
    bikeSeats: clampBillingBikeSeats(membership.bikeSeats),
  }));
}
