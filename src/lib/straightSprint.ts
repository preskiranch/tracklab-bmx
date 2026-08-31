import type { EarthCamera, RaceRiderOverlayLayout, TrackPoint } from '../types';
import { distanceBetweenTrackPoints, pointAtRouteMeter } from './trackMapping';

export const straightSprintMaximumFeet = 1500;

export const straightSprintDistanceOptions = [
  30,
  100,
  145,
  ...Array.from({ length: 14 }, (_, index) => (index + 2) * 100),
] as const;

export const straightSprintAirSettings = Array.from({ length: 10 }, (_, index) => index + 1);

export function normalizeStraightSprintDistance(value: unknown) {
  const numeric = Math.round(Number(value));
  return straightSprintDistanceOptions.includes(numeric as (typeof straightSprintDistanceOptions)[number])
    ? numeric
    : 100;
}

export function normalizeStraightSprintAirSetting(value: unknown) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

export function straightSprintFeetToMeters(feet: number) {
  return feet * 0.3048;
}

export function straightSprintCameraPreferenceKey(trackId: string, distanceFeet: number) {
  return `${trackId}:sprint:${normalizeStraightSprintDistance(distanceFeet)}ft`;
}

/**
 * Rider panels share the same per-distance key as the Straight Sprint camera.
 * Fall back to the original track-only record so layouts saved before distance
 * specific panels were introduced continue to render on every device.
 */
export function resolveStraightSprintRiderOverlay(
  overlays: Record<string, RaceRiderOverlayLayout>,
  trackId: string,
  distanceFeet: number,
) {
  return overlays[straightSprintCameraPreferenceKey(trackId, distanceFeet)]
    ?? overlays[trackId];
}

function completeCameraComposition(camera: EarthCamera | undefined) {
  return camera?.center != null && camera.zoom != null;
}

/**
 * Resolves the camera used by Straight Sprint without dropping a known-good
 * venue composition. Older distance-specific records can contain only the
 * angle and heading; selecting one directly leaves Google Maps to choose its
 * own center/zoom and makes a studio tablet look heavily cropped.
 */
export function resolveStraightSprintCamera(
  cameras: Record<string, EarthCamera>,
  trackId: string,
  distanceFeet: number,
) {
  const exactKey = straightSprintCameraPreferenceKey(trackId, distanceFeet);
  const siblingPrefix = `${trackId}:sprint:`;
  const siblings = Object.entries(cameras)
    .filter(([key]) => key !== exactKey && key.startsWith(siblingPrefix))
    .sort(([leftKey, left], [rightKey, right]) => (
      right.updatedAt - left.updatedAt || leftKey.localeCompare(rightKey)
    ))
    .map(([, camera]) => camera);
  const candidates = [cameras[exactKey], cameras[trackId], ...siblings]
    .filter((camera): camera is EarthCamera => camera != null);
  const primary = candidates[0];
  if (!primary) return undefined;

  const composition = candidates.find(completeCameraComposition);
  if (!composition || composition === primary) return primary;

  return {
    ...primary,
    center: composition.center,
    zoom: composition.zoom,
    ...(composition.referenceViewport
      ? { referenceViewport: composition.referenceViewport }
      : { referenceViewport: undefined }),
  } satisfies EarthCamera;
}

export function straightSprintConfigurationKey(distanceFeet: number, airSetting: number) {
  return `sprint:${normalizeStraightSprintDistance(distanceFeet)}ft:air:${normalizeStraightSprintAirSetting(airSetting)}`;
}

export function clipRouteAtMeter(points: TrackPoint[], requestedMeters: number) {
  if (points.length < 2) {
    return points;
  }

  const targetMeters = Math.max(0, requestedMeters);
  const clipped: TrackPoint[] = [points[0]];
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentMeters = distanceBetweenTrackPoints(start, end);
    if (traveled + segmentMeters >= targetMeters) {
      const endpoint = pointAtRouteMeter(points, targetMeters);
      if (endpoint) {
        clipped.push(endpoint);
      }
      return clipped;
    }

    clipped.push(end);
    traveled += segmentMeters;
  }

  return clipped;
}
