import type {
  PrivateHeartRateSample,
  PrivateHeartRateSummary,
  PrivateHeartRateZoneSummary,
} from '../types';

export type HeartRateActivityType =
  | 'bmx-race'
  | 'straight-sprint'
  | 'explore'
  | 'get-pulled'
  | 'monitor-sprint';

export type HeartRateRelayActivityType = HeartRateActivityType | 'training-block';
export type HeartRateRelayScope = 'session' | 'studio-block' | 'account-block';
export type HeartRateStudioRelayScope = Exclude<HeartRateRelayScope, 'account-block'>;

export type HeartRatePairing = Readonly<{
  id: string;
  sessionId: string;
  activityType: HeartRateRelayActivityType;
  relayScope: HeartRateRelayScope;
  riderId: string;
  playerId: number | null;
  clubId: string | null;
  studioRiderId: string | null;
  claimedAt: number | null;
  pairCodeExpiresAt?: number | null;
  ingestExpiresAt?: number | null;
  expiresAt: number;
  liveStudioConsent: boolean;
  sessionStudioConsent: boolean;
  revokedAt: number | null;
  studioBlockStoppedAt?: number | null;
}>;

export type HeartRateStream = Readonly<{
  id: string;
  pairingId: string;
  sessionId: string;
  activityType: HeartRateRelayActivityType;
  relayScope: HeartRateRelayScope;
  riderId: string;
  playerId: number | null;
  startedAt: number;
  endedAt: number | null;
  activeDurationMs: number | null;
  summary: PrivateHeartRateSummary | null;
  zoneSummaries: readonly PrivateHeartRateZoneSummary[];
  finalizedAt: number | null;
}>;

/** Redacted, consented club view. It can never carry account identity or samples. */
export type ClubHeartRateSummaryStream = Readonly<{
  id: string;
  sessionId: string;
  activityType: HeartRateActivityType;
  relayScope: HeartRateRelayScope;
  studioRiderId: string;
  playerId: number | null;
  startedAt: number;
  endedAt: number | null;
  activeDurationMs: number | null;
  summary: PrivateHeartRateSummary | null;
  zoneSummaries: readonly PrivateHeartRateZoneSummary[];
  finalizedAt: number | null;
}>;

/**
 * A summary-only slice cut from one continuous, athlete-owned studio Watch
 * block. It intentionally contains neither raw samples nor account/profile IDs.
 */
export type HeartRateTrainingSegment = Readonly<{
  id: string;
  streamId: string;
  trainingSessionId: string;
  activityType: HeartRateActivityType;
  relayScope: 'studio-block' | 'account-block';
  studioRiderId: string | null;
  playerId: number | null;
  startedAt: number;
  endedAt: number;
  activeDurationMs: number;
  summary: PrivateHeartRateSummary | null;
  zoneSummaries: readonly PrivateHeartRateZoneSummary[];
  finalizedAt: number | null;
}>;

export type PrivateHeartRateHistoryItem = HeartRateStream | HeartRateTrainingSegment;
export type ClubHeartRateHistoryItem = ClubHeartRateSummaryStream | HeartRateTrainingSegment;

export type HeartRateLiveEvent = Readonly<{
  streamId: string;
  sessionId: string;
  relayScope?: HeartRateRelayScope;
  riderId: string;
  studioRiderId?: string;
  playerId: number | null;
  bpm: number;
  recordedAt: number;
  receivedAt?: number;
  freshUntil?: number;
  activeElapsedMs: number | null;
}>;

export type CreateHeartRatePairingInput = Readonly<{
  sessionId: string;
  activityType: HeartRateActivityType;
  riderId: string;
  playerId?: number;
  liveStudioConsent?: boolean;
  sessionStudioConsent?: boolean;
  clubSession?: { clubId: string; studioRiderId: string };
}>;

export type HeartRatePairingClaim = Readonly<{
  ingestToken: string;
  ingestExpiresAt: number | null;
  pairing: Pick<HeartRatePairing, 'id' | 'sessionId' | 'activityType' | 'relayScope' | 'riderId' | 'playerId'>;
}>;

export const heartRateStudioInviteQueryParameter = 'heartRateStudioInvite' as const;

export type HeartRateStudioConsent = Readonly<{
  liveStudioConsent: boolean;
  sessionStudioConsent: boolean;
  studioBlockConsent: boolean;
}>;

export type HeartRateStudioInvitation = Readonly<{
  id: string;
  clubId: string;
  studioRiderId: string;
  sessionId: string;
  activityType: HeartRateActivityType;
  relayScope: HeartRateStudioRelayScope;
  playerId: number | null;
  expiresAt: number;
  claimedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}>;

/**
 * Deliberately redacted preview contract. The preview endpoint must authenticate
 * the exact invited athlete before returning these display-only fields.
 */
export type HeartRateStudioInvitationPreview = Readonly<{
  clubName: string;
  riderName: string;
  sessionId: string;
  activityType: HeartRateActivityType;
  relayScope: HeartRateStudioRelayScope;
  playerId: number | null;
  expiresAt: number;
}>;

export type CreateHeartRateStudioInvitationInput = Readonly<{
  sessionId: string;
  activityType: HeartRateActivityType;
  relayScope?: HeartRateStudioRelayScope;
  studioRiderId: string;
  playerId?: number;
}>;

export type HeartRateStudioInvitationHandoff = Readonly<{
  invitation: HeartRateStudioInvitation;
  inviteCode: string;
  claimUrl: string | null;
}>;

export type HeartRateStudioBlockState =
  | 'waiting-athlete'
  | 'waiting-watch'
  | 'watch-ready'
  | 'ended'
  | 'expired'
  | 'stopped';

/** Owner-safe readiness projection. It never contains raw samples or athlete identity. */
export type HeartRateStudioBlockStatus = Readonly<{
  invitationId: string;
  clubId: string;
  studioRiderId: string;
  anchorSessionId: string;
  activityType: HeartRateActivityType;
  relayScope: 'studio-block';
  playerId: number | null;
  state: HeartRateStudioBlockState;
  invitationExpiresAt: number;
  pairCodeExpiresAt: number | null;
  blockExpiresAt: number | null;
  streamStartedAt: number | null;
  lastSampleAt: number | null;
  lastSampleReceivedAt: number | null;
  freshUntil: number | null;
}>;

