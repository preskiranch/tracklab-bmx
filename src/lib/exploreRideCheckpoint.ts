import type {
  ExploreRideAuthorizationReferences,
  ExploreRider,
  ExploreRideSessionArm,
  ExploreRideStudioBinding,
  ExploreRoute,
  PlayerColorName,
  PlayerSlot,
} from '../types';
import type { HeartRateActiveClockSegment } from './heartRate';
import { sanitizeRecentExploreRoute } from './exploreRecentRoutes';
import { sanitizeClubOwnerTrainingCheckpoint } from './clubOwnerTrainingCoordinator';
import {
  acceptedBikeCadenceRpm,
  acceptedTrainingSpeedKph,
} from './bikeSampleSanity';
import { canonicalPlayerAccent } from './playerPalette';

const exploreRideCheckpointStoragePrefix = 'tracklab-explore-ride-checkpoint-v1';
const validPlayerIds = new Set<PlayerSlot['id']>([1, 2, 3, 4]);
const validColorNames = new Set<PlayerColorName>(['lime', 'red', 'blue', 'yellow']);

export type ExploreRideCheckpoint = {
  version: 1;
  route: ExploreRoute;
  riders: ExploreRider[];
  elapsedMs: number;
  savedAt: number;
  /** Stable across pause, backgrounding, and a full app relaunch. */
  sessionId?: string;
  /** Immutable wall-clock provenance for the ride. */
  startedAt?: number;
  /** Active-only clock used to align private Apple Watch samples. */
  activeClockSegments?: HeartRateActiveClockSegment[];
  /**
   * Allow-listed, non-secret club authorization references and their immutable
   * bike assignments. Bearer tokens are never part of a checkpoint.
   */
  studioBinding?: ExploreRideStudioBinding;
};

export type ExploreRideCheckpointInput = Omit<ExploreRideCheckpoint, 'savedAt' | 'version'> & {
  savedAt?: number;
};

function storageKey(profileKey: string) {
  return `${exploreRideCheckpointStoragePrefix}:${encodeURIComponent(profileKey.trim())}`;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeSessionId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 && /^[a-zA-Z0-9:._-]+$/u.test(normalized)
    ? normalized
    : undefined;
}

function sanitizeReferenceId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 180 && /^[a-zA-Z0-9:._-]+$/u.test(normalized)
    ? normalized
    : undefined;
}

function sanitizeActiveClockSegments(
  value: unknown,
  elapsedMs: number,
  savedAt: number,
): HeartRateActiveClockSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments: HeartRateActiveClockSegment[] = [];
  let previousEnd = 0;
  let previousElapsedStart = -1;
  for (const candidate of value.slice(0, 256)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const raw = candidate as Partial<HeartRateActiveClockSegment>;
    const startedAt = Math.round(finiteNumber(raw.startedAt, -1));
    const activeElapsedAtStartMs = Math.round(finiteNumber(raw.activeElapsedAtStartMs, -1));
    const rawEndedAt = raw.endedAt == null ? savedAt : Math.round(finiteNumber(raw.endedAt, -1));
    const endedAt = Math.min(savedAt, rawEndedAt);
    if (
      startedAt < 0
      || endedAt < startedAt
      || startedAt < previousEnd
      || activeElapsedAtStartMs < previousElapsedStart
      || activeElapsedAtStartMs > elapsedMs
    ) return undefined;
    segments.push({ startedAt, endedAt, activeElapsedAtStartMs });
    previousEnd = endedAt;
    previousElapsedStart = activeElapsedAtStartMs;
  }
  return segments.length > 0 ? segments : undefined;
}

