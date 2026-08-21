import { ghostLapsStorageKey } from '../data';
import type {
  GhostLap,
  GhostLapPoint,
  GhostPlaybackRider,
  GhostLapSource,
  PlayerSlot,
  RaceSummaryEntry,
  RaceZoneResult,
  TrackRouteVariantId,
} from '../types';
import { safeSetLocalStorage } from './browserStorage';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';
import {
  normalizeStraightSprintAirSetting,
  normalizeStraightSprintDistance,
  straightSprintConfigurationKey,
} from './straightSprint';

const maxStoredGhosts = 80;
const maxGhostPoints = 900;
const defaultGhostAccent = '#9ca3af';

// A ghost is a timing target, not another live player. Keep one unmistakable
// fluorescent-orange identity across every renderer so it cannot be confused
// with any of the four selectable live-rider colors.
export const ghostPlaybackColorName = 'yellow' as const;
export const ghostPlaybackAccent = '#ff6a00';
export const ghostPlaybackGlow = 'rgba(255, 106, 0, 0.92)';
export const ghostPlaybackHighlight = 'rgba(255, 183, 77, 0.88)';

function finiteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeText(value: unknown, fallback: string, maxLength = 120) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (text || fallback).slice(0, maxLength);
}

function safeSource(value: unknown): GhostLapSource {
  return value === 'friend' || value === 'top' ? value : 'personal';
}

function safeRaceSource(value: unknown, riderName: string): GhostLap['raceSource'] {
  if (value === 'live' || value === 'demo') {
    return value;
  }

  // Ghosts saved before race origin was persisted can still be separated
  // without hiding a rider's real Wattbike laps behind demo results.
  return /^demo rider\b/i.test(riderName.trim()) ? 'demo' : 'live';
}

function safeLapCount(value: unknown) {
  return Math.max(1, Math.min(20, Math.round(finiteNumber(value, 1))));
}

function routeKey(
  routeVariantId?: TrackRouteVariantId,
  lapCount = 1,
  sprintDistanceFeet?: number,
  sprintAirSetting?: number,
) {
  const variant = routeVariantId ?? 'default';
  const base = lapCount > 1 ? `${variant}:laps:${safeLapCount(lapCount)}` : variant;
  return sprintDistanceFeet != null && sprintAirSetting != null
    ? `${base}:${straightSprintConfigurationKey(sprintDistanceFeet, sprintAirSetting)}`
    : base;
}

function riderKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ghostIdentityKey(ghost: Pick<GhostLap, 'trackId' | 'routeVariantId' | 'lapCount' | 'sprintDistanceFeet' | 'sprintAirSetting' | 'ownerKey' | 'riderName'>) {
  return [
    ghost.trackId,
    routeKey(ghost.routeVariantId, ghost.lapCount, ghost.sprintDistanceFeet, ghost.sprintAirSetting),
    ghost.ownerKey,
    riderKey(ghost.riderName),
  ].join('|');
}

export function ghostRouteKey(
  trackId: string,
  routeVariantId?: TrackRouteVariantId,
  lapCount = 1,
  sprintDistanceFeet?: number,
  sprintAirSetting?: number,
) {
  return `${trackId}|${routeKey(routeVariantId, lapCount, sprintDistanceFeet, sprintAirSetting)}`;
}

function sanitizeGhostZoneResults(value: unknown): RaceZoneResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 500).filter((zone): zone is RaceZoneResult => Boolean(
    zone
    && typeof zone === 'object'
    && typeof (zone as RaceZoneResult).zoneId === 'string'
    && Array.isArray((zone as RaceZoneResult).riders),
  ));
}

function sanitizeGhostPoint(value: unknown): GhostLapPoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const point = value as Partial<GhostLapPoint>;
  const elapsedMs = Math.max(0, Math.round(finiteNumber(point.elapsedMs, Number.NaN)));
  const distanceMeters = Math.max(0, finiteNumber(point.distanceMeters, Number.NaN));
  const velocityMps = Math.max(0, finiteNumber(point.velocityMps, 0));
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(distanceMeters)) {
    return null;
  }

  return {
    elapsedMs,
    distanceMeters: Number(distanceMeters.toFixed(2)),
    velocityMps: Number(velocityMps.toFixed(2)),
    phase: point.phase === 'airborne' || point.phase === 'landing' ? point.phase : 'pedaling',
    pitch: Number(finiteNumber(point.pitch, 0).toFixed(3)),
    rank: Math.max(1, Math.round(finiteNumber(point.rank, 1))),
    actualBranches: point.actualBranches && typeof point.actualBranches === 'object'
      ? Object.fromEntries(
        Object.entries(point.actualBranches).filter(([, branch]) => branch === 'a' || branch === 'b'),
      )
      : {},
  };
}