export type HeartRateAccountBlockState =
  | 'waiting-watch'
  | 'live'
  | 'stale'
  | 'ended'
  | 'expired'
  | 'revoked';

/** Owner-only account status. It contains neither ingest credentials nor raw samples. */
export type HeartRateAccountBlockStatus = Readonly<{
  pairingId: string;
  blockId: string;
  relayScope: 'account-block';
  state: HeartRateAccountBlockState;
  pairCodeExpiresAt: number;
  ingestExpiresAt: number | null;
  effectiveExpiresAt: number;
  claimedAt: number | null;
  revokedAt: number | null;
  stopRequestedAt: number | null;
  drainExpiresAt: number | null;
  streamStartedAt: number | null;
  streamEndedAt: number | null;
  lastSampleAt: number | null;
  lastSampleReceivedAt: number | null;
  freshUntil: number | null;
  createdAt: number;
  updatedAt: number;
}>;

export type HeartRateAccountBlockHandoff = Readonly<{
  block: HeartRateAccountBlockStatus;
  pairing: HeartRatePairing;
  pairCode: string;
  replayed: boolean;
}>;

/**
 * The ingest token is intentionally returned only to the immediate native
 * configuration call. Callers must never place this object in URL, Web Storage,
 * app state persisted to disk, telemetry, or logs.
 */
export type HeartRateStudioRelayClaim = Readonly<{
  pairing: HeartRatePairing;
  ingestToken: string;
  ingestExpiresAt: number | null;
}>;

export type HeartRateStudioInviteUrlDisposition = 'preserve' | 'remove';

export class HeartRateStudioInviteError extends Error {
  readonly status: number | null;
  readonly urlDisposition: HeartRateStudioInviteUrlDisposition;

  constructor(
    message: string,
    options: { status?: number | null; urlDisposition?: HeartRateStudioInviteUrlDisposition } = {},
  ) {
    super(message);
    this.name = 'HeartRateStudioInviteError';
    this.status = options.status ?? null;
    this.urlDisposition = options.urlDisposition ?? 'preserve';
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableTimestamp(value: unknown) {
  if (value == null) return null;
  const number = finiteNumber(value);
  return number != null && number >= 0 ? Math.round(number) : null;
}

function playerId(value: unknown) {
  if (value == null) return null;
  const number = finiteNumber(value);
  return number != null && Number.isSafeInteger(number) && number >= 1 && number <= 4 ? number : null;
}

function activityType(value: unknown): HeartRateActivityType | null {
  return value === 'bmx-race'
    || value === 'straight-sprint'
    || value === 'explore'
    || value === 'get-pulled'
    || value === 'monitor-sprint'
    ? value
    : null;
}

function relayActivityType(value: unknown): HeartRateRelayActivityType | null {
  return value === 'training-block' ? value : activityType(value);
}

function relayScope(value: unknown): HeartRateRelayScope | null {
  return value === 'session' || value === 'studio-block' || value === 'account-block' ? value : null;
}

function studioRelayScope(value: unknown): HeartRateStudioRelayScope | null {
  return value === 'session' || value === 'studio-block' ? value : null;
}

function identifier(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

function normalizePairing(value: unknown): HeartRatePairing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : '';
  const riderId = typeof item.riderId === 'string' ? item.riderId.trim() : '';
  const normalizedActivityType = relayActivityType(item.activityType);
  const normalizedRelayScope = item.relayScope == null ? 'session' : relayScope(item.relayScope);
  // Once the Watch claims a pairing, the short-lived display code expires
  // before the private ingest credential. Prefer the effective ingest expiry
  // returned by the account endpoint so an app reload does not incorrectly
  // discard a still-valid relay after the pair code's ten-minute window.
  const expiresAt = nullableTimestamp(
    item.ingestExpiresAt ?? item.expiresAt ?? item.pairCodeExpiresAt,
  );
  if (!id || !sessionId || !riderId || !normalizedActivityType || !normalizedRelayScope || expiresAt == null) return null;
  return {
    id,
    sessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    riderId,
    playerId: playerId(item.playerId),
    clubId: identifier(item.clubId) || null,
    studioRiderId: identifier(item.studioRiderId) || null,
    claimedAt: nullableTimestamp(item.claimedAt),
    pairCodeExpiresAt: nullableTimestamp(item.pairCodeExpiresAt),
    ingestExpiresAt: nullableTimestamp(item.ingestExpiresAt),
    expiresAt,
    liveStudioConsent: item.liveStudioConsent === true,
    sessionStudioConsent: item.sessionStudioConsent === true,
    revokedAt: nullableTimestamp(item.revokedAt),
    studioBlockStoppedAt: nullableTimestamp(item.studioBlockStoppedAt),
  };
}

function normalizeSummary(value: unknown): PrivateHeartRateSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value as Partial<PrivateHeartRateSummary>;
  const sampleCount = finiteNumber(summary.sampleCount);
  const coverageMs = finiteNumber(summary.coverageMs);
  const coveragePercent = finiteNumber(summary.coveragePercent);
  if (
    sampleCount == null
    || sampleCount < 0
    || coverageMs == null
    || coverageMs < 0
    || coveragePercent == null
    || coveragePercent < 0
    || coveragePercent > 100
  ) return null;
  const elapsedMetric = (candidate: unknown) => {
    if (candidate == null) return null;
    const normalized = finiteNumber(candidate);
    return normalized != null && normalized >= 0 ? normalized : undefined;
  };
  const bpmMetric = (candidate: unknown) => {
    if (candidate == null) return null;
    const normalized = finiteNumber(candidate);
    return normalized != null && normalized >= 20 && normalized <= 260 ? normalized : undefined;
  };
  const firstSampleElapsedMs = elapsedMetric(summary.firstSampleElapsedMs);
  const lastSampleElapsedMs = elapsedMetric(summary.lastSampleElapsedMs);
  const minimumBpm = bpmMetric(summary.minimumBpm);
  const averageBpm = bpmMetric(summary.averageBpm);
  const peakBpm = bpmMetric(summary.peakBpm);
  if (
    firstSampleElapsedMs === undefined
    || lastSampleElapsedMs === undefined
    || minimumBpm === undefined
    || averageBpm === undefined
    || peakBpm === undefined
    || (firstSampleElapsedMs != null && lastSampleElapsedMs != null && lastSampleElapsedMs < firstSampleElapsedMs)
    || (minimumBpm != null && averageBpm != null && averageBpm < minimumBpm)
    || (averageBpm != null && peakBpm != null && peakBpm < averageBpm)
  ) return null;
  return {
    sampleCount: Math.max(0, Math.round(sampleCount)),
    coverageMs: Math.max(0, Math.round(coverageMs)),
    coveragePercent,
    firstSampleElapsedMs,
    lastSampleElapsedMs,
    minimumBpm,
    averageBpm,
    peakBpm,
  };
}

function normalizeZoneSummary(value: unknown): PrivateHeartRateZoneSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const zoneId = typeof item.zoneId === 'string' ? item.zoneId.trim() : '';
  const zoneName = typeof item.zoneName === 'string' ? item.zoneName.trim() : '';
  const startElapsedMs = nullableTimestamp(item.startElapsedMs);
  const endElapsedMs = nullableTimestamp(item.endElapsedMs);
  const summary = normalizeSummary(item.summary ?? item);
  if (
    !zoneId
    || zoneId.length > 80
    || startElapsedMs == null
    || endElapsedMs == null
    || endElapsedMs <= startElapsedMs
    || !summary
  ) return null;
  return {
    zoneId,
    ...(zoneName ? { zoneName } : {}),
    startElapsedMs,
    endElapsedMs,
    summary,
  };
}

