import { distanceBetweenTrackPoints, pointAtRouteMeter, routeLengthMeters } from './trackMapping';
import type { ExploreRider, ExploreRoute, TrackPoint } from '../types';

export const exploreRiderGroupingGapMeters = 70;
export const exploreRemoteStateFreshMs = 8_000;
export const exploreDemoMinimumCruiseMph = 12;
export const exploreDemoMaximumCruiseMph = 18;
export const exploreLiveMinimumDriveWatts = 8;
const exploreCameraEaseMs = 180;
const exploreHeadingEaseMs = 240;
const exploreCameraBaseOffsetMeters = 60;
const exploreRouteSimplificationToleranceMeters = 2.5;
const exploreLiveAccelerationMps2 = 2;
const exploreLivePedalingSlowdownMps2 = 1.2;
// Explore uses road-bike coasting forces. Rolling resistance is nearly constant,
// while aerodynamic drag grows with the square of the rider's speed.
const exploreLiveRollingResistanceMps2 = 0.055;
const exploreLiveAeroResistancePerVelocitySquared = 0.004;
const exploreLiveMaximumVelocityMps = 25;

export type ExploreCameraFollowPosition = 'behind' | 'center' | 'ahead';

export type ExploreViewportGroup = {
  id: string;
  riders: ExploreRider[];
  startMeter: number;
  endMeter: number;
};

export function exploreAverageSpeedMph(distanceMeters: number, elapsedMs: number) {
  if (
    !Number.isFinite(distanceMeters)
    || !Number.isFinite(elapsedMs)
    || distanceMeters <= 0
    || elapsedMs <= 0
  ) {
    return 0;
  }
  return distanceMeters / (elapsedMs / 1_000) * 2.236936;
}

export function exploreDemoRiderMotion(
  playerId: ExploreRider['playerId'],
  elapsedSeconds: number,
) {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const riderIndex = Math.max(0, Math.min(3, playerId - 1));
  const phase = playerId * 1.41;
  const averageCruiseMph = 13.4 + riderIndex * 1.05;
  const changingCruiseMph = averageCruiseMph
    + Math.sin(elapsed * 0.18 + phase) * 0.9
    + Math.sin(elapsed * 0.43 + phase * 0.57) * 0.35;
  const cruiseMph = Math.max(
    exploreDemoMinimumCruiseMph,
    Math.min(exploreDemoMaximumCruiseMph, changingCruiseMph),
  );
  const rampSeconds = 7.2 + riderIndex * 0.55;
  const rampProgress = Math.max(0, Math.min(1, elapsed / rampSeconds));
  const launchEase = 1 - ((1 - rampProgress) ** 3);
  const speedMph = cruiseMph * launchEase;
  const coastPhase = (elapsed + playerId * 1.35) % 11.5;
  const pedaling = elapsed < rampSeconds || coastPhase < 8.7;

  return {
    averageCruiseMph,
    pedaling,
    speedMph,
  };
}

export function exploreLiveDriveActive(cadence: number, watts: number) {
  return Number.isFinite(cadence)
    && Number.isFinite(watts)
    && cadence >= 1
    && watts >= exploreLiveMinimumDriveWatts;
}

export function stepExploreLiveVelocity(
  currentVelocityMps: number,
  targetVelocityMps: number,
  driveActive: boolean,
  deltaSeconds: number,
  gradePercent = 0,
) {
  const current = Number.isFinite(currentVelocityMps) ? Math.max(0, currentVelocityMps) : 0;
  const target = Number.isFinite(targetVelocityMps) ? Math.max(0, targetVelocityMps) : 0;
  const elapsed = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.25, deltaSeconds)) : 0;
  if (elapsed === 0) {
    return current;
  }

  const safeGradePercent = Number.isFinite(gradePercent)
    ? Math.max(-30, Math.min(30, gradePercent))
    : 0;
  const uphillGravityMps2 = 9.80665 * Math.sin(Math.atan(safeGradePercent / 100));

  if (driveActive) {
    const difference = target - current;
    const maximumChange = (difference >= 0
      ? exploreLiveAccelerationMps2
      : exploreLivePedalingSlowdownMps2) * elapsed;
    const cadenceDrivenVelocity = Math.abs(difference) <= maximumChange
      ? target
      : Math.max(0, current + Math.sign(difference) * maximumChange);
    return Math.max(0, Math.min(
      exploreLiveMaximumVelocityMps,
      cadenceDrivenVelocity - uphillGravityMps2 * elapsed,
    ));
  }

  const downhillGravityMps2 = -uphillGravityMps2;
  const aerodynamicResistanceMps2 = exploreLiveAeroResistancePerVelocitySquared
    * current * current;
  const netAccelerationMps2 = downhillGravityMps2
    - exploreLiveRollingResistanceMps2
    - aerodynamicResistanceMps2;
  return Math.max(0, Math.min(
    exploreLiveMaximumVelocityMps,
    current + netAccelerationMps2 * elapsed,
  ));
}

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

