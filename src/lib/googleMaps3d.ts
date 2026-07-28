import type { TrackPoint } from '../types';
import { distanceBetweenTrackPoints } from './trackMapping';

const minimumPreviewRangeMeters = 280;
const maximumPreviewRangeMeters = 5_000;

export type GoogleMaps3DCamera = {
  altitudeMode: 'RELATIVE_TO_GROUND';
  center: TrackPoint & { altitude: number };
  heading: number;
  range: number;
  tilt: number;
};

export function isGoogleMaps3DSteadyEvent(event: Event) {
  return (event as Event & { isSteady?: boolean }).isSteady === true;
}

export function previewRangeMeters(points: TrackPoint[], center: TrackPoint) {
  const farthestPointMeters = points.reduce((maximum, point) => (
    Math.max(maximum, distanceBetweenTrackPoints(center, point))
  ), 0);

  return Math.round(Math.max(
    minimumPreviewRangeMeters,
    Math.min(maximumPreviewRangeMeters, farthestPointMeters * 4.2),
  ));
}

export function mapping3DCenterForTrack(
  preferredCenter: TrackPoint | null,
  trackCenter: TrackPoint,
  trackLengthMeters: number,
) {
  if (!preferredCenter) {
    return trackCenter;
  }

  const allowedOffsetMeters = Math.max(750, trackLengthMeters * 2.5);
  return distanceBetweenTrackPoints(preferredCenter, trackCenter) <= allowedOffsetMeters
    ? preferredCenter
    : trackCenter;
}

export function terrainRelativeCamera(
  center: TrackPoint,
  heading: number,
  tilt: number,
  range: number,
): GoogleMaps3DCamera {
  return {
    altitudeMode: 'RELATIVE_TO_GROUND',
    center: { ...center, altitude: 0 },
    heading,
    range,
    tilt,
  };
}

export function elevatedPath(points: TrackPoint[], altitudeMeters = 1.25) {
  return points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    altitude: altitudeMeters,
  }));
}

type ScreenPoint = { x: number; y: number };
type ScreenSize = { width: number; height: number };
type Vec3 = { x: number; y: number; z: number };

type GoogleMaps3DProjectionCamera = {
  center: TrackPoint;
  fov?: number;
  heading: number;
  range: number;
  tilt: number;
};

function vectorAdd(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function vectorSubtract(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function vectorScale(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function vectorCross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function vectorLength(vector: Vec3) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function vectorNormalize(vector: Vec3): Vec3 {
  const length = vectorLength(vector);
  return length === 0 ? { x: 0, y: 0, z: 0 } : vectorScale(vector, 1 / length);
}

function pointAtLocalOffset(center: TrackPoint, eastMeters: number, northMeters: number): TrackPoint {
  const latScale = 111_320;
  const lngScale = Math.max(1, Math.cos(center.lat * (Math.PI / 180)) * latScale);
  return {
    lat: center.lat + northMeters / latScale,
    lng: center.lng + eastMeters / lngScale,
  };
}

export function projectScreenPointToGround(
  screen: ScreenPoint,
  size: ScreenSize,
  camera: GoogleMaps3DProjectionCamera,
): TrackPoint | null {
  if (size.width <= 0 || size.height <= 0) {
    return null;
  }

  const headingRadians = (camera.heading * Math.PI) / 180;
  const tiltRadians = Math.max(0, Math.min(85, camera.tilt)) * (Math.PI / 180);
  const range = Math.max(40, camera.range);
  const forwardGround = {
    x: Math.sin(headingRadians),
    y: Math.cos(headingRadians),
    z: 0,
  };
  const target = { x: 0, y: 0, z: 0 };
  const cameraPosition = {
    x: -forwardGround.x * Math.sin(tiltRadians) * range,
    y: -forwardGround.y * Math.sin(tiltRadians) * range,
    z: Math.max(1, Math.cos(tiltRadians) * range),
  };
  const forward = vectorNormalize(vectorSubtract(target, cameraPosition));
  const worldUp = { x: 0, y: 0, z: 1 };
  const right = vectorNormalize(vectorCross(forward, worldUp));
  const up = vectorNormalize(vectorCross(right, forward));
  const verticalFov = ((camera.fov ?? 35) * Math.PI) / 180;
  const halfVertical = Math.tan(verticalFov / 2);
  const halfHorizontal = halfVertical * (size.width / size.height);
  const ndcX = (screen.x / size.width) * 2 - 1;
  const ndcY = 1 - (screen.y / size.height) * 2;
  const rayDirection = vectorNormalize(vectorAdd(
    vectorAdd(forward, vectorScale(right, ndcX * halfHorizontal)),
    vectorScale(up, ndcY * halfVertical),
  ));

  if (Math.abs(rayDirection.z) < 0.0001) {
    return null;
  }

  const travel = -cameraPosition.z / rayDirection.z;
  if (!Number.isFinite(travel) || travel <= 0) {
    return null;
  }

  const hit = vectorAdd(cameraPosition, vectorScale(rayDirection, travel));
  return pointAtLocalOffset(camera.center, hit.x, hit.y);
}
