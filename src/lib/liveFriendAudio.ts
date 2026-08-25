export type LiveFriendAudioInvite = {
  id: string;
  from: {
    id: string;
    displayName: string;
    handle: string;
    photoUrl?: string;
  };
  createdAt: string;
  expiresAt: string;
};

export type LiveFriendAudioInviteResponse =
  | { accepted: true; roomId: string }
  | { accepted: false };

export type LiveFriendAudioInviteStatus = {
  state: 'idle' | 'sending' | 'sent' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'error';
  inviteId?: string | null;
  targetProfileId?: string | null;
  targetName?: string | null;
  expiresAt?: string | number | null;
  message?: string | null;
};

export type LiveFriendAudioRequest = {
  accountId: string;
  targetProfileId: string;
  targetName: string;
};

type LiveFriendAudioRequestListener = (request: LiveFriendAudioRequest) => void;

const queuedLiveFriendAudioRequests = new Map<string, LiveFriendAudioRequest>();
const liveFriendAudioRequestListeners = new Map<string, Set<LiveFriendAudioRequestListener>>();

export type LiveFriendAudioApi = {
  listLiveAudioInvites: () => Promise<LiveFriendAudioInvite[]>;
  respondToLiveAudioInvite: (inviteId: string, accepted: boolean) => Promise<LiveFriendAudioInviteResponse>;
  cancelLiveAudioInvite: (inviteId: string) => Promise<void>;
};

function cleanText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanId(value: unknown) {
  return cleanText(value, 180);
}

export function queueLiveFriendAudioRequest(value: LiveFriendAudioRequest) {
  const request = {
    accountId: cleanId(value.accountId),
    targetProfileId: cleanId(value.targetProfileId),
    targetName: cleanText(value.targetName, 80) || 'your friend',
  };
  if (!request.accountId || !request.targetProfileId) return false;
  const listeners = liveFriendAudioRequestListeners.get(request.accountId);
  if (!listeners?.size) {
    // Only the latest request matters because an account can open one private
    // live-audio room at a time.
    queuedLiveFriendAudioRequests.set(request.accountId, request);
    return false;
  }
  queuedLiveFriendAudioRequests.delete(request.accountId);
  [...listeners].forEach((listener) => listener(request));
  return true;
}

export function subscribeToLiveFriendAudioRequests(
  accountId: string,
  listener: LiveFriendAudioRequestListener,
) {
  const id = cleanId(accountId);
  if (!id) return () => undefined;
  const listeners = liveFriendAudioRequestListeners.get(id) ?? new Set<LiveFriendAudioRequestListener>();
  listeners.add(listener);
  liveFriendAudioRequestListeners.set(id, listeners);
  const queued = queuedLiveFriendAudioRequests.get(id);
  if (queued) {
    queuedLiveFriendAudioRequests.delete(id);
    listener(queued);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) liveFriendAudioRequestListeners.delete(id);
  };
}

export function clearQueuedLiveFriendAudioRequests(accountId?: string) {
  const id = cleanId(accountId);
  if (id) queuedLiveFriendAudioRequests.delete(id);
  else queuedLiveFriendAudioRequests.clear();
}

function cleanHandle(value: unknown) {
  return cleanText(value, 40).replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function cleanImageUrl(value: unknown) {
  const candidate = cleanText(value, 2_000_000);
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-zA-Z0-9+/=]+$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate, typeof window === 'undefined' ? 'https://tracklab.invalid' : window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? candidate : '';
  } catch {
    return '';
  }
}

function cleanTimestamp(value: unknown) {
  const timestamp = typeof value === 'number' ? value : Date.parse(cleanText(value, 40));
  const date = new Date(timestamp);
  return Number.isFinite(timestamp) && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function normalizeLiveFriendAudioInvite(value: unknown): LiveFriendAudioInvite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!raw.from || typeof raw.from !== 'object' || Array.isArray(raw.from)) return null;
  const sender = raw.from as Record<string, unknown>;
  const id = cleanId(raw.id);
  const senderId = cleanId(sender.id ?? sender.profileId);
  const displayName = cleanText(sender.displayName, 80);
  const handle = cleanHandle(sender.handle ?? sender.username);
  const createdAt = cleanTimestamp(raw.createdAt);
  const expiresAt = cleanTimestamp(raw.expiresAt);
  if (!id || !senderId || !displayName || !handle || !createdAt || !expiresAt) return null;
  const photoUrl = cleanImageUrl(sender.photoUrl);
  return {
    id,
    from: { id: senderId, displayName, handle, ...(photoUrl ? { photoUrl } : {}) },
    createdAt,
    expiresAt,
  };
}

export function normalizeLiveFriendAudioInviteList(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return (Array.isArray(raw.invites) ? raw.invites : [])
    .map(normalizeLiveFriendAudioInvite)
    .filter((invite): invite is LiveFriendAudioInvite => invite != null)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function normalizeLiveFriendAudioInviteResponse(value: unknown): LiveFriendAudioInviteResponse {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (raw.accepted !== true) return { accepted: false };
  const roomId = cleanId(raw.roomId);
  if (!roomId) throw new Error('TrackLab accepted the live audio invitation without opening its private room.');
  return { accepted: true, roomId };
}

export function normalizeLiveFriendAudioInviteStatus(value: unknown): LiveFriendAudioInviteStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const invite = raw.invite && typeof raw.invite === 'object' && !Array.isArray(raw.invite)
    ? raw.invite as Record<string, unknown>
    : raw;
  const states = ['sending', 'sent', 'accepted', 'declined', 'expired', 'cancelled', 'error'];
  const state = states.includes(String(raw.state))
    ? raw.state as LiveFriendAudioInviteStatus['state']
    : 'error';
  const string = (field: string, limit: number) => (
    typeof raw[field] === 'string' ? raw[field].trim().slice(0, limit) : ''
  );
  return {
    state,
    inviteId: typeof invite.id === 'string' ? invite.id.trim().slice(0, 180) || null : null,
    targetProfileId: typeof invite.targetProfileId === 'string' ? invite.targetProfileId.trim().slice(0, 180) || null : null,
    targetName: typeof invite.targetName === 'string' ? invite.targetName.trim().slice(0, 80) || null : null,
    expiresAt: typeof invite.expiresAt === 'string' ? invite.expiresAt.trim().slice(0, 40) || null : null,
    message: string('message', 240) || null,
  };
}

async function request(fetcher: typeof fetch, path: string, options: RequestInit = {}) {
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
  if (!response.ok) throw new Error(cleanText(payload.error, 240) || `TrackLab live audio returned ${response.status}.`);
  return payload;
}

export function createLiveFriendAudioApi(fetcher: typeof fetch = fetch): LiveFriendAudioApi {
  return {
    async listLiveAudioInvites() {
      return normalizeLiveFriendAudioInviteList(await request(fetcher, '/api/friends/live-audio-invites'));
    },
    async respondToLiveAudioInvite(inviteId, accepted) {
      return normalizeLiveFriendAudioInviteResponse(await request(
        fetcher,
        `/api/friends/live-audio-invites/${encodeURIComponent(cleanId(inviteId))}/respond`,
        { method: 'POST', body: JSON.stringify({ accepted: Boolean(accepted) }) },
      ));
    },
    async cancelLiveAudioInvite(inviteId) {
      await request(fetcher, `/api/friends/live-audio-invites/${encodeURIComponent(cleanId(inviteId))}`, {
        method: 'DELETE',
      });
    },
  };
}
