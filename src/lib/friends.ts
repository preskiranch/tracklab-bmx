import { safeSetLocalStorage } from './browserStorage';
import { subscribeToAuthenticatedEventStream } from './authenticatedEventStream';

export type FriendOfficialKind = 'club' | 'founder';
export type FriendRelationship = 'none' | 'friend' | 'incoming-request' | 'outgoing-request' | 'blocked' | 'self';

export type FriendGhostPreview = {
  id: string;
  trackId: string;
  trackName: string;
  routeVariantId?: 'amateur' | 'pro';
  lapCount: number;
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
  finishTimeMs: number;
};

export type FriendProfile = {
  id: string;
  handle: string;
  displayName: string;
  photoUrl?: string;
  clubName?: string;
  locationLabel?: string;
  online: boolean;
  available: boolean;
  hasGhost: boolean;
  ghostPreview?: FriendGhostPreview;
  mutualFriendCount: number;
  relationship: FriendRelationship;
  officialKind?: FriendOfficialKind;
  canShareTrack?: boolean;
  canTalkLive?: boolean;
};

export type FriendRequestDirection = 'incoming' | 'outgoing';

export type FriendRequest = {
  id: string;
  direction: FriendRequestDirection;
  profile: FriendProfile;
  createdAt: string;
};

export type FriendSuggestion = {
  profile: FriendProfile;
  reason: string;
};

export type FriendPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  onlineTotal?: number;
};

export type FriendRequestPage = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  incomingTotal: number;
  outgoingTotal: number;
  incomingNextCursor: string | null;
  outgoingNextCursor: string | null;
  total: number;
};

export type FriendInvite = {
  id: string;
  inviteUrl: string;
  qrCodeUrl: string;
  expiresAt: string | null;
};

export type FriendInviteMetadata = {
  id: string;
  createdAt: string;
  expiresAt: string;
};

export type FriendPrivacy = {
  discoverable: boolean;
  profile: Pick<FriendProfile, 'id' | 'handle' | 'displayName'> | null;
};

export type FriendListQuery = {
  query?: string;
  cursor?: string | null;
  limit?: number;
};

export type FriendRequestQuery = FriendListQuery & {
  direction?: FriendRequestDirection | 'all';
};

export type QueuedFriendRequest = {
  ownerProfileId: string;
  targetProfileId: string;
  clientRequestId: string;
  queuedAt: number;
};

export type FriendsApi = {
  listFriends: (query?: FriendListQuery) => Promise<FriendPage<FriendProfile>>;
  listRequests: (query?: FriendRequestQuery) => Promise<FriendRequestPage>;
  listSuggestions: (query?: FriendListQuery) => Promise<FriendPage<FriendSuggestion>>;
  listBlocked: (query?: FriendListQuery) => Promise<FriendPage<FriendProfile>>;
  listActiveInvites: () => Promise<FriendInviteMetadata[]>;
  getInvite: () => Promise<FriendInvite>;
  revokeInvite: (inviteId: string) => Promise<void>;
  revokeAllInvites: () => Promise<number>;
  getPrivacy: () => Promise<FriendPrivacy>;
  updatePrivacy: (discoverable: boolean) => Promise<FriendPrivacy>;
  claimInvite: (token: string) => Promise<void>;
  sendFriendRequest: (targetProfileId: string, clientRequestId?: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  declineFriendRequest: (requestId: string) => Promise<void>;
  cancelFriendRequest: (requestId: string) => Promise<void>;
  unfriend: (profileId: string) => Promise<void>;
  blockProfile: (profileId: string) => Promise<void>;
  unblockProfile: (profileId: string) => Promise<void>;
  reportProfile: (profileId: string, reason: FriendReportReason) => Promise<void>;
};

export type FriendReportReason = 'spam' | 'harassment' | 'unsafe-behavior' | 'impersonation' | 'other';

const queuedFriendRequestsStorageKey = 'tracklab-bmx-queued-friend-requests-v1';
const defaultPageSize = 20;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanId(value: unknown) {
  return cleanText(value, 180);
}

function cleanWebUrl(value: unknown) {
  const candidate = cleanText(value, 2_048);
  if (!candidate) return '';
  try {
    const url = new URL(candidate, typeof window === 'undefined' ? 'https://tracklab.invalid' : window.location.origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return candidate;
  } catch {
    return '';
  }
}

function cleanImageUrl(value: unknown) {
  const candidate = cleanText(value, 2_000_000);
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-zA-Z0-9+/=]+$/.test(candidate)) return candidate;
  return cleanWebUrl(candidate);
}

