import type { MembershipState, MembershipTier } from './membership';

export type AuthUser = {
  id: string;
  profileKey: string;
  email: string;
  name: string;
  admin: boolean;
  membership: MembershipState;
};

export type AuthMode = 'register' | 'login';

type AuthResponse = {
  user: AuthUser | null;
  error?: string;
};

function normalizeMembership(value: Partial<MembershipState> | null | undefined): MembershipState {
  const tier: MembershipTier = value?.tier === 'racer' || value?.tier === 'spectator'
    ? value.tier
    : 'visitor';
  return {
    tier,
    bikeSeats: Math.max(1, Math.min(4, Math.round(Number(value?.bikeSeats ?? 1)))),
    updatedAt: Number.isFinite(value?.updatedAt) ? Number(value?.updatedAt) : Date.now(),
  };
}

function normalizeAuthUser(value: Partial<AuthUser> | null | undefined): AuthUser | null {
  if (!value?.id || !value.email || !value.name || !value.profileKey) {
    return null;
  }

  return {
    id: String(value.id),
    profileKey: String(value.profileKey),
    email: String(value.email),
    name: String(value.name),
    admin: Boolean(value.admin),
    membership: normalizeMembership(value.membership),
  };
}

async function authFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? `Authentication returned ${response.status}`);
  }

  return normalizeAuthUser(payload.user);
}

export async function readCurrentAuthUser() {
  return authFetch('/api/auth/me');
}

export async function registerAuthUser(name: string, email: string, password: string) {
  return authFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginAuthUser(email: string, password: string) {
  return authFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutAuthUser() {
  await authFetch('/api/auth/logout', { method: 'POST' });
}

export async function claimBillingReturn(bikeSeats: number) {
  return authFetch('/api/auth/billing-return', {
    method: 'POST',
    body: JSON.stringify({ bikeSeats }),
  });
}
