import type { AccountProfile } from '../types';
import type { AuthUser } from './auth';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';
import { normalizePersonalRecords } from './personalRecords';
import { trackLabPublicOrigin } from './serviceOrigins';

export type ClubConnectMember = {
  studioRiderId: string;
  riderName: string;
  athleteName: string | null;
  status: 'claimed' | 'unclaimed';
  claimedAt: number | null;
};

export type OwnedClub = {
  id: string;
  name: string;
  members: ClubConnectMember[];
};

export type ClubAthleteMembership = {
  clubId: string;
  clubName: string;
  studioRiderId: string;
  riderName: string;
  claimedAt: number | null;
};

export type ClubConnectState = {
  canManageClub: boolean;
  ownedClub: OwnedClub | null;
  memberships: ClubAthleteMembership[];
};

export type ClubInvite = {
  token: string;
  expiresAt: number;
  clubName: string;
  riderName: string;
};

export type ClubClaimProfile = {
  fullName: string;
  nickname: string;
  photoUrl?: string;
};

export type ClubClaimResult = ClubConnectState & {
  user: AuthUser;
  accountProfile: AccountProfile;
};

const emptyClubConnectState: ClubConnectState = {
  canManageClub: false,
  ownedClub: null,
  memberships: [],
};

export function clubConnectRequestIsCurrent(
  requestedProfileKey: string,
  requestedGeneration: number,
  activeProfileKey: string | null,
  activeGeneration: number,
) {
  return requestedProfileKey === activeProfileKey
    && requestedGeneration === activeGeneration;
}

async function clubFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Club Connect returned ${response.status}`);
  return payload;
}

function normalizeState(value: unknown): ClubConnectState {
  if (!value || typeof value !== 'object') return emptyClubConnectState;
  const candidate = value as Partial<ClubConnectState>;
  return {
    canManageClub: candidate.canManageClub === true,
    ownedClub: candidate.ownedClub && typeof candidate.ownedClub === 'object'
      ? candidate.ownedClub as OwnedClub
      : null,
    memberships: Array.isArray(candidate.memberships) ? candidate.memberships : [],
  };
}

export async function loadClubConnect() {
  return normalizeState(await clubFetch('/api/club-connect'));
}

export async function createClubInvite(studioRiderId: string) {
  return clubFetch('/api/club-connect/invites', {
    method: 'POST',
    body: JSON.stringify({ studioRiderId }),
  }) as Promise<ClubInvite>;
}

export async function claimClubInvite(token: string, profile: ClubClaimProfile) {
  const payload = await clubFetch('/api/club-connect/claim', {
    method: 'POST',
    body: JSON.stringify({
      token,
      fullName: profile.fullName,
      nickname: profile.nickname,
      photoUrl: profile.photoUrl ?? null,
    }),
  }) as Partial<ClubClaimResult>;
  const state = normalizeState(payload);
  if (!payload.user || !payload.accountProfile) {
    throw new Error('TrackLab connected the invitation but could not finish the athlete profile. Refresh and try again.');
  }
  const photoUrl = normalizeRiderPhotoDataUrl(payload.accountProfile.photoUrl);
  const personalRecords = normalizePersonalRecords(payload.accountProfile.personalRecords);
  return {
    ...state,
    user: payload.user,
    accountProfile: {
      ...(photoUrl ? { photoUrl } : {}),
      ...(personalRecords ? { personalRecords } : {}),
      updatedAt: Math.max(0, Number(payload.accountProfile.updatedAt) || 0),
    },
  } as ClubClaimResult;
}

export async function revokeClubMember(studioRiderId: string) {
  return normalizeState(await clubFetch('/api/club-connect/revoke', {
    method: 'POST',
    body: JSON.stringify({ studioRiderId }),
  }));
}

export function clubInviteTokenFromUrl() {
  if (typeof window === 'undefined') return '';
  const queryToken = new URLSearchParams(window.location.search).get('clubInvite')?.trim();
  const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('clubInvite')?.trim();
  return queryToken || hashToken || '';
}

export function clearClubInviteFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('clubInvite');
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  hashParams.delete('clubInvite');
  url.hash = hashParams.toString();
  window.history.replaceState(null, '', url);
}

export function clubInviteUrl(token: string) {
  const url = new URL(trackLabPublicOrigin);
  url.hash = new URLSearchParams({ clubInvite: token }).toString();
  return url.toString();
}
