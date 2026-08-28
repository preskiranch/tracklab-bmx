import { clampBillingBikeSeats, type MembershipState, type MembershipTier } from './membership';
import { clearNativeAuthToken, saveNativeAuthToken } from './nativeAuthSession';

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
  nativeSessionToken?: string;
  error?: string;
};

type DeleteAccountResponse = {
  deleted?: boolean;
  error?: string;
};

function normalizeMembership(value: Partial<MembershipState> | null | undefined): MembershipState {
  const tier: MembershipTier = value?.tier === 'racer' || value?.tier === 'spectator'
    ? value.tier
    : 'visitor';
  return {
    tier,
    bikeSeats: clampBillingBikeSeats(Number(value?.bikeSeats ?? 1)),
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
    if (payload.error) {
      throw new Error(payload.error);
    }

    if (response.status === 404) {
      throw new Error(
        'TrackLab could not find the auth service or this account. Refresh the page, then use "Create one free" if this is your first login.',
      );
    }

    throw new Error(`Authentication returned ${response.status}. Refresh the page and try again.`);
  }

  if (payload.nativeSessionToken) {
    await saveNativeAuthToken(payload.nativeSessionToken);
  }
  const user = normalizeAuthUser(payload.user);
  if (path === '/api/auth/me' && !user) await clearNativeAuthToken();
  return user;
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
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    await clearNativeAuthToken();
  }
}

/**
 * Permanently deletes the currently authenticated TrackLab account.
 *
 * The server reauthenticates with the current password and independently
 * requires the literal confirmation value. Keeping both values in the JSON
 * contract makes an accidental one-click deletion impossible.
 */
export async function deleteAuthAccount(password: string, confirmation: 'DELETE') {
  const response = await fetch('/api/auth/account', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password, confirmation }),
  });
  const payload = await response.json().catch(() => ({})) as DeleteAccountResponse;
  if (!response.ok) {
    throw new Error(payload.error || `Account deletion returned ${response.status}. Try again.`);
  }
  if (payload.deleted !== true) {
    throw new Error('TrackLab could not confirm that the account was deleted. Try again.');
  }
  await clearNativeAuthToken();
}
