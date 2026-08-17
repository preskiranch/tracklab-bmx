import type { TrainingActivityType } from '../types';
import { maxBillingBikeSeats } from './membership';
import {
  clubTabletSessionHeaders,
  currentClubTabletSessionToken,
  readStoredClubTabletSession,
} from './clubTabletStorage';

export type ClubLiveStatus = 'ready' | 'staging' | 'active' | 'paused' | 'finished';

export type ClubLiveProgress = {
  fraction: number;
  distanceMeters?: number;
  label?: string;
};

export type ClubLiveMetrics = {
  watts: number;
  cadence: number;
  speedKph: number;
  distanceMeters: number;
  elapsedMs: number;
  position: number | null;
  participantCount: number;
};

export type ClubLiveSnapshot = {
  clubId: string;
  studioRiderId: string;
  sessionId?: string;
  activityType: TrainingActivityType;
  status: ClubLiveStatus;
  progress: ClubLiveProgress;
  metrics: ClubLiveMetrics;
  trackName?: string;
  destinationLabel?: string;
  startedAt?: number;
  multiplayer: boolean;
};

export type ClubLiveSession = ClubLiveSnapshot & {
  id: string;
  riderName: string;
  athleteName: string | null;
  updatedAt: number;
  expiresAt: number;
};

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeActivityType(value: unknown): TrainingActivityType {
  return value === 'straight-sprint' || value === 'explore' ? value : 'bmx-race';
}

function normalizeStatus(value: unknown): ClubLiveStatus {
  return value === 'staging' || value === 'active' || value === 'paused' || value === 'finished'
    ? value
    : 'ready';
}

function normalizeProgress(value: unknown): ClubLiveProgress {
  const candidate: Partial<ClubLiveProgress> = value && typeof value === 'object'
    ? value as Partial<ClubLiveProgress>
    : { fraction: finiteNumber(value) };
  const fraction = Math.max(0, Math.min(1, finiteNumber(candidate.fraction)));
  const distanceMeters = Number(candidate.distanceMeters);
  const label = optionalText(candidate.label);
  return {
    fraction,
    ...(Number.isFinite(distanceMeters) ? { distanceMeters: Math.max(0, distanceMeters) } : {}),
    ...(label ? { label } : {}),
  };
}

function normalizeMetrics(value: unknown): ClubLiveMetrics {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ClubLiveMetrics>
    : {};
  const position = Number(candidate.position);
  return {
    watts: Math.round(nonNegativeNumber(candidate.watts)),
    cadence: Math.round(nonNegativeNumber(candidate.cadence)),
    speedKph: nonNegativeNumber(candidate.speedKph),
    distanceMeters: nonNegativeNumber(candidate.distanceMeters),
    elapsedMs: nonNegativeNumber(candidate.elapsedMs),
    position: Number.isFinite(position) && position > 0 ? Math.round(position) : null,
    participantCount: Math.max(0, Math.round(nonNegativeNumber(candidate.participantCount))),
  };
}

export function normalizeClubLiveSession(value: unknown): ClubLiveSession | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ClubLiveSession>;
  const id = optionalText(candidate.id);
  const clubId = optionalText(candidate.clubId);
  const studioRiderId = optionalText(candidate.studioRiderId);
  if (!id || !clubId || !studioRiderId) {
    return null;
  }
  const riderName = optionalText(candidate.riderName) ?? 'Club rider';
  const athleteName = optionalText(candidate.athleteName) ?? null;
  const updatedAt = nonNegativeNumber(candidate.updatedAt);
  const expiresAt = nonNegativeNumber(candidate.expiresAt, updatedAt);
  const sessionId = optionalText(candidate.sessionId);
  const trackName = optionalText(candidate.trackName);
  const destinationLabel = optionalText(candidate.destinationLabel);
  const startedAt = Number(candidate.startedAt);
  return {
    id,
    clubId,
    studioRiderId,
    riderName,
    athleteName,
    activityType: normalizeActivityType(candidate.activityType),
    status: normalizeStatus(candidate.status),
    progress: normalizeProgress(candidate.progress),
    metrics: normalizeMetrics(candidate.metrics),
    updatedAt,
    expiresAt,
    multiplayer: candidate.multiplayer === true,
    ...(sessionId ? { sessionId } : {}),
    ...(trackName ? { trackName } : {}),
    ...(destinationLabel ? { destinationLabel } : {}),
    ...(Number.isFinite(startedAt) && startedAt > 0 ? { startedAt } : {}),
  };
}

