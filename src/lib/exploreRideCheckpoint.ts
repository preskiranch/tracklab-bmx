import type { ExploreRider, ExploreRoute, PlayerColorName, PlayerSlot } from '../types';
import { sanitizeRecentExploreRoute } from './exploreRecentRoutes';

const exploreRideCheckpointStoragePrefix = 'tracklab-explore-ride-checkpoint-v1';
const validPlayerIds = new Set<PlayerSlot['id']>([1, 2, 3, 4]);
const validColorNames = new Set<PlayerColorName>(['lime', 'red', 'blue', 'yellow']);

export type ExploreRideCheckpoint = {
  version: 1;
  route: ExploreRoute;
  riders: ExploreRider[];
  elapsedMs: number;
  savedAt: number;
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

  const cadence = rider.cadence == null
    ? null
    : Math.max(0, Math.min(400, finiteNumber(rider.cadence)));
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
    accent: rider.accent.slice(0, 80),
    distanceMeters: Math.max(0, Math.min(route.distanceMeters, finiteNumber(rider.distanceMeters))),
    velocityMps: Math.max(0, Math.min(50, finiteNumber(rider.velocityMps))),
    cadence,
    watts: Math.max(0, Math.min(5_000, finiteNumber(rider.watts))),
    signal: Math.max(0, Math.min(1, finiteNumber(rider.signal))),
    ...(recommendedAirSetting == null ? {} : { recommendedAirSetting }),
    finishedAt,
    at: Math.max(0, finiteNumber(rider.at)),
  };
}

export function sanitizeExploreRideCheckpoint(value: unknown): ExploreRideCheckpoint | null {
  const checkpoint = value as Partial<ExploreRideCheckpoint> | null;
  const route = sanitizeRecentExploreRoute(checkpoint?.route);
  if (checkpoint?.version !== 1 || !route || !Array.isArray(checkpoint.riders)) {
    return null;
  }

  const riders = checkpoint.riders
    .flatMap((candidate) => {
      const rider = sanitizeRider(candidate, route);
      return rider ? [rider] : [];
    })
    .slice(0, 4);
  const elapsedMs = Math.max(0, finiteNumber(checkpoint.elapsedMs));
  const savedAt = Math.max(0, finiteNumber(checkpoint.savedAt));
  if (
    riders.length === 0
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
