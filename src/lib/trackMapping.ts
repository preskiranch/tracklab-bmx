import type { TrackPoint, TrackRecord, TrackZone, UserTrackMapping } from '../types';

export const trackMappingStorageKey = 'tracklab:user-track-mappings:v1';

export type StoredTrackMappings = Record<string, UserTrackMapping>;

function roundCoordinate(value: number) {
  return Number(value.toFixed(7));
}

export function distanceBetweenTrackPoints(a: TrackPoint, b: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((b.lng - a.lng) * lngScale, (b.lat - a.lat) * latScale);
}

export function routeLengthMeters(points: TrackPoint[]) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenTrackPoints(points[index - 1], points[index]);
  }

  return total;
}

function cumulativeMeters(points: TrackPoint[]) {
  const distances = [0];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenTrackPoints(points[index - 1], points[index]);
    distances.push(total);
  }

  return distances;
}

function normalizePoint(point: TrackPoint): TrackPoint {
  return {
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
  };
}

export function createUserTrackMapping(
  track: TrackRecord,
  points: TrackPoint[],
  restAfterSeconds: number,
): UserTrackMapping {
  const centerline = points.map(normalizePoint);
  const distances = cumulativeMeters(centerline);
  const lengthMeters = Math.max(1, distances[distances.length - 1] ?? track.lengthMeters);
  const zones: TrackZone[] = centerline.slice(1).map((_, index) => ({
    id: `user-zone-${index + 1}`,
    name: `Sprint ${index + 1}`,
    startMeter: Math.round(distances[index]),
    endMeter: Math.max(Math.round(distances[index] + 1), Math.round(distances[index + 1])),
    type: 'pedal',
    restAfterSeconds: index === centerline.length - 2 ? 0 : restAfterSeconds,
  }));

  return {
    version: 1,
    trackId: track.id,
    trackName: track.name,
    country: track.country,
    state: track.state,
    savedAt: new Date().toISOString(),
    routeStatus: 'user-mapped',
    restAfterSeconds,
    lengthMeters: Math.round(lengthMeters),
    centerline,
    startGate: centerline[0],
    finishLine: centerline[centerline.length - 1],
    zones,
  };
}

export function applyUserTrackMapping(track: TrackRecord, mapping: UserTrackMapping): TrackRecord {
  return {
    ...track,
    lengthMeters: mapping.lengthMeters,
    outline: mapping.centerline,
    centerline: mapping.centerline,
    startGate: mapping.startGate,
    finishLine: mapping.finishLine,
    routeStatus: 'user-mapped',
    zones: mapping.zones,
  };
}

export function readStoredTrackMappings(): StoredTrackMappings {
  try {
    const stored = window.localStorage.getItem(trackMappingStorageKey);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as StoredTrackMappings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoredTrackMappings(mappings: StoredTrackMappings) {
  window.localStorage.setItem(trackMappingStorageKey, JSON.stringify(mappings));
}

export function parseUserTrackMapping(value: string): UserTrackMapping {
  const parsed = JSON.parse(value) as Partial<UserTrackMapping>;

  if (
    parsed.version !== 1
    || typeof parsed.trackId !== 'string'
    || typeof parsed.trackName !== 'string'
    || !Array.isArray(parsed.centerline)
    || parsed.centerline.length < 2
    || !Array.isArray(parsed.zones)
  ) {
    throw new Error('Mapping file is not a TrackLab BMX mapping.');
  }

  return parsed as UserTrackMapping;
}
