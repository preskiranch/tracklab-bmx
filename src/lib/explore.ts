import { distanceBetweenTrackPoints, pointAtRouteMeter, routeLengthMeters } from './trackMapping';
import type { ExploreRider, ExploreRoute, TrackPoint } from '../types';

export const exploreRiderGroupingGapMeters = 70;
export const exploreRemoteStateFreshMs = 8_000;
const exploreCameraEaseMs = 180;

export type ExploreViewportGroup = {
  id: string;
  riders: ExploreRider[];
  startMeter: number;
  endMeter: number;
};

export function smoothExploreCameraPoint(
  current: TrackPoint,
  target: TrackPoint,
  elapsedMs: number,
) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const progress = 1 - Math.exp(-safeElapsedMs / exploreCameraEaseMs);
  return {
    lat: current.lat + (target.lat - current.lat) * progress,
    lng: current.lng + (target.lng - current.lng) * progress,
  };
}

export function decodeGooglePolyline(encodedPolyline: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encodedPolyline.length) {
        throw new Error('Google returned an incomplete route line.');
      }
      byte = encodedPolyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    return (result & 1) ? ~(result >> 1) : result >> 1;
  };

  while (index < encodedPolyline.length) {
    latitude += nextDelta();
    longitude += nextDelta();
    points.push({
      lat: latitude / 1e5,
      lng: longitude / 1e5,
    });
  }

  return points;
}

export function exploreRoutePoints(route: ExploreRoute | null | undefined) {
  if (!route?.encodedPolyline) {
    return [];
  }

  try {
    return decodeGooglePolyline(route.encodedPolyline);
  } catch {
    return [];
  }
}

export function exploreRoutePoint(
  routePoints: TrackPoint[],
  distanceMeters: number,
  routeDistanceMeters?: number,
) {
  if (routePoints.length === 0) {
    return null;
  }
  if (routePoints.length === 1) {
    return routePoints[0];
  }

  const geometryLength = routeLengthMeters(routePoints);
  const advertisedLength = Math.max(0.001, routeDistanceMeters ?? geometryLength);
  const geometryMeter = Math.max(0, Math.min(geometryLength, distanceMeters / advertisedLength * geometryLength));
  return pointAtRouteMeter(routePoints, geometryMeter);
}

export function exploreRouteHeading(
  routePoints: TrackPoint[],
  distanceMeters: number,
  routeDistanceMeters?: number,
) {
  const before = exploreRoutePoint(routePoints, Math.max(0, distanceMeters - 3), routeDistanceMeters);
  const after = exploreRoutePoint(routePoints, distanceMeters + 3, routeDistanceMeters);
  if (!before || !after || distanceBetweenTrackPoints(before, after) < 0.1) {
    return 0;
  }

  const latitude1 = before.lat * Math.PI / 180;
  const latitude2 = after.lat * Math.PI / 180;
  const longitudeDelta = (after.lng - before.lng) * Math.PI / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function groupExploreRiders(
  riders: ExploreRider[],
  gapMeters = exploreRiderGroupingGapMeters,
): ExploreViewportGroup[] {
  const sorted = [...riders]
    .filter((rider) => Number.isFinite(rider.distanceMeters))
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));

  if (sorted.length === 0) {
    return [];
  }

  const groups: ExploreRider[][] = [[sorted[0]]];
  sorted.slice(1).forEach((rider) => {
    const current = groups[groups.length - 1];
    const previous = current[current.length - 1];
    if (rider.distanceMeters - previous.distanceMeters > gapMeters) {
      groups.push([rider]);
    } else {
      current.push(rider);
    }
  });

  return groups
    .map((group) => ({
      id: group.map((rider) => rider.id).sort().join('|'),
      riders: group,
      startMeter: Math.min(...group.map((rider) => rider.distanceMeters)),
      endMeter: Math.max(...group.map((rider) => rider.distanceMeters)),
    }))
    .sort((a, b) => b.endMeter - a.endMeter || a.id.localeCompare(b.id));
}

export function exploreGridClass(groupCount: number) {
  if (groupCount <= 1) {
    return 'explore-map-grid single';
  }
  if (groupCount === 2) {
    return 'explore-map-grid split';
  }
  if (groupCount === 3) {
    return 'explore-map-grid three-way';
  }
  return 'explore-map-grid four-way';
}