function normalizeStream(value: unknown): HeartRateStream | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const pairingId = typeof item.pairingId === 'string' ? item.pairingId.trim() : '';
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : '';
  const riderId = typeof item.riderId === 'string' ? item.riderId.trim() : '';
  const normalizedActivityType = relayActivityType(item.activityType);
  const normalizedRelayScope = item.relayScope == null ? 'session' : relayScope(item.relayScope);
  const startedAt = nullableTimestamp(item.startedAt);
  if (!id || !pairingId || !sessionId || !riderId || !normalizedActivityType || !normalizedRelayScope || startedAt == null) return null;
  return {
    id,
    pairingId,
    sessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    riderId,
    playerId: playerId(item.playerId),
    startedAt,
    endedAt: nullableTimestamp(item.endedAt),
    activeDurationMs: nullableTimestamp(item.activeDurationMs),
    summary: normalizeSummary(item.summary),
    zoneSummaries: Array.isArray(item.zoneSummaries)
      ? item.zoneSummaries.flatMap((zone) => {
        const normalized = normalizeZoneSummary(zone);
        return normalized ? [normalized] : [];
      })
      : [],
    finalizedAt: nullableTimestamp(item.finalizedAt),
  };
}

function normalizeClubSummaryStream(value: unknown): ClubHeartRateSummaryStream | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : '';
  const studioRiderId = typeof item.studioRiderId === 'string' ? item.studioRiderId.trim() : '';
  const normalizedActivityType = activityType(item.activityType);
  const normalizedRelayScope = item.relayScope == null ? 'session' : studioRelayScope(item.relayScope);
  const startedAt = nullableTimestamp(item.startedAt);
  if (
    !id
    || id.length > 160
    || !sessionId
    || sessionId.length > 160
    || !studioRiderId
    || studioRiderId.length > 160
    || !normalizedActivityType
    || !normalizedRelayScope
    || startedAt == null
  ) return null;
  return {
    id,
    sessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    studioRiderId,
    playerId: playerId(item.playerId),
    startedAt,
    endedAt: nullableTimestamp(item.endedAt),
    activeDurationMs: nullableTimestamp(item.activeDurationMs),
    summary: normalizeSummary(item.summary),
    zoneSummaries: Array.isArray(item.zoneSummaries)
      ? item.zoneSummaries.flatMap((zone) => {
        const normalized = normalizeZoneSummary(zone);
        return normalized ? [normalized] : [];
      })
      : [],
    finalizedAt: nullableTimestamp(item.finalizedAt),
  };
}

function normalizeTrainingSegment(value: unknown): HeartRateTrainingSegment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const streamId = identifier(item.streamId);
  const trainingSessionId = identifier(item.trainingSessionId);
  const studioRiderId = identifier(item.studioRiderId);
  const normalizedActivityType = activityType(item.activityType);
  const normalizedRelayScope = item.relayScope === 'studio-block' || item.relayScope === 'account-block'
    ? item.relayScope
    : null;
  const startedAt = nullableTimestamp(item.startedAt);
  const endedAt = nullableTimestamp(item.endedAt);
  const activeDurationMs = nullableTimestamp(item.activeDurationMs);
  if (
    !id
    || !streamId
    || !trainingSessionId
    || !normalizedActivityType
    || !normalizedRelayScope
    || (normalizedRelayScope === 'studio-block' && !studioRiderId)
    || (normalizedRelayScope === 'account-block' && Boolean(studioRiderId))
    || startedAt == null
    || endedAt == null
    || endedAt < startedAt
    || activeDurationMs == null
    || activeDurationMs > endedAt - startedAt + 120_000
  ) return null;
  return {
    id,
    streamId,
    trainingSessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    studioRiderId: studioRiderId || null,
    playerId: playerId(item.playerId),
    startedAt,
    endedAt,
    activeDurationMs,
    summary: normalizeSummary(item.summary),
    zoneSummaries: Array.isArray(item.zoneSummaries)
      ? item.zoneSummaries.flatMap((zone) => {
        const normalized = normalizeZoneSummary(zone);
        return normalized ? [normalized] : [];
      })
      : [],
    finalizedAt: nullableTimestamp(item.finalizedAt),
  };
}