export function normalizeClubLiveSessions(value: unknown) {
  const candidate = value && typeof value === 'object'
    ? value as { sessions?: unknown }
    : {};
  if (!Array.isArray(candidate.sessions)) {
    return [];
  }
  const sessions = candidate.sessions
    .flatMap((session) => {
      const normalized = normalizeClubLiveSession(session);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const uniqueByRider = new Map<string, ClubLiveSession>();
  sessions.forEach((session) => {
    if (!uniqueByRider.has(session.studioRiderId)) {
      uniqueByRider.set(session.studioRiderId, session);
    }
  });
  return [...uniqueByRider.values()].slice(0, maxBillingBikeSeats);
}

export function activeClubLiveSessions(sessions: ClubLiveSession[], now: number) {
  return sessions
    .filter((session) => session.expiresAt > now)
    .slice(0, maxBillingBikeSeats);
}

export class ClubLiveRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClubLiveRequestError';
    this.status = status;
  }
}

async function clubLiveFetch(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new ClubLiveRequestError(payload.error || `Club Live Monitor returned ${response.status}`, response.status);
  }
  return payload;
}

export async function publishClubLiveSession(snapshot: ClubLiveSnapshot, signal?: AbortSignal) {
  const tabletToken = currentClubTabletSessionToken();
  await clubLiveFetch(tabletToken ? '/api/club-tablet/live' : '/api/club-live/sessions', {
    method: 'PUT',
    signal,
    headers: clubTabletSessionHeaders(tabletToken),
    body: JSON.stringify(snapshot),
  });
}

export async function stopClubLiveSession(
  selection: Pick<ClubLiveSnapshot, 'clubId' | 'studioRiderId'>,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
) {
  const tabletToken = currentClubTabletSessionToken();
  if (tabletToken) {
    // Clearing Club Live telemetry is separate from ending the selected athlete
    // or changing this tablet's durable Wattbike pairing.
    await clubLiveFetch('/api/club-tablet/live', {
      method: 'DELETE',
      keepalive: options.keepalive,
      signal: options.signal,
      headers: clubTabletSessionHeaders(tabletToken),
    });
    return;
  }
  await clubLiveFetch('/api/club-live/sessions', {
    method: 'DELETE',
    keepalive: options.keepalive,
    signal: options.signal,
    body: JSON.stringify(selection),
  });
}

export async function loadClubLiveSessions() {
  return normalizeClubLiveSessions(await clubLiveFetch('/api/club-live/sessions'));
}

export type ClubLiveAccess = {
  clubId: string;
  active: boolean;
  expiresAt: number;
  bikeSeats: number;
  reason?: 'club-membership-required' | 'athlete-active-on-club-tablet' | 'club-bike-seats-full';
};

export function normalizeClubLiveAccess(value: unknown, expectedClubId: string): ClubLiveAccess {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ClubLiveAccess>
    : {};
  const clubId = optionalText(candidate.clubId);
  const reason = candidate.reason === 'club-membership-required'
    || candidate.reason === 'athlete-active-on-club-tablet'
    || candidate.reason === 'club-bike-seats-full'
    ? candidate.reason
    : undefined;
  return {
    clubId: clubId === expectedClubId ? clubId : expectedClubId,
    active: clubId === expectedClubId && candidate.active === true,
    expiresAt: nonNegativeNumber(candidate.expiresAt),
    bikeSeats: Math.max(0, Math.min(maxBillingBikeSeats, Math.round(nonNegativeNumber(candidate.bikeSeats)))),
    ...(reason ? { reason } : {}),
  };
}

export async function loadClubLiveAccess(clubId: string, signal?: AbortSignal) {
  const tabletSession = readStoredClubTabletSession();
  if (tabletSession) {
    return {
      clubId: tabletSession.session.clubId,
      active: tabletSession.session.clubId === clubId && tabletSession.session.expiresAt > Date.now(),
      expiresAt: tabletSession.session.expiresAt,
      bikeSeats: 1,
    };
  }
  const params = new URLSearchParams({ clubId });
  return normalizeClubLiveAccess(
    await clubLiveFetch(`/api/club-live/access?${params.toString()}`, { signal }),
    clubId,
  );
}
