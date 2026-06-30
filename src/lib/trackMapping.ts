import type { TrackPoint, TrackRecord, TrackZone, UserTrackMapping } from '../types';

export const trackMappingStorageKey = 'tracklab:user-track-mappings:v1';

export type StoredTrackMappings = Record<string, UserTrackMapping>;

const earthRadiusMeters = 6371008.8;

function roundCoordinate(value: number) {
  return Number(value.toFixed(7));
}

export function distanceBetweenTrackPoints(a: TrackPoint, b: TrackPoint) {
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const deltaLat = (b.lat - a.lat) * (Math.PI / 180);
  const deltaLng = (b.lng - a.lng) * (Math.PI / 180);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
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

function sortedUniqueBoundaries(boundaries: number[], totalMeters: number) {
  const rounded = boundaries
    .map((boundary) => Math.round(boundary))
    .filter((boundary) => boundary > 1 && boundary < totalMeters - 1)
    .sort((a, b) => a - b);

  return rounded.filter((boundary, index) => index === 0 || Math.abs(boundary - rounded[index - 1]) >= 3);
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
  zoneBoundaryMeters: number[] = [],
): UserTrackMapping {
  const centerline = points.map(normalizePoint);
  const distances = cumulativeMeters(centerline);
  const lengthMeters = Math.max(1, distances[distances.length - 1] ?? track.lengthMeters);
  const cleanBoundaries = sortedUniqueBoundaries(zoneBoundaryMeters, lengthMeters);
  const zoneBreaks = [0, ...cleanBoundaries, Math.round(lengthMeters)];
  const zones: TrackZone[] = zoneBreaks.slice(1).map((boundary, index) => ({
    id: `user-zone-${index + 1}`,
    name: `Sprint ${index + 1}`,
    startMeter: zoneBreaks[index],
    endMeter: Math.max(zoneBreaks[index] + 1, boundary),
    type: 'pedal',
    restAfterSeconds: index === zoneBreaks.length - 2 ? 0 : restAfterSeconds,
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
    zoneBoundaryMeters: cleanBoundaries,
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

export function zoneBoundariesFromMapping(mapping: UserTrackMapping) {
  if (Array.isArray(mapping.zoneBoundaryMeters)) {
    return mapping.zoneBoundaryMeters;
  }

  return mapping.zones
    .slice(0, -1)
    .map((zone) => zone.endMeter)
    .filter((meter) => meter > 0 && meter < mapping.lengthMeters);
}

export function pointAtRouteMeter(points: TrackPoint[], meter: number): TrackPoint | null {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return points[0];
  }

  const target = Math.max(0, meter);
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentDistance = distanceBetweenTrackPoints(start, end);
    if (traveled + segmentDistance >= target) {
      const progress = (target - traveled) / Math.max(1, segmentDistance);
      return {
        lat: start.lat + (end.lat - start.lat) * progress,
        lng: start.lng + (end.lng - start.lng) * progress,
      };
    }

    traveled += segmentDistance;
  }

  return points[points.length - 1];
}

function projectToFlatMeters(point: TrackPoint, origin: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(origin.lat * (Math.PI / 180)) * 111_320;

  return {
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  };
}

export function nearestRouteMeter(points: TrackPoint[], target: TrackPoint) {
  if (points.length < 2) {
    return 0;
  }

  const origin = points[0];
  const targetPoint = projectToFlatMeters(target, origin);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMeter = 0;
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = projectToFlatMeters(points[index - 1], origin);
    const end = projectToFlatMeters(points[index], origin);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const segmentDistance = distanceBetweenTrackPoints(points[index - 1], points[index]);
    const progress = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((targetPoint.x - start.x) * segmentX + (targetPoint.y - start.y) * segmentY) / segmentLengthSquared));
    const projected = {
      x: start.x + segmentX * progress,
      y: start.y + segmentY * progress,
    };
    const distance = Math.hypot(targetPoint.x - projected.x, targetPoint.y - projected.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMeter = traveled + segmentDistance * progress;
    }

    traveled += segmentDistance;
  }

  return bestMeter;
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
