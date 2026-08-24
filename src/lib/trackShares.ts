import { normalizeTrackLocatorId } from './mapLinks';

export type TrackShareSender = {
  id: string;
  handle: string;
  displayName: string;
  photoUrl?: string;
};

export type TrackShare = {
  id: string;
  trackId: string;
  trackName: string;
  trackLocation: string;
  sender: TrackShareSender;
  createdAt: string;
  openedAt: string | null;
};

export type TrackSharePage = {
  items: TrackShare[];
  nextCursor: string | null;
  total: number;
  unreadTotal: number;
};

export type TrackShareListQuery = {
  cursor?: string | null;
  limit?: number;
  unread?: boolean;
};

export type TrackSharesApi = {
  listReceived: (query?: TrackShareListQuery) => Promise<TrackSharePage>;
  send: (recipientProfileId: string, trackId: string, clientRequestId?: string) => Promise<TrackShare>;
  markOpened: (shareId: string) => Promise<TrackShare>;
  dismiss: (shareId: string) => Promise<void>;
};

const defaultPageSize = 20;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanId(value: unknown, maxLength = 180) {
  return cleanText(value, maxLength);
}

function cleanHandle(value: unknown) {
  return cleanText(value, 40).replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function cleanImageUrl(value: unknown) {
  const candidate = cleanText(value, 60_000);
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-zA-Z0-9+/=]+$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate, typeof window === 'undefined' ? 'https://tracklab.invalid' : window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? candidate : '';
  } catch {
    return '';
  }
}

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function cleanDate(value: unknown) {
  const candidate = cleanText(value, 40);
  return Number.isFinite(Date.parse(candidate)) ? candidate : '';
}

export function normalizeTrackShare(value: unknown): TrackShare | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const hasNestedTrack = raw.track && typeof raw.track === 'object' && !Array.isArray(raw.track);
  const rawTrack = hasNestedTrack ? raw.track as Record<string, unknown> : raw;
  const rawSenderValue = raw.sender ?? raw.from ?? raw.profile;
  const rawSender = rawSenderValue && typeof rawSenderValue === 'object' && !Array.isArray(rawSenderValue)
    ? rawSenderValue as Record<string, unknown>
    : {};
  const id = cleanId(raw.id ?? raw.shareId);
  const trackId = normalizeTrackLocatorId(hasNestedTrack
    ? rawTrack.id ?? rawTrack.trackId ?? raw.trackId
    : raw.trackId);
  const trackName = cleanText(rawTrack.name ?? rawTrack.trackName ?? raw.trackName, 140);
  const senderId = cleanId(rawSender.id ?? rawSender.profileId);
  const senderHandle = cleanHandle(rawSender.handle ?? rawSender.username);
  const senderName = cleanText(rawSender.displayName ?? rawSender.name, 80);
  const createdAt = cleanDate(raw.createdAt);
  if (!id || !trackId || !trackName || !senderId || !senderHandle || !senderName || !createdAt) return null;
  const photoUrl = cleanImageUrl(rawSender.photoUrl);
  const openedAt = cleanDate(raw.openedAt ?? raw.readAt) || null;
  return {
    id,
    trackId,
    trackName,
    trackLocation: cleanText(
      rawTrack.locationLabel ?? rawTrack.trackLocation ?? rawTrack.location ?? raw.trackLocation,
      220,
    ),
    sender: {
      id: senderId,
      handle: senderHandle,
      displayName: senderName,
      ...(photoUrl ? { photoUrl } : {}),
    },
    createdAt,
    openedAt,
  };
}

export function normalizeTrackSharePage(value: unknown): TrackSharePage {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const values = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.shares) ? raw.shares : [];
  const items = values.map(normalizeTrackShare).filter((share): share is TrackShare => share != null);
  return {
    items,
    nextCursor: cleanText(raw.nextCursor, 400) || null,
    total: Math.max(items.length, safeCount(raw.total)),
    unreadTotal: safeCount(raw.unreadTotal),
  };
}

export class TrackSharesApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TrackSharesApiError';
    this.status = status;
  }
}

async function trackShareFetch(fetcher: typeof fetch, path: string, options: RequestInit = {}) {
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
    throw new TrackSharesApiError(
      cleanText(payload.error, 240) || `TrackLab shared tracks returned ${response.status}.`,
      response.status,
    );
  }
  return payload;
}

function createTrackShareRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `track-share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizedShareEnvelope(value: Record<string, unknown>) {
  const share = normalizeTrackShare(value.share ?? value);
  if (!share) throw new Error('TrackLab received an invalid shared-track response.');
  return share;
}

export function createTrackSharesApi(fetcher: typeof fetch = fetch): TrackSharesApi {
  return {
    async listReceived(query = {}) {
      const params = new URLSearchParams();
      const cursor = cleanText(query.cursor, 400);
      if (cursor) params.set('cursor', cursor);
      if (query.unread) params.set('unread', '1');
      params.set('limit', String(Math.min(50, Math.max(1, Math.round(query.limit ?? defaultPageSize)))));
      return normalizeTrackSharePage(await trackShareFetch(fetcher, `/api/friends/track-shares?${params}`));
    },
    async send(recipientProfileId, trackId, clientRequestId = createTrackShareRequestId()) {
      const normalizedTrackId = normalizeTrackLocatorId(trackId);
      if (!cleanId(recipientProfileId) || !normalizedTrackId) {
        throw new TrackSharesApiError('Choose a friend and a valid track to share.', 400);
      }
      const payload = await trackShareFetch(fetcher, '/api/friends/track-shares', {
        method: 'POST',
        body: JSON.stringify({
          recipientProfileId: cleanId(recipientProfileId),
          trackId: normalizedTrackId,
          clientRequestId: cleanId(clientRequestId),
        }),
      });
      return normalizedShareEnvelope(payload);
    },
    async markOpened(shareId) {
      return normalizedShareEnvelope(await trackShareFetch(
        fetcher,
        `/api/friends/track-shares/${encodeURIComponent(cleanId(shareId))}/open`,
        { method: 'POST', keepalive: true },
      ));
    },
    async dismiss(shareId) {
      await trackShareFetch(
        fetcher,
        `/api/friends/track-shares/${encodeURIComponent(cleanId(shareId))}`,
        { method: 'DELETE' },
      );
    },
  };
}