export function normalizeHeartRateLiveEvent(value: unknown): HeartRateLiveEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const streamId = typeof item.streamId === 'string' ? item.streamId.trim() : '';
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : '';
  const personalRiderId = typeof item.riderId === 'string' ? item.riderId.trim() : '';
  const studioRiderId = typeof item.studioRiderId === 'string' ? item.studioRiderId.trim() : '';
  const riderId = personalRiderId || studioRiderId;
  const bpm = finiteNumber(item.bpm);
  const recordedAt = nullableTimestamp(item.recordedAt);
  const normalizedRelayScope = item.relayScope == null ? null : relayScope(item.relayScope);
  const receivedAt = nullableTimestamp(item.receivedAt);
  const freshUntil = nullableTimestamp(item.freshUntil);
  const activeElapsedMs = nullableTimestamp(item.activeElapsedMs);
  if (
    !streamId
    || streamId.length > 160
    || !sessionId
    || sessionId.length > 160
    || !riderId
    || riderId.length > 160
    || studioRiderId.length > 160
    || bpm == null
    || bpm < 20
    || bpm > 260
    || recordedAt == null
    || (item.relayScope != null && !normalizedRelayScope)
    || (item.receivedAt != null && receivedAt == null)
    || (item.freshUntil != null && freshUntil == null)
    || (item.activeElapsedMs != null && activeElapsedMs == null)
    || (personalRiderId && activeElapsedMs == null)
  ) return null;
  return {
    streamId,
    sessionId,
    ...(normalizedRelayScope ? { relayScope: normalizedRelayScope } : {}),
    riderId,
    ...(studioRiderId ? { studioRiderId } : {}),
    playerId: playerId(item.playerId),
    bpm: Math.round(bpm * 10) / 10,
    recordedAt,
    ...(receivedAt != null ? { receivedAt } : {}),
    ...(freshUntil != null ? { freshUntil } : {}),
    activeElapsedMs,
  };
}

async function jsonResponse<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    const error = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `${label} returned ${response.status}`;
    throw new Error(error);
  }
  return payload;
}

export async function createHeartRatePairing(input: CreateHeartRatePairingInput) {
  const response = await fetch('/api/heart-rate/pairings', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await jsonResponse<{ pairing?: unknown; pairCode?: unknown }>(response, 'Heart-rate pairing');
  const pairing = normalizePairing(payload.pairing);
  const pairCode = typeof payload.pairCode === 'string' ? payload.pairCode.trim() : '';
  if (!pairing || !pairCode) throw new Error('Heart-rate pairing returned an invalid response.');
  return { pairing, pairCode };
}

export async function claimHeartRatePairing(pairCode: string): Promise<HeartRatePairingClaim> {
  const response = await fetch('/api/heart-rate/pairings/claim', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairCode: pairCode.trim() }),
  });
  const payload = await jsonResponse<{ ingestToken?: unknown; ingestExpiresAt?: unknown; pairing?: unknown }>(response, 'Heart-rate pairing claim');
  const ingestToken = typeof payload.ingestToken === 'string' ? payload.ingestToken.trim() : '';
  const ingestExpiresAt = nullableTimestamp(payload.ingestExpiresAt);
  const pairing = normalizePairing({
    ...(payload.pairing && typeof payload.pairing === 'object' ? payload.pairing : {}),
    claimedAt: Date.now(),
    expiresAt: Date.now() + 1,
    liveStudioConsent: false,
    sessionStudioConsent: false,
    revokedAt: null,
  });
  if (!ingestToken || !pairing) throw new Error('Heart-rate pairing claim returned an invalid response.');
  return {
    ingestToken,
    ingestExpiresAt,
    pairing: {
      id: pairing.id,
      sessionId: pairing.sessionId,
      activityType: pairing.activityType,
      relayScope: pairing.relayScope,
      riderId: pairing.riderId,
      playerId: pairing.playerId,
    },
  };
}

