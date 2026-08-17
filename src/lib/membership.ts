import { safeSetLocalStorage } from './browserStorage';

export type MembershipTier = 'visitor' | 'spectator' | 'racer';

export type MembershipState = {
  tier: MembershipTier;
  bikeSeats: number;
  updatedAt: number;
};

export const membershipStorageKey = 'tracklab-bmx-membership-v1';
export const benchmarkDemoTrackId = 'north-bay-bmx-napa-valley';
export const bikeSeatMonthlyCents = 999;
export const maxBillingBikeSeats = 1000;
export const adminAccountEmail = 'preskiranch@gmail.com';

export function clampBillingBikeSeats(value: number) {
  return Math.max(1, Math.min(maxBillingBikeSeats, Math.round(value)));
}

export function normalizeAccountEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAdminAccountEmail(email: string) {
  return normalizeAccountEmail(email) === adminAccountEmail;
}

export function racerMonthlyCents(bikeSeats: number) {
  return clampBillingBikeSeats(bikeSeats) * bikeSeatMonthlyCents;
}

export function formatUsd(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function createMembership(tier: MembershipTier, bikeSeats = 1): MembershipState {
  return {
    tier,
    bikeSeats: clampBillingBikeSeats(bikeSeats),
    updatedAt: Date.now(),
  };
}

function readMembershipFromUrl() {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('billing') !== 'success' || params.get('tier') !== 'racer') {
    return null;
  }

  const bikeSeats = clampBillingBikeSeats(Number(params.get('bikes') ?? 1));
  const membership = createMembership('racer', bikeSeats);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('billing');
  cleanUrl.searchParams.delete('tier');
  cleanUrl.searchParams.delete('bikes');
  cleanUrl.searchParams.delete('checkoutId');
  window.history.replaceState(null, '', cleanUrl);
  return membership;
}

export function readStoredMembership(): MembershipState {
  const urlMembership = readMembershipFromUrl();
  if (urlMembership) {
    return urlMembership;
  }

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