function sanitizeRider(value: unknown, route: ExploreRoute): ExploreRider | null {
  const rider = value as Partial<ExploreRider> | null;
  const playerId = Number(rider?.playerId) as PlayerSlot['id'];
  if (
    !rider
    || typeof rider.id !== 'string'
    || !rider.id.trim()
    || typeof rider.clientId !== 'string'
    || !rider.clientId.trim()
    || !validPlayerIds.has(playerId)
    || typeof rider.name !== 'string'
    || !rider.name.trim()
    || !validColorNames.has(rider.colorName as PlayerColorName)
    || typeof rider.accent !== 'string'
    || !rider.accent.trim()
  ) {
    return null;
  }

  const cadence = rider.cadence == null ? null : acceptedBikeCadenceRpm(rider.cadence);
  const cadenceWasRejected = rider.cadence != null && cadence == null;
  const velocityMps = finiteNumber(rider.velocityMps);
  const velocityWasRejected = acceptedTrainingSpeedKph(velocityMps * 3.6) == null;
  if (cadenceWasRejected || velocityWasRejected) return null;
  const recommendedAirSetting = rider.recommendedAirSetting == null
    ? undefined
    : Math.max(1, Math.min(10, Math.round(finiteNumber(rider.recommendedAirSetting, 1))));
  const finishedAt = rider.finishedAt == null
    ? null
    : Math.max(0, finiteNumber(rider.finishedAt));

  return {
    id: rider.id.slice(0, 180),
    clientId: rider.clientId.slice(0, 120),
    playerId,
    ...(typeof rider.riderId === 'string' && rider.riderId.trim()
      ? { riderId: rider.riderId.slice(0, 180) }
      : {}),
    name: rider.name.slice(0, 120),
    ...(typeof rider.photoUrl === 'string' && rider.photoUrl.trim()
      ? { photoUrl: rider.photoUrl.slice(0, 2_000) }
      : {}),
    colorName: rider.colorName as PlayerColorName,
    accent: canonicalPlayerAccent(rider.colorName as PlayerColorName, rider.accent.slice(0, 80)),
    distanceMeters: Math.max(0, Math.min(route.distanceMeters, finiteNumber(rider.distanceMeters))),
    velocityMps,
    cadence,
    watts: Math.max(0, Math.min(5_000, finiteNumber(rider.watts))),
    signal: Math.max(0, Math.min(1, finiteNumber(rider.signal))),
    ...(recommendedAirSetting == null ? {} : { recommendedAirSetting }),
    finishedAt,
    at: Math.max(0, finiteNumber(rider.at)),
  };
}

function sanitizeStudioBinding(
  value: unknown,
  riders: readonly ExploreRider[],
  sessionId?: string,
): ExploreRideStudioBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ExploreRideStudioBinding>;
  if (
    !Array.isArray(candidate.riders)
    || candidate.riders.length < 1
    || candidate.riders.length > 4
  ) {
    return undefined;
  }

  const seenPlayers = new Set<PlayerSlot['id']>();
  const seenDevices = new Set<number>();
  const sanitizedRiders: Array<ExploreRideStudioBinding['riders'][number]> = [];
  for (const rawValue of candidate.riders) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return undefined;
    const raw = rawValue as Partial<ExploreRideStudioBinding['riders'][number]>;
    const playerId = Number(raw.playerId) as PlayerSlot['id'];
    const deviceId = Number(raw.deviceId);
    const riderName = typeof raw.riderName === 'string' ? raw.riderName.trim().slice(0, 120) : '';
    const riderId = typeof raw.riderId === 'string' && raw.riderId.trim()
      ? raw.riderId.trim().slice(0, 180)
      : undefined;
    const deviceLabel = typeof raw.deviceLabel === 'string' && raw.deviceLabel.trim()
      ? raw.deviceLabel.trim().slice(0, 180)
      : undefined;
    const authorizationId = raw.authorizationId == null
      ? undefined
      : sanitizeReferenceId(raw.authorizationId);
    const matchingRider = riders.find((rider) => rider.playerId === playerId);
    if (
      !validPlayerIds.has(playerId)
      || !Number.isSafeInteger(deviceId)
      || deviceId < 0
      || !riderName
      || seenPlayers.has(playerId)
      || seenDevices.has(deviceId)
      || !matchingRider
      || (matchingRider.riderId ?? undefined) !== riderId
      || matchingRider.name !== riderName
      || (raw.authorizationId != null && !authorizationId)
    ) {
      return undefined;
    }
    seenPlayers.add(playerId);
    seenDevices.add(deviceId);
    sanitizedRiders.push({
      playerId,
      ...(riderId ? { riderId } : {}),
      riderName,
      deviceId,
      ...(deviceLabel ? { deviceLabel } : {}),
      ...(authorizationId ? { authorizationId } : {}),
    });
  }

  const authorizationGroupId = candidate.authorizationGroupId == null
    ? undefined
    : sanitizeReferenceId(candidate.authorizationGroupId);
  if (candidate.authorizationGroupId != null && !authorizationGroupId) return undefined;
  const authorizationCheckpoint = candidate.authorizationCheckpoint == null
    ? undefined
    : sanitizeClubOwnerTrainingCheckpoint(candidate.authorizationCheckpoint);
  if (candidate.authorizationCheckpoint != null && !authorizationCheckpoint) return undefined;
  if (authorizationCheckpoint) {
    if (
      authorizationCheckpoint.authorization.id !== authorizationGroupId
      || authorizationCheckpoint.request.sessionId !== sessionId
      || authorizationCheckpoint.request.activityType !== 'explore'
    ) return undefined;
    const expectedByPlayer = new Map(authorizationCheckpoint.authorization.assignments.map((assignment) => (
      [assignment.playerId, assignment]
    )));
    if (
      expectedByPlayer.size !== authorizationCheckpoint.request.assignments.length
      || sanitizedRiders.length !== authorizationCheckpoint.request.assignments.length
      || authorizationCheckpoint.request.assignments.some((requestAssignment) => {
        const expected = expectedByPlayer.get(requestAssignment.playerId);
        const rider = sanitizedRiders.find((candidate) => candidate.playerId === requestAssignment.playerId);
        return !expected
          || !rider
          || rider.authorizationId !== expected.id
          || rider.riderId !== expected.studioRiderId
          || String(rider.deviceId) !== expected.bikeDeviceId;
      })
    ) return undefined;
  }
  return {
    ...(authorizationGroupId ? { authorizationGroupId } : {}),
    ...(authorizationCheckpoint ? { authorizationCheckpoint } : {}),
    riders: sanitizedRiders,
  };
}