export function smoothExploreHeading(
  currentHeading: number,
  targetHeading: number,
  elapsedMs: number,
) {
  const current = ((currentHeading % 360) + 360) % 360;
  const target = ((targetHeading % 360) + 360) % 360;
  const shortestTurn = ((target - current + 540) % 360) - 180;
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const progress = 1 - Math.exp(-safeElapsedMs / exploreHeadingEaseMs);
  return (current + shortestTurn * progress + 360) % 360;
}

// The transparent road-cyclist artwork points toward the lower-left at 225°.
// Rotate that front wheel into the route bearing, then subtract the map heading
// so it continues to point down the road when the camera turns.
export function exploreCyclistScreenRotation(routeHeading: number, mapHeading: number) {
  const route = Number.isFinite(routeHeading) ? routeHeading : 0;
  const camera = Number.isFinite(mapHeading) ? mapHeading : 0;
  return ((route - camera + 135) % 360 + 360) % 360;
}

export function closestExploreScreenRotation(currentRotation: number, targetRotation: number) {
  const current = Number.isFinite(currentRotation) ? currentRotation : 0;
  const target = Number.isFinite(targetRotation) ? targetRotation : 0;
  const shortestTurn = ((target - current + 540) % 360) - 180;
  return current + shortestTurn;
}

export function exploreCameraOffsetMeters(
  position: ExploreCameraFollowPosition,
  followZoom: number,
) {
  if (position === 'center') {
    return 0;
  }
  const safeZoom = Number.isFinite(followZoom)
    ? Math.max(12, Math.min(20, followZoom))
    : 18;
  const zoomAdjustedOffset = Math.max(
    18,
    Math.min(400, exploreCameraBaseOffsetMeters * (2 ** (18 - safeZoom))),
  );
  return position === 'behind' ? -zoomAdjustedOffset : zoomAdjustedOffset;
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

function wrappedLongitudeDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function pointToSegmentDistanceMeters(
  point: TrackPoint,
  start: TrackPoint,
  end: TrackPoint,
) {
  const latitudeRadians = point.lat * Math.PI / 180;
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = Math.max(
    1,
    Math.cos(latitudeRadians) * metersPerLatitudeDegree,
  );
  const startX = wrappedLongitudeDelta(start.lng - point.lng) * metersPerLongitudeDegree;
  const startY = (start.lat - point.lat) * metersPerLatitudeDegree;
  const endX = wrappedLongitudeDelta(end.lng - point.lng) * metersPerLongitudeDegree;
  const endY = (end.lat - point.lat) * metersPerLatitudeDegree;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
  if (segmentLengthSquared <= 0.0001) {
    return Math.hypot(startX, startY);
  }
  const projection = Math.max(
    0,
    Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared),
  );
  return Math.hypot(
    startX + projection * segmentX,
    startY + projection * segmentY,
  );
}

export function simplifyExploreRoutePoints(
  points: TrackPoint[],
  toleranceMeters = exploreRouteSimplificationToleranceMeters,
) {
  if (points.length <= 2 || toleranceMeters <= 0) {
    return [...points];
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const segments: Array<[number, number]> = [[0, points.length - 1]];

  while (segments.length > 0) {
    const [startIndex, endIndex] = segments.pop() as [number, number];
    let farthestIndex = -1;
    let farthestDistance = toleranceMeters;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointToSegmentDistanceMeters(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex > startIndex && farthestIndex < endIndex) {
      keep[farthestIndex] = 1;
      segments.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

export function exploreRoutePoints(route: ExploreRoute | null | undefined) {
  if (!route?.encodedPolyline) {
    return [];
  }

  try {
    return simplifyExploreRoutePoints(decodeGooglePolyline(route.encodedPolyline));
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