function cleanHandle(value: unknown) {
  return cleanText(value, 40).replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function safeCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function officialKind(value: unknown): FriendOfficialKind | undefined {
  return value === 'club' || value === 'founder' ? value : undefined;
}

function relationship(value: unknown): FriendRelationship {
  return value === 'friend'
    || value === 'incoming-request'
    || value === 'outgoing-request'
    || value === 'blocked'
    || value === 'self'
    ? value
    : 'none';
}

export function normalizeFriendGhostPreview(value: unknown): FriendGhostPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const trackId = cleanText(raw.trackId, 140);
  const trackName = cleanText(raw.trackName, 140);
  const lapCount = Math.max(1, Math.min(20, Math.round(Number(raw.lapCount) || 1)));
  const finishTimeMs = Math.round(Number(raw.finishTimeMs));
  const routeVariantId = raw.routeVariantId === 'amateur' || raw.routeVariantId === 'pro'
    ? raw.routeVariantId
    : undefined;
  const sprintDistanceFeet = Math.round(Number(raw.sprintDistanceFeet));
  const sprintAirSetting = Math.round(Number(raw.sprintAirSetting));
  const hasSprintConfiguration = (
    (sprintDistanceFeet === 30
      || sprintDistanceFeet === 145
      || (sprintDistanceFeet >= 100 && sprintDistanceFeet <= 1_500 && sprintDistanceFeet % 100 === 0))
    && sprintAirSetting >= 1
    && sprintAirSetting <= 10
  );
  if (!id || !trackId || !trackName || !Number.isFinite(finishTimeMs) || finishTimeMs <= 0) return null;

  return {
    id,
    trackId,
    trackName,
    ...(routeVariantId ? { routeVariantId } : {}),
    lapCount,
    ...(hasSprintConfiguration ? { sprintDistanceFeet, sprintAirSetting } : {}),
    finishTimeMs,
  };
}

export function normalizeFriendProfile(value: unknown): FriendProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id ?? raw.profileId);
  const handle = cleanHandle(raw.handle ?? raw.username);
  const displayName = cleanText(raw.displayName, 80);
  if (!id || !handle || !displayName) return null;

  const photoUrl = cleanImageUrl(raw.photoUrl);
  const clubName = cleanText(raw.clubName, 100);
  const locationLabel = cleanText(raw.locationLabel, 100);
  const ghostPreview = normalizeFriendGhostPreview(raw.ghostPreview);
  return {
    id,
    handle,
    displayName,
    ...(photoUrl ? { photoUrl } : {}),
    ...(clubName ? { clubName } : {}),
    ...(locationLabel ? { locationLabel } : {}),
    online: Boolean(raw.online),
    available: Boolean(raw.available),
    hasGhost: Boolean(ghostPreview),
    ...(ghostPreview ? { ghostPreview } : {}),
    mutualFriendCount: safeCount(raw.mutualFriendCount),
    relationship: relationship(raw.relationship),
    ...(officialKind(raw.officialKind ?? raw.officialType) ? { officialKind: officialKind(raw.officialKind ?? raw.officialType) } : {}),
    ...(raw.canShareTrack === true ? { canShareTrack: true } : {}),
    ...(raw.canTalkLive === true ? { canTalkLive: true } : {}),
  };
}

export function normalizeFriendRequest(value: unknown, fallbackDirection?: FriendRequestDirection): FriendRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id ?? raw.requestId);
  const direction = raw.direction === 'incoming' || raw.direction === 'outgoing' ? raw.direction : fallbackDirection ?? null;
  const profile = normalizeFriendProfile(raw.profile ?? raw);
  if (!id || !direction || !profile) return null;
  return {
    id,
    direction,
    profile: { ...profile, relationship: direction === 'incoming' ? 'incoming-request' : 'outgoing-request' },
    createdAt: cleanText(raw.createdAt, 40),
  };
}

export function normalizeFriendSuggestion(value: unknown): FriendSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const profile = normalizeFriendProfile(raw.profile ?? raw);
  if (!profile) return null;
  return {
    profile,
    reason: cleanText(raw.reason, 160),
  };
}

function normalizePage<T>(value: unknown, normalizeItem: (item: unknown) => T | null): FriendPage<T> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter((item): item is T => item != null)
    : [];
  const nextCursor = cleanText(raw.nextCursor, 400) || null;
  const total = Math.max(items.length, safeCount(raw.total));
  return {
    items,
    nextCursor,
    total,
    onlineTotal: Math.min(total, safeCount(raw.onlineTotal)),
  };
}