function defaultExploreRideNonce() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/** Allocates a stable ID and freezes the exact 1-4 athlete/bike assignments. */
export function createExploreRideSessionArm(
  route: ExploreRoute,
  riders: readonly ExploreRider[],
  players: readonly PlayerSlot[],
  armedAt = Date.now(),
  createNonce: () => string = defaultExploreRideNonce,
): ExploreRideSessionArm | null {
  if (
    riders.length < 1
    || riders.length > 4
    || !Number.isSafeInteger(armedAt)
    || armedAt < 0
  ) return null;
  const nonce = createNonce().trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/u.test(nonce)) return null;

  const seenPlayers = new Set<PlayerSlot['id']>();
  const seenDevices = new Set<number>();
  const riderBindings = riders.flatMap((rider) => {
    const player = players.find((candidate) => candidate.id === rider.playerId);
    if (
      !player
      || player.deviceId == null
      || seenPlayers.has(player.id)
      || seenDevices.has(player.deviceId)
      || (player.riderId ?? undefined) !== (rider.riderId ?? undefined)
    ) return [];
    seenPlayers.add(player.id);
    seenDevices.add(player.deviceId);
    return [Object.freeze({
      playerId: player.id,
      ...(rider.riderId ? { riderId: rider.riderId } : {}),
      riderName: rider.name,
      deviceId: player.deviceId,
      ...(player.deviceLabel ? { deviceLabel: player.deviceLabel } : {}),
    })];
  });
  if (riderBindings.length !== riders.length) return null;
  return Object.freeze({
    sessionId: `explore:${nonce}`,
    route,
    armedAt,
    riderBindings: Object.freeze(riderBindings),
  });
}

export function exploreRideSessionArmMatches(
  arm: ExploreRideSessionArm,
  route: ExploreRoute | null | undefined,
  riders: readonly ExploreRider[],
  players: readonly PlayerSlot[],
) {
  if (route?.id !== arm.route.id || riders.length !== arm.riderBindings.length) return false;
  return arm.riderBindings.every((binding) => {
    const rider = riders.find((candidate) => candidate.playerId === binding.playerId);
    const player = players.find((candidate) => candidate.id === binding.playerId);
    return Boolean(
      rider
      && player
      && player.deviceId === binding.deviceId
      && (rider.riderId ?? null) === (binding.riderId ?? null)
      && (player.riderId ?? null) === (binding.riderId ?? null)
      && rider.name === binding.riderName,
    );
  });
}

/**
 * Combines non-secret authorization IDs with the arm snapshot. Callers retain
 * any bearer token in memory and can recover it after reload using these IDs.
 */