export async function loadHeartRatePairings() {
  const response = await fetch('/api/heart-rate/pairings', { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = await jsonResponse<{ pairings?: unknown }>(response, 'Heart-rate pairings');
  return Array.isArray(payload.pairings) ? payload.pairings.flatMap((item) => {
    const pairing = normalizePairing(item);
    return pairing ? [pairing] : [];
  }) : [];
}

export async function updateHeartRatePairingConsent(
  pairingId: string,
  consent: { liveStudioConsent?: boolean; sessionStudioConsent?: boolean },
) {
  const response = await fetch(`/api/heart-rate/pairings/${encodeURIComponent(pairingId)}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(consent),
  });
  const payload = await jsonResponse<{ pairing?: unknown }>(response, 'Heart-rate consent');
  const pairing = normalizePairing(payload.pairing);
  if (!pairing) throw new Error('Heart-rate consent returned an invalid response.');
  return pairing;
}

export async function revokeHeartRatePairing(pairingId: string) {
  const response = await fetch(`/api/heart-rate/pairings/${encodeURIComponent(pairingId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  await jsonResponse(response, 'Heart-rate disconnection');
}

export const defaultHeartRateStudioConsent: HeartRateStudioConsent = Object.freeze({
  liveStudioConsent: false,
  sessionStudioConsent: false,
  studioBlockConsent: false,
});

export function normalizeHeartRateStudioConsent(value?: Partial<HeartRateStudioConsent> | null): HeartRateStudioConsent {
  return {
    liveStudioConsent: value?.liveStudioConsent === true,
    sessionStudioConsent: value?.sessionStudioConsent === true,
    studioBlockConsent: value?.studioBlockConsent === true,
  };
}

export function normalizeHeartRateStudioInviteCode(value: unknown) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[2-9A-HJ-NP-Z]{8}$/.test(compact)) return '';
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export type ParsedHeartRateStudioInvite = Readonly<{
  present: boolean;
  inviteCode: string;
}>;

function safeUrl(href: string, baseHref = 'https://tracklab.invalid/') {
  try {
    return new URL(href, baseHref);
  } catch {
    return null;
  }
}

function sameShapeHref(original: string, url: URL) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(original)
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

export function parseHeartRateStudioInviteHref(href: string): ParsedHeartRateStudioInvite {
  const url = safeUrl(href);
  if (!url) return { present: false, inviteCode: '' };
  const present = url.searchParams.has(heartRateStudioInviteQueryParameter);
  return {
    present,
    inviteCode: normalizeHeartRateStudioInviteCode(
      url.searchParams.get(heartRateStudioInviteQueryParameter),
    ),
  };
}

/**
 * Carries an invitation through a same-origin sign-in route without using
 * localStorage/sessionStorage. Cross-origin destinations are left untouched so
 * the invitation bearer code cannot leak to another site.
 */
export function preserveHeartRateStudioInviteInHref(targetHref: string, sourceHref: string) {
  const source = safeUrl(sourceHref);
  if (!source) return targetHref;
  const inviteCode = parseHeartRateStudioInviteHref(source.toString()).inviteCode;
  if (!inviteCode) return targetHref;
  const target = safeUrl(targetHref, source.toString());
  if (!target || target.origin !== source.origin) return targetHref;
  target.searchParams.set(heartRateStudioInviteQueryParameter, inviteCode);
  return sameShapeHref(targetHref, target);
}

/** Builds a clean, single-purpose link for opening the invitation on iPhone. */
export function heartRateStudioInviteHandoffHref(currentHref: string, inviteCode: string) {
  const current = safeUrl(currentHref);
  const normalizedCode = normalizeHeartRateStudioInviteCode(inviteCode);
  if (!current || !normalizedCode) return '';
  current.search = '';
  current.hash = '';
  current.searchParams.set(heartRateStudioInviteQueryParameter, normalizedCode);
  return current.toString();
}

export function removeHeartRateStudioInviteFromHref(href: string) {
  const url = safeUrl(href);
  if (!url || !url.searchParams.has(heartRateStudioInviteQueryParameter)) return href;
  url.searchParams.delete(heartRateStudioInviteQueryParameter);
  return sameShapeHref(href, url);
}

export function applyHeartRateStudioInviteUrlDisposition(
  disposition: HeartRateStudioInviteUrlDisposition,
) {
  if (disposition !== 'remove' || typeof window === 'undefined') return;
  const nextHref = removeHeartRateStudioInviteFromHref(window.location.href);
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextUrl = safeUrl(nextHref, window.location.href);
  const relativeNextHref = nextUrl
    ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    : nextHref;
  if (relativeNextHref !== currentHref) {
    window.history.replaceState(window.history.state, '', relativeNextHref);
  }
}

function studioInviteDispositionForStatus(status: number): HeartRateStudioInviteUrlDisposition {
  return [400, 403, 404, 409, 410, 422].includes(status) ? 'remove' : 'preserve';
}

export function heartRateStudioInviteUrlDisposition(error: unknown): HeartRateStudioInviteUrlDisposition {
  return error instanceof HeartRateStudioInviteError ? error.urlDisposition : 'preserve';
}

async function studioInvitationJsonResponse<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `${label} returned ${response.status}`;
    throw new HeartRateStudioInviteError(message, {
      status: response.status,
      urlDisposition: studioInviteDispositionForStatus(response.status),
    });
  }
  return payload;
}

async function studioInvitationFetch<T>(pathname: string, init: RequestInit, label: string) {
  try {
    const response = await fetch(pathname, init);
    return await studioInvitationJsonResponse<T>(response, label);
  } catch (error) {
    if (error instanceof HeartRateStudioInviteError) throw error;
    throw new HeartRateStudioInviteError(
      `TrackLab could not reach the studio heart-rate service. ${error instanceof Error ? error.message : ''}`.trim(),
      { urlDisposition: 'preserve' },
    );
  }
}

function normalizeStudioInvitation(value: unknown): HeartRateStudioInvitation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const clubId = identifier(item.clubId);
  const studioRiderId = identifier(item.studioRiderId);
  const sessionId = identifier(item.sessionId);
  const normalizedActivityType = activityType(item.activityType);
  const normalizedRelayScope = item.relayScope == null ? 'session' : studioRelayScope(item.relayScope);
  const expiresAt = nullableTimestamp(item.expiresAt);
  const createdAt = nullableTimestamp(item.createdAt);
  if (
    !id
    || !clubId
    || !studioRiderId
    || !sessionId
    || !normalizedActivityType
    || !normalizedRelayScope
    || expiresAt == null
    || createdAt == null
  ) return null;
  return {
    id,
    clubId,
    studioRiderId,
    sessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    playerId: playerId(item.playerId),
    expiresAt,
    claimedAt: nullableTimestamp(item.claimedAt),
    revokedAt: nullableTimestamp(item.revokedAt),
    createdAt,
  };
}

function normalizeStudioInvitationPreview(value: unknown): HeartRateStudioInvitationPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const clubName = identifier(item.clubName, 120);
  const riderName = identifier(item.riderName, 120);
  const sessionId = identifier(item.sessionId);
  const normalizedActivityType = activityType(item.activityType);
  const normalizedRelayScope = item.relayScope == null ? 'session' : studioRelayScope(item.relayScope);
  const expiresAt = nullableTimestamp(item.expiresAt);
  if (!clubName || !riderName || !sessionId || !normalizedActivityType || !normalizedRelayScope || expiresAt == null) return null;
  return {
    clubName,
    riderName,
    sessionId,
    activityType: normalizedActivityType,
    relayScope: normalizedRelayScope,
    playerId: playerId(item.playerId),
    expiresAt,
  };
}

const heartRateStudioBlockStates = new Set<HeartRateStudioBlockState>([
  'waiting-athlete',
  'waiting-watch',
  'watch-ready',
  'ended',
  'expired',
  'stopped',
]);

export function normalizeHeartRateStudioBlockStatus(value: unknown): HeartRateStudioBlockStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const invitationId = identifier(item.invitationId);
  const clubId = identifier(item.clubId);
  const studioRiderId = identifier(item.studioRiderId);
  const anchorSessionId = identifier(item.anchorSessionId);
  const normalizedActivityType = activityType(item.activityType);
  const state = typeof item.state === 'string' && heartRateStudioBlockStates.has(
    item.state as HeartRateStudioBlockState,
  ) ? item.state as HeartRateStudioBlockState : null;
  const invitationExpiresAt = nullableTimestamp(item.invitationExpiresAt);
  if (
    !invitationId
    || !clubId
    || !studioRiderId
    || !anchorSessionId
    || !normalizedActivityType
    || item.relayScope !== 'studio-block'
    || !state
    || invitationExpiresAt == null
  ) return null;
  return {
    invitationId,
    clubId,
    studioRiderId,
    anchorSessionId,
    activityType: normalizedActivityType,
    relayScope: 'studio-block',
    playerId: playerId(item.playerId),
    state,
    invitationExpiresAt,
    pairCodeExpiresAt: nullableTimestamp(item.pairCodeExpiresAt),
    blockExpiresAt: nullableTimestamp(item.blockExpiresAt),
    streamStartedAt: nullableTimestamp(item.streamStartedAt),
    lastSampleAt: nullableTimestamp(item.lastSampleAt),
    lastSampleReceivedAt: nullableTimestamp(item.lastSampleReceivedAt),
    freshUntil: nullableTimestamp(item.freshUntil),
  };
}

const heartRateAccountBlockStates = new Set<HeartRateAccountBlockState>([
  'waiting-watch',
  'live',
  'stale',
  'ended',
  'expired',
  'revoked',
]);

