import type { TrackPoint } from '../types';
import { distanceBetweenTrackPoints, pointAtRouteMeter } from './trackMapping';

export const straightSprintMaximumFeet = 1500;

export const straightSprintDistanceOptions = [
  30,
  ...Array.from({ length: 15 }, (_, index) => (index + 1) * 100),
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