export function createExploreRideStudioBinding(
  arm: ExploreRideSessionArm,
  references?: ExploreRideAuthorizationReferences | null,
): ExploreRideStudioBinding | null {
  if (!references) return null;
  const authorizationByPlayer = new Map(
    references.riders.map((rider) => [rider.playerId, sanitizeReferenceId(rider.authorizationId)]),
  );
  if (
    !sanitizeReferenceId(references.authorizationGroupId)
    || references.riders.length < 1
    || references.riders.length > arm.riderBindings.length
    || authorizationByPlayer.size !== references.riders.length
    || [...authorizationByPlayer].some(([playerId, authorizationId]) => (
      !authorizationId || !arm.riderBindings.some((binding) => binding.playerId === playerId)
    ))
  ) return null;

  const authorizationCheckpoint = references.authorizationCheckpoint == null
    ? undefined
    : sanitizeClubOwnerTrainingCheckpoint(references.authorizationCheckpoint);
  if (references.authorizationCheckpoint != null && !authorizationCheckpoint) return null;
  if (authorizationCheckpoint && (
    authorizationCheckpoint.authorization.id !== references.authorizationGroupId
    || authorizationCheckpoint.request.sessionId !== arm.sessionId
    || authorizationCheckpoint.request.activityType !== 'explore'
    || authorizationCheckpoint.request.assignments.length !== authorizationByPlayer.size
    || authorizationCheckpoint.request.assignments.some((assignment) => (
      authorizationByPlayer.get(assignment.playerId) !== authorizationCheckpoint.authorization.assignments
        .find((candidate) => candidate.playerId === assignment.playerId)?.id
    ))
  )) return null;

  return Object.freeze({
    authorizationGroupId: references.authorizationGroupId.trim(),
    ...(authorizationCheckpoint ? { authorizationCheckpoint } : {}),
    riders: Object.freeze(arm.riderBindings.flatMap((binding) => {
      const authorizationId = authorizationByPlayer.get(binding.playerId);
      return authorizationId ? [Object.freeze({ ...binding, authorizationId })] : [];
    })),
  });
}

export function sanitizeExploreRideCheckpoint(value: unknown): ExploreRideCheckpoint | null {
  const checkpoint = value as Partial<ExploreRideCheckpoint> | null;
  const route = sanitizeRecentExploreRoute(checkpoint?.route);
  if (checkpoint?.version !== 1 || !route || !Array.isArray(checkpoint.riders)) {
    return null;
  }

  const riderCandidates = checkpoint.riders.slice(0, 4);
  const riders = riderCandidates
    .flatMap((candidate) => {
      const rider = sanitizeRider(candidate, route);
      return rider ? [rider] : [];
    })
  ;
  const elapsedMs = Math.max(0, finiteNumber(checkpoint.elapsedMs));
  const savedAt = Math.max(0, finiteNumber(checkpoint.savedAt));
  const sessionId = sanitizeSessionId(checkpoint.sessionId);
  const startedAtCandidate = checkpoint.startedAt == null
    ? undefined
    : Math.round(finiteNumber(checkpoint.startedAt, -1));
  const startedAt = startedAtCandidate != null && startedAtCandidate >= 0 && startedAtCandidate <= savedAt
    ? startedAtCandidate
    : undefined;
  const activeClockSegments = sanitizeActiveClockSegments(
    checkpoint.activeClockSegments,
    elapsedMs,
    savedAt,
  );
  const studioBinding = sanitizeStudioBinding(checkpoint.studioBinding, riders, sessionId);
  if (
    riders.length === 0
    || riders.length !== riderCandidates.length
    || savedAt <= 0
    || riders.every((rider) => rider.distanceMeters >= route.distanceMeters - 0.01)
  ) {
    return null;
  }

  return {
    version: 1,
    route,
    riders,
    elapsedMs,
    savedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(startedAt != null ? { startedAt } : {}),
    ...(activeClockSegments ? { activeClockSegments } : {}),
    ...(studioBinding ? { studioBinding } : {}),
  };
}

export function loadExploreRideCheckpoint(profileKey: string) {
  if (!profileKey.trim()) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(storageKey(profileKey));
    return stored ? sanitizeExploreRideCheckpoint(JSON.parse(stored) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveExploreRideCheckpoint(
  profileKey: string,
  input: ExploreRideCheckpointInput,
) {
  if (!profileKey.trim()) {
    return null;
  }
  const checkpoint = sanitizeExploreRideCheckpoint({
    ...input,
    savedAt: input.savedAt ?? Date.now(),
    version: 1,
  });
  if (!checkpoint) {
    return null;
  }
  try {
    window.localStorage.setItem(storageKey(profileKey), JSON.stringify(checkpoint));
  } catch {
    // An active ride remains usable when private browsing or storage pressure
    // prevents durable checkpoints.
  }
  return checkpoint;
}

export function clearExploreRideCheckpoint(profileKey: string) {
  if (!profileKey.trim()) {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(profileKey));
  } catch {
    // Resetting the in-memory ride must not depend on browser storage.
  }
}