export function normalizeFriendPage(value: unknown) {
  return normalizePage(value, normalizeFriendProfile);
}

export function normalizeFriendSuggestionPage(value: unknown) {
  return normalizePage(value, normalizeFriendSuggestion);
}

export function normalizeFriendRequestPage(value: unknown): FriendRequestPage {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const incoming = Array.isArray(raw.incoming)
    ? raw.incoming.map((item) => normalizeFriendRequest(item)).filter((item): item is FriendRequest => item != null)
    : [];
  const outgoing = Array.isArray(raw.outgoing)
    ? raw.outgoing.map((item) => normalizeFriendRequest(item)).filter((item): item is FriendRequest => item != null)
    : [];
  return {
    incoming,
    outgoing,
    incomingTotal: Math.max(incoming.length, safeCount(raw.incomingTotal)),
    outgoingTotal: Math.max(outgoing.length, safeCount(raw.outgoingTotal)),
    incomingNextCursor: cleanText(raw.incomingNextCursor, 400) || null,
    outgoingNextCursor: cleanText(raw.outgoingNextCursor, 400) || null,
    total: Math.max(incoming.length + outgoing.length, safeCount(raw.total)),
  };
}

function normalizeDirectionalRequestPage(value: unknown, direction: FriendRequestDirection) {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeFriendRequest(item, direction)).filter((item): item is FriendRequest => item != null)
    : [];
  return {
    items,
    nextCursor: cleanText(raw.nextCursor, 400) || null,
    total: Math.max(items.length, safeCount(raw.total)),
  };
}

function normalizeInvite(value: unknown): FriendInvite {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = cleanId(raw.inviteId ?? raw.id);
  const inviteUrl = cleanWebUrl(raw.inviteUrl);
  const qrCodeUrl = cleanImageUrl(raw.qrCodeUrl);
  if (!id || !inviteUrl || !qrCodeUrl) throw new Error('TrackLab could not prepare your invitation.');
  return {
    id,
    inviteUrl,
    qrCodeUrl,
    expiresAt: cleanText(raw.expiresAt, 40) || null,
  };
}

export function normalizeFriendInviteMetadataList(value: unknown): FriendInviteMetadata[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return (Array.isArray(raw.invites) ? raw.invites : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const invite = entry as Record<string, unknown>;
    const id = cleanId(invite.id);
    const createdAt = cleanText(invite.createdAt, 40);
    const expiresAt = cleanText(invite.expiresAt, 40);
    if (
      !id
      || !Number.isFinite(Date.parse(createdAt))
      || !Number.isFinite(Date.parse(expiresAt))
    ) {
      return [];
    }
    return [{ id, createdAt, expiresAt }];
  });
}

export function normalizeFriendPrivacy(value: unknown): FriendPrivacy {
  const rawEnvelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const raw = rawEnvelope.privacy && typeof rawEnvelope.privacy === 'object' && !Array.isArray(rawEnvelope.privacy)
    ? rawEnvelope.privacy as Record<string, unknown>
    : rawEnvelope;
  const profileValue = raw.profile ?? rawEnvelope.profile;
  const rawProfile = profileValue && typeof profileValue === 'object' && !Array.isArray(profileValue)
    ? profileValue as Record<string, unknown>
    : raw;
  const id = cleanId(rawProfile.id ?? rawProfile.profileId);
  const handle = cleanHandle(rawProfile.handle ?? rawProfile.username);
  const displayName = cleanText(rawProfile.displayName, 80);
  return {
    discoverable: raw.discoverable === true,
    profile: id && handle && displayName ? { id, handle, displayName } : null,
  };
}

function queryString(query: FriendListQuery = {}) {
  const params = new URLSearchParams();
  const search = cleanText(query.query, 80);
  const cursor = cleanText(query.cursor, 400);
  if (search) params.set('q', search);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(Math.min(50, Math.max(1, Math.round(query.limit ?? defaultPageSize)))));
  return params.toString();
}

export class FriendsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FriendsApiError';
    this.status = status;
  }
}

async function friendFetch(fetcher: typeof fetch, path: string, options: RequestInit = {}) {
  const response = await fetcher(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = cleanText(payload.error, 240);
    throw new FriendsApiError(message || `TrackLab friends returned ${response.status}.`, response.status);
  }
  return payload;
}