export function normalizeHeartRateAccountBlockStatus(value: unknown): HeartRateAccountBlockStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const pairingId = identifier(item.pairingId);
  const blockId = identifier(item.blockId);
  const state = typeof item.state === 'string' && heartRateAccountBlockStates.has(
    item.state as HeartRateAccountBlockState,
  ) ? item.state as HeartRateAccountBlockState : null;
  const pairCodeExpiresAt = nullableTimestamp(item.pairCodeExpiresAt);
  const effectiveExpiresAt = nullableTimestamp(item.effectiveExpiresAt);
  const createdAt = nullableTimestamp(item.createdAt);
  const updatedAt = nullableTimestamp(item.updatedAt);
  if (
    !pairingId
    || !blockId
    || item.relayScope !== 'account-block'
    || !state
    || pairCodeExpiresAt == null
    || effectiveExpiresAt == null
    || createdAt == null
    || updatedAt == null
  ) return null;
  return {
    pairingId,
    blockId,
    relayScope: 'account-block',
    state,
    pairCodeExpiresAt,
    ingestExpiresAt: nullableTimestamp(item.ingestExpiresAt),
    effectiveExpiresAt,
    claimedAt: nullableTimestamp(item.claimedAt),
    revokedAt: nullableTimestamp(item.revokedAt),
    stopRequestedAt: nullableTimestamp(item.stopRequestedAt),
    drainExpiresAt: nullableTimestamp(item.drainExpiresAt),
    streamStartedAt: nullableTimestamp(item.streamStartedAt),
    streamEndedAt: nullableTimestamp(item.streamEndedAt),
    lastSampleAt: nullableTimestamp(item.lastSampleAt),
    lastSampleReceivedAt: nullableTimestamp(item.lastSampleReceivedAt),
    freshUntil: nullableTimestamp(item.freshUntil),
    createdAt,
    updatedAt,
  };
}

/**
 * Expected server contract: authenticated GET returning
 * `{ invitation: { clubName, riderName, sessionId, activityType, playerId, expiresAt } }`.
 * The endpoint must verify the invitation belongs to the signed-in athlete and
 * must not return profile keys, account IDs, pair codes, or ingest credentials.
 */
export async function loadHeartRateStudioInvitationPreview(inviteCode: string) {
  const normalizedCode = normalizeHeartRateStudioInviteCode(inviteCode);
  if (!normalizedCode) {
    throw new HeartRateStudioInviteError('This studio heart-rate invitation link is invalid.', {
      status: 400,
      urlDisposition: 'remove',
    });
  }
  const params = new URLSearchParams({ code: normalizedCode });
  const payload = await studioInvitationFetch<{ invitation?: unknown }>(
    `/api/heart-rate/studio-invitations/preview?${params}`,
    { cache: 'no-store', headers: { Accept: 'application/json' } },
    'Studio heart-rate invitation preview',
  );
  const preview = normalizeStudioInvitationPreview(payload.invitation);
  if (!preview) {
    throw new HeartRateStudioInviteError('The studio heart-rate invitation preview was invalid.', {
      urlDisposition: 'preserve',
    });
  }
  return preview;
}

export async function createHeartRateStudioInvitation(
  input: CreateHeartRateStudioInvitationInput,
): Promise<HeartRateStudioInvitationHandoff> {
  const payload = await studioInvitationFetch<{
    invitation?: unknown;
    inviteCode?: unknown;
    claimUrl?: unknown;
  }>('/api/heart-rate/studio-invitations', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 'Studio heart-rate invitation');
  const invitation = normalizeStudioInvitation(payload.invitation);
  const inviteCode = normalizeHeartRateStudioInviteCode(payload.inviteCode);
  const claimUrl = typeof payload.claimUrl === 'string' && payload.claimUrl.length <= 2_048
    ? heartRateStudioInviteHandoffHref(payload.claimUrl, inviteCode)
    : '';
  if (!invitation || !inviteCode) {
    throw new HeartRateStudioInviteError('The studio heart-rate invitation response was invalid.', {
      urlDisposition: 'preserve',
    });
  }
  return { invitation, inviteCode, claimUrl: claimUrl || null };
}

export async function loadHeartRateStudioInvitations() {
  const payload = await studioInvitationFetch<{ invitations?: unknown }>(
    '/api/heart-rate/studio-invitations',
    { cache: 'no-store', headers: { Accept: 'application/json' } },
    'Studio heart-rate invitations',
  );
  return Array.isArray(payload.invitations)
    ? payload.invitations.flatMap((value) => {
      const invitation = normalizeStudioInvitation(value);
      return invitation ? [invitation] : [];
    })
    : [];
}

export async function loadHeartRateStudioBlocks(clubId: string) {
  const normalizedClubId = identifier(clubId);
  if (!normalizedClubId) throw new Error('Choose a valid TrackLab club.');
  const parameters = new URLSearchParams({ clubId: normalizedClubId });
  const payload = await studioInvitationFetch<{ blocks?: unknown }>(
    `/api/heart-rate/studio-blocks?${parameters}`,
    { cache: 'no-store', headers: { Accept: 'application/json' } },
    'Studio heart-rate readiness',
  );
  return Array.isArray(payload.blocks)
    ? payload.blocks.flatMap((value) => {
      const block = normalizeHeartRateStudioBlockStatus(value);
      return block ? [block] : [];
    })
    : [];
}