export function sanitizeGhostLap(value: unknown): GhostLap | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<GhostLap>;
  const finishTimeMs = Math.round(finiteNumber(raw.finishTimeMs, Number.NaN));
  const points = Array.isArray(raw.points)
    ? raw.points.slice(0, maxGhostPoints).map(sanitizeGhostPoint).filter((point): point is GhostLapPoint => point != null)
    : [];

  if (!raw.id || !raw.trackId || !raw.ownerKey || !raw.riderName || !Number.isFinite(finishTimeMs) || finishTimeMs <= 0 || points.length < 2) {
    return null;
  }

  const riderName = safeText(raw.riderName, 'Rider', 80);
  const photoUrl = normalizeRiderPhotoDataUrl(raw.photoUrl);
  const hasSprintConfiguration = raw.sprintDistanceFeet != null && raw.sprintAirSetting != null;

  return {
    version: 1,
    id: safeText(raw.id, `ghost-${Date.now()}`, 180),
    trackId: safeText(raw.trackId, 'unknown-track', 140),
    trackName: safeText(raw.trackName, 'Unknown track', 140),
    ...(raw.routeVariantId === 'amateur' || raw.routeVariantId === 'pro' ? { routeVariantId: raw.routeVariantId } : {}),
    ...(hasSprintConfiguration ? {
      sprintDistanceFeet: normalizeStraightSprintDistance(raw.sprintDistanceFeet),
      sprintAirSetting: normalizeStraightSprintAirSetting(raw.sprintAirSetting),
    } : {}),
    riderName,
    ...(photoUrl ? { photoUrl } : {}),
    ownerKey: safeText(raw.ownerKey, 'local', 180),
    ownerName: safeText(raw.ownerName, 'TrackLab rider', 80),
    colorName: raw.colorName === 'red' || raw.colorName === 'blue' || raw.colorName === 'yellow' ? raw.colorName : 'lime',
    accent: safeText(raw.accent, defaultGhostAccent, 32),
    source: safeSource(raw.source),
    raceSource: safeRaceSource(raw.raceSource, riderName),
    lapCount: safeLapCount(raw.lapCount),
    finishTimeMs,
    thirtyFootTimeMs: raw.thirtyFootTimeMs == null ? null : Math.max(0, Math.round(finiteNumber(raw.thirtyFootTimeMs, 0))),
    savedAt: Math.max(0, Math.round(finiteNumber(raw.savedAt, Date.now()))),
    analyticsPublic: Boolean(raw.analyticsPublic),
    medalRank: raw.medalRank === 1 || raw.medalRank === 2 || raw.medalRank === 3 ? raw.medalRank : null,
    summary: raw.summary && typeof raw.summary === 'object' ? raw.summary as RaceSummaryEntry : null,
    zoneResults: sanitizeGhostZoneResults(raw.zoneResults),
    points: points.sort((left, right) => left.elapsedMs - right.elapsedMs),
  };
}