export function createFriendsApi(fetcher: typeof fetch = fetch): FriendsApi {
  return {
    async listFriends(query) {
      const page = normalizeFriendPage(await friendFetch(fetcher, `/api/friends?${queryString(query)}`));
      return { ...page, items: page.items.map((profile) => ({ ...profile, relationship: 'friend' as const })) };
    },
    async listRequests(query) {
      const loadDirection = async (direction: FriendRequestDirection) => {
        const params = new URLSearchParams(queryString(query));
        params.set('direction', direction);
        return normalizeDirectionalRequestPage(
          await friendFetch(fetcher, `/api/friends/requests?${params.toString()}`),
          direction,
        );
      };
      if (query?.direction === 'incoming' || query?.direction === 'outgoing') {
        const page = await loadDirection(query.direction);
        return {
          incoming: query.direction === 'incoming' ? page.items : [],
          outgoing: query.direction === 'outgoing' ? page.items : [],
          incomingTotal: query.direction === 'incoming' ? page.total : 0,
          outgoingTotal: query.direction === 'outgoing' ? page.total : 0,
          incomingNextCursor: query.direction === 'incoming' ? page.nextCursor : null,
          outgoingNextCursor: query.direction === 'outgoing' ? page.nextCursor : null,
          total: page.total,
        };
      }
      const [incoming, outgoing] = await Promise.all([loadDirection('incoming'), loadDirection('outgoing')]);
      return {
        incoming: incoming.items,
        outgoing: outgoing.items,
        incomingTotal: incoming.total,
        outgoingTotal: outgoing.total,
        incomingNextCursor: incoming.nextCursor,
        outgoingNextCursor: outgoing.nextCursor,
        total: incoming.total + outgoing.total,
      };
    },
    async listSuggestions(query) {
      if (query?.query?.trim()) {
        const profiles = normalizeFriendPage(await friendFetch(fetcher, `/api/friends/search?${queryString(query)}`));
        return {
          ...profiles,
          items: profiles.items.map((profile) => ({ profile, reason: 'Search result' })),
        };
      }
      return normalizeFriendSuggestionPage(await friendFetch(fetcher, `/api/friends/suggestions?${queryString(query)}`));
    },
    async listBlocked(query) {
      const page = normalizeFriendPage(await friendFetch(fetcher, `/api/friends/blocks?${queryString(query)}`));
      return { ...page, items: page.items.map((profile) => ({ ...profile, relationship: 'blocked' as const })) };
    },
    async listActiveInvites() {
      return normalizeFriendInviteMetadataList(await friendFetch(fetcher, '/api/friends/invites'));
    },
    async getInvite() {
      const payload = await friendFetch(fetcher, '/api/friends/invites', { method: 'POST' });
      return normalizeInvite(payload.invite ?? payload);
    },
    async revokeInvite(inviteId) {
      await friendFetch(fetcher, `/api/friends/invites/${encodeURIComponent(cleanId(inviteId))}`, { method: 'DELETE' });
    },
    async revokeAllInvites() {
      const payload = await friendFetch(fetcher, '/api/friends/invites', { method: 'DELETE' });
      return safeCount(payload.revoked);
    },
    async getPrivacy() {
      return normalizeFriendPrivacy(await friendFetch(fetcher, '/api/friends/privacy'));
    },
    async updatePrivacy(discoverable) {
      return normalizeFriendPrivacy(await friendFetch(fetcher, '/api/friends/privacy', {
        method: 'PATCH',
        body: JSON.stringify({ discoverable: Boolean(discoverable) }),
      }));
    },
    async claimInvite(token) {
      await friendFetch(fetcher, '/api/friends/invites/claim', {
        method: 'POST',
        body: JSON.stringify({ token: cleanText(token, 512) }),
      });
    },
    async sendFriendRequest(targetProfileId, clientRequestId = createClientRequestId()) {
      await friendFetch(fetcher, '/api/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ profileId: cleanId(targetProfileId), clientRequestId }),
      });
    },
    async acceptFriendRequest(requestId) {
      await friendFetch(fetcher, `/api/friends/requests/${encodeURIComponent(cleanId(requestId))}/accept`, { method: 'POST' });
    },
    async declineFriendRequest(requestId) {
      await friendFetch(fetcher, `/api/friends/requests/${encodeURIComponent(cleanId(requestId))}/decline`, { method: 'POST' });
    },
    async cancelFriendRequest(requestId) {
      await friendFetch(fetcher, `/api/friends/requests/${encodeURIComponent(cleanId(requestId))}/cancel`, { method: 'POST' });
    },
    async unfriend(profileId) {
      await friendFetch(fetcher, `/api/friends/${encodeURIComponent(cleanId(profileId))}`, { method: 'DELETE' });
    },
    async blockProfile(profileId) {
      await friendFetch(fetcher, '/api/friends/blocks', {
        method: 'POST',
        body: JSON.stringify({ profileId: cleanId(profileId) }),
      });
    },
    async unblockProfile(profileId) {
      await friendFetch(fetcher, `/api/friends/blocks/${encodeURIComponent(cleanId(profileId))}`, { method: 'DELETE' });
    },
    async reportProfile(profileId, reason) {
      await friendFetch(fetcher, '/api/friends/reports', {
        method: 'POST',
        body: JSON.stringify({ profileId: cleanId(profileId), reason }),
      });
    },
  };
}