export async function stopHeartRateStudioBlock(invitationId: string) {
  const normalizedId = identifier(invitationId);
  if (!normalizedId) throw new Error('Choose a valid studio heart-rate block.');
  const payload = await studioInvitationFetch<{ block?: unknown }>(
    `/api/heart-rate/studio-blocks/${encodeURIComponent(normalizedId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
    'Studio heart-rate block stop',
  );
  const block = normalizeHeartRateStudioBlockStatus(payload.block);
  if (!block || block.state !== 'stopped') {
    throw new Error('Studio heart-rate block stop returned an invalid response.');
  }
  return block;
}

export async function createHeartRateAccountBlock(
  requestId: string,
): Promise<HeartRateAccountBlockHandoff> {
  const normalizedRequestId = requestId.trim();
  if (!/^[a-zA-Z0-9_-]{24,160}$/.test(normalizedRequestId)) {
    throw new Error('Start private Apple Watch heart rate with a new secure request ID.');
  }
  const response = await fetch('/api/heart-rate/account-blocks', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: normalizedRequestId }),
  });
  const payload = await jsonResponse<{
    block?: unknown;
    pairing?: unknown;
    pairCode?: unknown;
    replayed?: unknown;
  }>(response, 'Private account heart-rate start');
  const block = normalizeHeartRateAccountBlockStatus(payload.block);
  const pairing = normalizePairing(payload.pairing);
  const pairCode = normalizeHeartRateStudioInviteCode(payload.pairCode);
  if (
    !block
    || !pairing
    || !pairCode
    || pairing.id !== block.pairingId
    || pairing.sessionId !== block.blockId
    || pairing.activityType !== 'training-block'
    || pairing.relayScope !== 'account-block'
    || pairing.clubId != null
    || pairing.studioRiderId != null
    || pairing.liveStudioConsent
    || pairing.sessionStudioConsent
  ) throw new Error('Private account heart-rate start returned an invalid response.');
  return { block, pairing, pairCode, replayed: payload.replayed === true };
}

export async function loadHeartRateAccountBlocks() {
  const response = await fetch('/api/heart-rate/account-blocks', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await jsonResponse<{ blocks?: unknown }>(response, 'Private account heart-rate status');
  return Array.isArray(payload.blocks)
    ? payload.blocks.flatMap((value) => {
      const block = normalizeHeartRateAccountBlockStatus(value);
      return block ? [block] : [];
    })
    : [];
}

export async function recoverHeartRateAccountBlockHandoff(pairingId: string) {
  const normalizedPairingId = identifier(pairingId);
  if (!normalizedPairingId) throw new Error('Choose a valid private account heart-rate block.');
  const response = await fetch(
    `/api/heart-rate/account-blocks/${encodeURIComponent(normalizedPairingId)}/handoff`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  const payload = await jsonResponse<{ block?: unknown; pairCode?: unknown }>(
    response,
    'Private account heart-rate handoff recovery',
  );
  const block = normalizeHeartRateAccountBlockStatus(payload.block);
  const pairCode = normalizeHeartRateStudioInviteCode(payload.pairCode);
  if (
    !block
    || block.pairingId !== normalizedPairingId
    || block.relayScope !== 'account-block'
    || block.state !== 'waiting-watch'
    || !pairCode
  ) throw new Error('Private account heart-rate handoff recovery returned an invalid response.');
  return { block, pairCode };
}

export async function stopHeartRateAccountBlock(pairingId: string) {
  const normalizedPairingId = identifier(pairingId);
  if (!normalizedPairingId) throw new Error('Choose a valid private account heart-rate block.');
  const response = await fetch(
    `/api/heart-rate/account-blocks/${encodeURIComponent(normalizedPairingId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  const payload = await jsonResponse<{ block?: unknown; draining?: unknown }>(
    response,
    'Private account heart-rate stop',
  );
  const block = normalizeHeartRateAccountBlockStatus(payload.block);
  if (!block || block.pairingId !== normalizedPairingId) {
    throw new Error('Private account heart-rate stop returned an invalid response.');
  }
  return { block, draining: payload.draining === true };
}

export async function revokeHeartRateStudioInvitation(invitationId: string) {
  const normalizedId = identifier(invitationId);
  if (!normalizedId) throw new Error('Choose a valid studio heart-rate invitation.');
  await studioInvitationFetch(
    `/api/heart-rate/studio-invitations/${encodeURIComponent(normalizedId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
    'Studio heart-rate invitation cancellation',
  );
}

export type HeartRateStudioPairCodeClaim = Readonly<{
  pairing: HeartRatePairing;
  pairCode: string;
}>;

export async function claimHeartRateStudioInvitation(
  inviteCode: string,
  consent: Partial<HeartRateStudioConsent> = defaultHeartRateStudioConsent,
): Promise<HeartRateStudioPairCodeClaim> {
  const normalizedCode = normalizeHeartRateStudioInviteCode(inviteCode);
  if (!normalizedCode) {
    throw new HeartRateStudioInviteError('This studio heart-rate invitation link is invalid.', {
      status: 400,
      urlDisposition: 'remove',
    });
  }
  const normalizedConsent = normalizeHeartRateStudioConsent(consent);
  const payload = await studioInvitationFetch<{ pairing?: unknown; pairCode?: unknown }>(
    '/api/heart-rate/studio-invitations/claim',
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: normalizedCode, ...normalizedConsent }),
    },
    'Studio heart-rate invitation claim',
  );
  const pairing = normalizePairing(payload.pairing);
  const pairCode = normalizeHeartRateStudioInviteCode(payload.pairCode);
  if (!pairing || !pairCode) {
    throw new HeartRateStudioInviteError('The studio heart-rate pairing response was invalid.', {
      urlDisposition: 'remove',
    });
  }
  return { pairing, pairCode };
}

export async function claimHeartRateStudioPairCode(
  pairCode: string,
): Promise<HeartRatePairingClaim> {
  const normalizedCode = normalizeHeartRateStudioInviteCode(pairCode);
  if (!normalizedCode) {
    throw new HeartRateStudioInviteError('The Apple Watch pairing code was invalid.', {
      status: 400,
      urlDisposition: 'remove',
    });
  }
  const payload = await studioInvitationFetch<{
    ingestToken?: unknown;
    ingestExpiresAt?: unknown;
    pairing?: unknown;
  }>('/api/heart-rate/pairings/claim', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairCode: normalizedCode }),
  }, 'Apple Watch pairing claim');
  const ingestToken = typeof payload.ingestToken === 'string' ? payload.ingestToken.trim() : '';
  const pairing = normalizePairing({
    ...(payload.pairing && typeof payload.pairing === 'object' ? payload.pairing : {}),
    claimedAt: Date.now(),
    expiresAt: Date.now() + 1,
    liveStudioConsent: false,
    sessionStudioConsent: false,
    revokedAt: null,
  });
  if (!ingestToken || ingestToken.length > 8_192 || !pairing) {
    throw new HeartRateStudioInviteError('The Apple Watch pairing response was invalid.', {
      urlDisposition: 'remove',
    });
  }
  return {
    ingestToken,
    ingestExpiresAt: nullableTimestamp(payload.ingestExpiresAt),
    pairing: {
      id: pairing.id,
      sessionId: pairing.sessionId,
      activityType: pairing.activityType,
      relayScope: pairing.relayScope,
      riderId: pairing.riderId,
      playerId: pairing.playerId,
    },
  };
}

export async function claimHeartRateStudioInvitationForWatch(
  inviteCode: string,
  consent: Partial<HeartRateStudioConsent> = defaultHeartRateStudioConsent,
): Promise<HeartRateStudioRelayClaim> {
  const invitationClaim = await claimHeartRateStudioInvitation(inviteCode, consent);
  const watchClaim = await claimHeartRateStudioPairCode(invitationClaim.pairCode);
  const expected = invitationClaim.pairing;
  const actual = watchClaim.pairing;
  if (
    actual.id !== expected.id
    || actual.sessionId !== expected.sessionId
    || actual.activityType !== expected.activityType
    || actual.relayScope !== expected.relayScope
    || actual.riderId !== expected.riderId
    || actual.playerId !== expected.playerId
  ) {
    throw new HeartRateStudioInviteError('TrackLab refused a mismatched Apple Watch pairing.', {
      urlDisposition: 'remove',
    });
  }
  return {
    pairing: expected,
    ingestToken: watchClaim.ingestToken,
    ingestExpiresAt: watchClaim.ingestExpiresAt,
  };
}

export async function loadHeartRateStreams(sessionId?: string) {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  const response = await fetch(`/api/heart-rate/streams${params.size ? `?${params}` : ''}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await jsonResponse<{ streams?: unknown }>(response, 'Heart-rate streams');
  return Array.isArray(payload.streams) ? payload.streams.flatMap((item) => {
    const stream = normalizeStream(item);
    return stream ? [stream] : [];
  }) : [];
}

/**
 * Loads only the signed-in rider's private health streams for one exact
 * training-session identity. The server enforces account ownership; the exact
 * client-side filter prevents a malformed response from crossing sessions.
 */
export async function loadPrivateHeartRateSessionHistory(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || normalizedSessionId.length > 160) {
    throw new Error('A valid training session is required to load private heart rate.');
  }
  const params = new URLSearchParams({ sessionId: normalizedSessionId });
  const response = await fetch(`/api/heart-rate/streams?${params}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await jsonResponse<{ streams?: unknown; segments?: unknown }>(response, 'Private heart-rate history');
  const streams = Array.isArray(payload.streams)
    ? payload.streams.flatMap((value) => {
      const stream = normalizeStream(value);
      return stream?.sessionId === normalizedSessionId ? [stream] : [];
    })
    : [];
  const segments = Array.isArray(payload.segments)
    ? payload.segments.flatMap((value) => {
      const segment = normalizeTrainingSegment(value);
      return segment?.trainingSessionId === normalizedSessionId ? [segment] : [];
    })
    : [];
  return ([...streams, ...segments] satisfies PrivateHeartRateHistoryItem[])
    .sort((left, right) => left.startedAt - right.startedAt);
}

/** Loads consented summary-only health data for an authenticated club owner. */
export async function loadClubHeartRateSummaryHistory(clubId: string, sessionId: string) {
  const normalizedClubId = clubId.trim();
  const normalizedSessionId = sessionId.trim();
  if (
    !normalizedClubId
    || normalizedClubId.length > 160
    || !normalizedSessionId
    || normalizedSessionId.length > 160
  ) throw new Error('A valid club and training session are required to load consented heart-rate summaries.');
  const params = new URLSearchParams({ clubId: normalizedClubId, sessionId: normalizedSessionId });
  const response = await fetch(`/api/heart-rate/club-streams?${params}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await jsonResponse<{ streams?: unknown; segments?: unknown }>(response, 'Consented club heart-rate summaries');
  const streams = Array.isArray(payload.streams)
    ? payload.streams.flatMap((value) => {
      const stream = normalizeClubSummaryStream(value);
      return stream?.sessionId === normalizedSessionId ? [stream] : [];
    })
    : [];
  const segments = Array.isArray(payload.segments)
    ? payload.segments.flatMap((value) => {
      const segment = normalizeTrainingSegment(value);
      return segment?.trainingSessionId === normalizedSessionId ? [segment] : [];
    })
    : [];
  return ([...streams, ...segments] satisfies ClubHeartRateHistoryItem[])
    .sort((left, right) => left.startedAt - right.startedAt);
}

export async function loadHeartRateSamples(streamId: string) {
  const response = await fetch(`/api/heart-rate/streams/${encodeURIComponent(streamId)}/samples`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await jsonResponse<{ stream?: unknown; samples?: unknown }>(response, 'Heart-rate samples');
  const stream = normalizeStream(payload.stream);
  const samples = Array.isArray(payload.samples)
    ? payload.samples.flatMap((sample) => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return [];
      const item = sample as Record<string, unknown>;
      const sequence = finiteNumber(item.sequence);
      const recordedAt = nullableTimestamp(item.recordedAt);
      const activeElapsedMs = nullableTimestamp(item.activeElapsedMs);
      const bpm = finiteNumber(item.bpm);
      if (
        sequence == null || !Number.isSafeInteger(sequence) || sequence < 0
        || recordedAt == null || activeElapsedMs == null || bpm == null || bpm < 20 || bpm > 260
      ) return [];
      return [{
        source: 'apple-watch' as const,
        sessionId: stream?.sessionId ?? null,
        sequence,
        bpm,
        recordedAt,
        receivedAt: recordedAt,
        activeElapsedMs,
      } satisfies PrivateHeartRateSample];
    })
    : [];
  if (!stream) throw new Error('Heart-rate samples returned an invalid stream.');
  return { stream, samples };
}

export function subscribeToHeartRateLive(
  listener: (event: HeartRateLiveEvent) => void,
  options: { clubId?: string; onError?: () => void } = {},
) {
  if (typeof EventSource === 'undefined') return () => undefined;
  const params = new URLSearchParams();
  if (options.clubId) params.set('clubId', options.clubId);
  const source = new EventSource(`/api/heart-rate/live${params.size ? `?${params}` : ''}`);
  const receive = (event: MessageEvent) => {
    try {
      const normalized = normalizeHeartRateLiveEvent(JSON.parse(event.data));
      if (normalized) listener(normalized);
    } catch {
      // A malformed health event is ignored rather than shown under the wrong rider.
    }
  };
  source.addEventListener('heart-rate', receive as EventListener);
  if (options.onError) source.addEventListener('error', options.onError);
  return () => {
    source.removeEventListener('heart-rate', receive as EventListener);
    if (options.onError) source.removeEventListener('error', options.onError);
    source.close();
  };
}