export function readStoredGhostLaps() {
  try {
    const stored = window.localStorage.getItem(ghostLapsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(sanitizeGhostLap)
      .filter((ghost): ghost is GhostLap => ghost?.raceSource === 'live' && ghost.source === 'personal');
  } catch {
    return [];
  }
}

export function writeStoredGhostLaps(ghosts: GhostLap[]) {
  safeSetLocalStorage(
    ghostLapsStorageKey,
    JSON.stringify(ghosts.filter((ghost) => (
      ghost.raceSource === 'live' && ghost.source === 'personal'
    )).slice(0, maxStoredGhosts)),
  );
}

export function mergeGhostLaps(currentGhosts: GhostLap[], incomingGhosts: GhostLap[]) {
  const byIdentity = new Map<string, GhostLap>();

  [...currentGhosts, ...incomingGhosts]
    .map(sanitizeGhostLap)
    .filter((ghost): ghost is GhostLap => ghost?.raceSource === 'live')
    .forEach((ghost) => {
      const key = ghostIdentityKey(ghost);
      const existing = byIdentity.get(key);
      if (
        !existing
        || ghost.finishTimeMs < existing.finishTimeMs
        || (ghost.finishTimeMs === existing.finishTimeMs && ghost.savedAt >= existing.savedAt)
      ) {
        byIdentity.set(key, ghost);
      }
    });

  return [...byIdentity.values()]
    .sort((left, right) => (
      left.trackId.localeCompare(right.trackId)
      || routeKey(left.routeVariantId, left.lapCount, left.sprintDistanceFeet, left.sprintAirSetting)
        .localeCompare(routeKey(right.routeVariantId, right.lapCount, right.sprintDistanceFeet, right.sprintAirSetting))
      || left.finishTimeMs - right.finishTimeMs
      || right.savedAt - left.savedAt
    ))
    .slice(0, maxStoredGhosts);
}

export function buildGhostLapFromRace(options: {
  summary: RaceSummaryEntry;
  points: GhostLapPoint[];
  trackId: string;
  trackName: string;
  routeVariantId?: TrackRouteVariantId;
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
  lapCount?: number;
  zoneResults?: RaceZoneResult[];
  ownerKey: string;
  ownerName: string;
  raceSource: GhostLap['raceSource'];
  player?: PlayerSlot;
  savedAt?: number;
}): GhostLap | null {
  const finishTimeMs = options.summary.finishTimeMs;
  const points = options.points
    .filter((point) => Number.isFinite(point.elapsedMs) && Number.isFinite(point.distanceMeters))
    .sort((left, right) => left.elapsedMs - right.elapsedMs);

  if (finishTimeMs == null || finishTimeMs <= 0 || points.length < 2) {
    return null;
  }

  const savedAt = options.savedAt ?? Date.now();
  const lapCount = safeLapCount(options.lapCount);
  const ghost: GhostLap = {
    version: 1,
    id: [
      'ghost',
      options.trackId,
      routeKey(options.routeVariantId, lapCount, options.sprintDistanceFeet, options.sprintAirSetting),
      options.ownerKey,
      riderKey(options.summary.riderName),
    ].join('-').replace(/[^a-zA-Z0-9:._-]/g, '-'),
    trackId: options.trackId,
    trackName: options.trackName,
    ...(options.routeVariantId ? { routeVariantId: options.routeVariantId } : {}),
    ...(options.sprintDistanceFeet != null && options.sprintAirSetting != null ? {
      sprintDistanceFeet: normalizeStraightSprintDistance(options.sprintDistanceFeet),
      sprintAirSetting: normalizeStraightSprintAirSetting(options.sprintAirSetting),
    } : {}),
    riderName: options.summary.riderName,
    ...(options.player?.photoUrl ? { photoUrl: options.player.photoUrl } : {}),
    ownerKey: options.ownerKey,
    ownerName: options.ownerName,
    colorName: options.player?.colorName ?? options.summary.colorName,
    accent: options.player?.accent ?? options.summary.accent,
    source: 'personal',
    raceSource: options.raceSource,
    lapCount,
    finishTimeMs,
    thirtyFootTimeMs: options.summary.thirtyFootTimeMs,
    savedAt,
    analyticsPublic: false,
    medalRank: null,
    summary: options.summary,
    zoneResults: options.zoneResults ?? [],
    points,
  };

  return sanitizeGhostLap(ghost);
}

export function ghostsForTrackRoute(
  ghosts: GhostLap[],
  trackId: string,
  routeVariantId?: TrackRouteVariantId,
  lapCount = 1,
  sprintDistanceFeet?: number,
  sprintAirSetting?: number,
) {
  const activeRouteKey = ghostRouteKey(trackId, routeVariantId, lapCount, sprintDistanceFeet, sprintAirSetting);
  return ghosts
    .filter((ghost) => ghostRouteKey(
      ghost.trackId,
      ghost.routeVariantId,
      ghost.lapCount,
      ghost.sprintDistanceFeet,
      ghost.sprintAirSetting,
    ) === activeRouteKey)
    .sort((left, right) => left.finishTimeMs - right.finishTimeMs || right.savedAt - left.savedAt);
}

export function playbackGhostLap(ghost: GhostLap, elapsedMs: number, index: number): GhostPlaybackRider | null {
  const points = ghost.points;
  if (points.length === 0) {
    return null;
  }

  const safeElapsedMs = Math.max(0, elapsedMs);
  const playbackColorName = ghostPlaybackColorName;
  const playbackAccent = ghostPlaybackAccent;
  if (safeElapsedMs === 0) {
    return {
      id: ghost.id,
      name: ghost.riderName,
      colorName: playbackColorName,
      accent: playbackAccent,
      distance: 0,
      velocity: 0,
      phase: 'pedaling',
      pitch: 0,
      rank: index + 1,
      finishedAt: null,
      actualBranches: points[0].actualBranches,
    };
  }

  if (safeElapsedMs >= ghost.finishTimeMs) {
    const lastPoint = points[points.length - 1];
    return {
      id: ghost.id,
      name: ghost.riderName,
      colorName: playbackColorName,
      accent: playbackAccent,
      distance: lastPoint.distanceMeters,
      velocity: 0,
      phase: lastPoint.phase,
      pitch: lastPoint.pitch,
      rank: lastPoint.rank || index + 1,
      finishedAt: ghost.finishTimeMs,
      actualBranches: lastPoint.actualBranches,
    };
  }

  let upperIndex = points.findIndex((point) => point.elapsedMs >= safeElapsedMs);
  if (upperIndex <= 0) {
    const firstPoint = points[0];
    return {
      id: ghost.id,
      name: ghost.riderName,
      colorName: playbackColorName,
      accent: playbackAccent,
      distance: firstPoint.distanceMeters,
      velocity: firstPoint.velocityMps,
      phase: firstPoint.phase,
      pitch: firstPoint.pitch,
      rank: firstPoint.rank || index + 1,
      finishedAt: null,
      actualBranches: firstPoint.actualBranches,
    };
  }

  const before = points[upperIndex - 1];
  const after = points[upperIndex] ?? points[points.length - 1];

  const spanMs = Math.max(1, after.elapsedMs - before.elapsedMs);
  const progress = Math.max(0, Math.min(1, (safeElapsedMs - before.elapsedMs) / spanMs));
  const distance = before.distanceMeters + ((after.distanceMeters - before.distanceMeters) * progress);
  const velocity = before.velocityMps + ((after.velocityMps - before.velocityMps) * progress);
  const pitch = before.pitch + ((after.pitch - before.pitch) * progress);

  return {
    id: ghost.id,
    name: ghost.riderName,
    colorName: playbackColorName,
    accent: playbackAccent,
    distance,
    velocity,
    phase: after.phase,
    pitch,
    rank: after.rank || index + 1,
    finishedAt: null,
    actualBranches: after.actualBranches,
  };
}

export async function loadGhostLapsFromCloud(
  trackId: string,
  profileKey: string,
  friendKeys: string[],
  sprintConfiguration?: { distanceFeet: number; airSetting: number },
  focusedFriendGhost?: { ghostId: string; profileId: string },
) {
  const params = new URLSearchParams({ trackId, profileKey });
  if (friendKeys.length > 0) {
    params.set('friendKeys', friendKeys.join(','));
  }
  if (sprintConfiguration) {
    params.set('sprintDistanceFeet', String(normalizeStraightSprintDistance(sprintConfiguration.distanceFeet)));
    params.set('sprintAirSetting', String(normalizeStraightSprintAirSetting(sprintConfiguration.airSetting)));
  }
  if (focusedFriendGhost?.ghostId && focusedFriendGhost.profileId) {
    params.set('friendGhostId', focusedFriendGhost.ghostId);
    params.set('friendProfileId', focusedFriendGhost.profileId);
  }

  const response = await fetch(`/api/ghosts?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Ghost request returned ${response.status}`);
  }

  const payload = await response.json() as { ghosts?: unknown[] };
  return Array.isArray(payload.ghosts)
    ? payload.ghosts.map(sanitizeGhostLap).filter((ghost): ghost is GhostLap => ghost != null)
    : [];
}

export async function syncGhostLapToCloud(ghost: GhostLap, profileKey: string) {
  const response = await fetch('/api/ghosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileKey, ghost }),
  });

  if (!response.ok) {
    throw new Error(`Ghost sync returned ${response.status}`);
  }
}