export function subscribeToFriendNetworkEvents(onInvalidated: () => void) {
  const invalidations = new Set([
    'graph-invalidated',
    'track-shares-invalidated',
    'live-audio-invites-invalidated',
  ]);
  // Refreshing on every authenticated open keeps this intentionally lossy
  // stream safe across sleep, network changes, server restarts, and reconnects.
  return subscribeToAuthenticatedEventStream('/api/friends/events', {
    onOpen: onInvalidated,
    onEvent: (event) => {
      if (invalidations.has(event.type)) onInvalidated();
    },
  });
}

export function createClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `friend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function queuedRequestKey(ownerProfileId: string) {
  return `${queuedFriendRequestsStorageKey}:${encodeURIComponent(cleanId(ownerProfileId))}`;
}

export function readQueuedFriendRequests(ownerProfileId: string): QueuedFriendRequest[] {
  if (typeof window === 'undefined' || !cleanId(ownerProfileId)) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(queuedRequestKey(ownerProfileId)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const targetProfileId = cleanId(record.targetProfileId);
      const clientRequestId = cleanId(record.clientRequestId);
      const queuedAt = Number(record.queuedAt);
      if (!targetProfileId || !clientRequestId || !Number.isFinite(queuedAt)) return [];
      return [{
        ownerProfileId: cleanId(ownerProfileId),
        targetProfileId,
        clientRequestId,
        queuedAt: Math.max(0, Math.round(queuedAt)),
      }];
    });
  } catch {
    return [];
  }
}

function writeQueuedFriendRequests(ownerProfileId: string, requests: QueuedFriendRequest[]) {
  if (typeof window === 'undefined') return false;
  return safeSetLocalStorage(queuedRequestKey(ownerProfileId), JSON.stringify(requests));
}

export function clearQueuedFriendRequests(ownerProfileId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(queuedRequestKey(ownerProfileId));
  } catch {
    // A private browser may deny storage access. There is nothing else to clear.
  }
}

export function queueFriendRequest(ownerProfileId: string, targetProfileId: string, clientRequestId = createClientRequestId()) {
  const ownerId = cleanId(ownerProfileId);
  const targetId = cleanId(targetProfileId);
  if (!ownerId || !targetId || ownerId === targetId) return null;
  const current = readQueuedFriendRequests(ownerId);
  const duplicate = current.find((request) => request.targetProfileId === targetId);
  if (duplicate) return duplicate;
  const request: QueuedFriendRequest = {
    ownerProfileId: ownerId,
    targetProfileId: targetId,
    clientRequestId: cleanId(clientRequestId) || createClientRequestId(),
    queuedAt: Date.now(),
  };
  return writeQueuedFriendRequests(ownerId, [...current, request]) ? request : null;
}

export async function flushQueuedFriendRequests(ownerProfileId: string, api: FriendsApi) {
  const ownerId = cleanId(ownerProfileId);
  const queued = readQueuedFriendRequests(ownerId);
  const remaining: QueuedFriendRequest[] = [];
  let sent = 0;
  for (const request of queued) {
    try {
      await api.sendFriendRequest(request.targetProfileId, request.clientRequestId);
      sent += 1;
    } catch (error) {
      if (!(error instanceof FriendsApiError) || error.status === 429 || error.status >= 500) {
        remaining.push(request);
      }
    }
  }
  writeQueuedFriendRequests(ownerId, remaining);
  return { sent, remaining };
}

export function friendSearchMatches(profile: FriendProfile, query: string) {
  const search = query.trim().replace(/^@/, '').toLocaleLowerCase();
  if (!search) return true;
  return profile.handle.toLocaleLowerCase().includes(search)
    || profile.displayName.toLocaleLowerCase().includes(search);
}

export function officialFriendLabel(kind: FriendOfficialKind | undefined) {
  if (kind === 'founder') return 'TrackLab founder';
  if (kind === 'club') return 'Official TrackLab club';
  return '';
}
