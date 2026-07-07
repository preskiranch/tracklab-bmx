import { ghostLapsStorageKey } from '../data';
import type {
  GhostLap,
  GhostLapPoint,
  GhostPlaybackRider,
  GhostLapSource,
  PlayerSlot,
  RaceSummaryEntry,
  TrackRouteVariantId,
} from '../types';

const maxStoredGhosts = 80;
const maxGhostPoints = 900;
const defaultGhostAccent = '#9ca3af';

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

function routeKey(routeVariantId?: TrackRouteVariantId) {
  return routeVariantId ?? 'default';
}

function riderKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ghostIdentityKey(ghost: Pick<GhostLap, 'trackId' | 'routeVariantId' | 'ownerKey' | 'riderName'>) {
  return [
    ghost.trackId,
    routeKey(ghost.routeVariantId),
    ghost.ownerKey,
    riderKey(ghost.riderName),
  ].join('|');
}

export function ghostRouteKey(trackId: string, routeVariantId?: TrackRouteVariantId) {
  return `${trackId}|${routeKey(routeVariantId)}`;
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

  return {
    version: 1,
    id: safeText(raw.id, `ghost-${Date.now()}`, 180),
    trackId: safeText(raw.trackId, 'unknown-track', 140),
    trackName: safeText(raw.trackName, 'Unknown track', 140),
    ...(raw.routeVariantId === 'amateur' || raw.routeVariantId === 'pro' ? { routeVariantId: raw.routeVariantId } : {}),
    riderName: safeText(raw.riderName, 'Rider', 80),
    ownerKey: safeText(raw.ownerKey, 'local', 180),
    ownerName: safeText(raw.ownerName, 'TrackLab rider', 80),
    colorName: raw.colorName === 'red' || raw.colorName === 'blue' || raw.colorName === 'yellow' ? raw.colorName : 'lime',
    accent: safeText(raw.accent, defaultGhostAccent, 32),
    source: safeSource(raw.source),
    finishTimeMs,
    thirtyFootTimeMs: raw.thirtyFootTimeMs == null ? null : Math.max(0, Math.round(finiteNumber(raw.thirtyFootTimeMs, 0))),
    savedAt: Math.max(0, Math.round(finiteNumber(raw.savedAt, Date.now()))),
    summary: raw.summary as RaceSummaryEntry,
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

    return parsed.map(sanitizeGhostLap).filter((ghost): ghost is GhostLap => ghost != null);
  } catch {
    return [];
  }
}

export function writeStoredGhostLaps(ghosts: GhostLap[]) {
  window.localStorage.setItem(ghostLapsStorageKey, JSON.stringify(ghosts.slice(0, maxStoredGhosts)));
}

export function mergeGhostLaps(currentGhosts: GhostLap[], incomingGhosts: GhostLap[]) {
  const byIdentity = new Map<string, GhostLap>();

  [...currentGhosts, ...incomingGhosts]
    .map(sanitizeGhostLap)
    .filter((ghost): ghost is GhostLap => ghost != null)
    .forEach((ghost) => {
      const key = ghostIdentityKey(ghost);
      const existing = byIdentity.get(key);
      if (
        !existing
        || ghost.finishTimeMs < existing.finishTimeMs
        || (ghost.finishTimeMs === existing.finishTimeMs && ghost.savedAt > existing.savedAt)
      ) {
        byIdentity.set(key, ghost);
      }
    });

  return [...byIdentity.values()]
    .sort((left, right) => (
      left.trackId.localeCompare(right.trackId)
      || routeKey(left.routeVariantId).localeCompare(routeKey(right.routeVariantId))
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
  ownerKey: string;
  ownerName: string;
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
  const ghost: GhostLap = {
    version: 1,
    id: [
      'ghost',
      options.trackId,
      routeKey(options.routeVariantId),
      options.ownerKey,
      riderKey(options.summary.riderName),
    ].join('-').replace(/[^a-zA-Z0-9:._-]/g, '-'),
    trackId: options.trackId,
    trackName: options.trackName,
    ...(options.routeVariantId ? { routeVariantId: options.routeVariantId } : {}),
    riderName: options.summary.riderName,
    ownerKey: options.ownerKey,
    ownerName: options.ownerName,
    colorName: options.player?.colorName ?? options.summary.colorName,
    accent: options.player?.accent ?? options.summary.accent,
    source: 'personal',
    finishTimeMs,
    thirtyFootTimeMs: options.summary.thirtyFootTimeMs,
    savedAt,
    summary: options.summary,
    points,
  };

  return sanitizeGhostLap(ghost);
}

export function ghostsForTrackRoute(ghosts: GhostLap[], trackId: string, routeVariantId?: TrackRouteVariantId) {
  const activeRouteKey = ghostRouteKey(trackId, routeVariantId);
  return ghosts
    .filter((ghost) => ghostRouteKey(ghost.trackId, ghost.routeVariantId) === activeRouteKey)
    .sort((left, right) => {
      const sourceOrder = { personal: 0, friend: 1, top: 2 } satisfies Record<GhostLapSource, number>;
      return sourceOrder[left.source] - sourceOrder[right.source] || left.finishTimeMs - right.finishTimeMs;
    });
}

export function playbackGhostLap(ghost: GhostLap, elapsedMs: number, index: number): GhostPlaybackRider | null {
  const points = ghost.points;
  if (points.length === 0) {
    return null;
  }

  const safeElapsedMs = Math.max(0, elapsedMs);
  if (safeElapsedMs >= ghost.finishTimeMs) {
    const lastPoint = points[points.length - 1];
    return {
      id: ghost.id,
      name: ghost.riderName,
      colorName: ghost.colorName,
      accent: ghost.accent,
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
      colorName: ghost.colorName,
      accent: ghost.accent,
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
    colorName: ghost.colorName,
    accent: ghost.accent,
    distance,
    velocity,
    phase: after.phase,
    pitch,
    rank: after.rank || index + 1,
    finishedAt: null,
    actualBranches: after.actualBranches,
  };
}

export async function loadGhostLapsFromCloud(trackId: string, profileKey: string, friendKeys: string[]) {
  const params = new URLSearchParams({ trackId, profileKey });
  if (friendKeys.length > 0) {
    params.set('friendKeys', friendKeys.join(','));
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
