import type { TrackPoint } from '../types';
import { distanceBetweenTrackPoints } from './trackMapping';

export const curveRawSampleMeters = 0.65;
const curveCommitSampleMeters = 2;
const curveSmoothingIterations = 2;

export function samplePointsByDistance(points: TrackPoint[], minimumDistanceMeters: number) {
  if (points.length <= 2) {
    return points;
  }

  const sampled: TrackPoint[] = [points[0]];
  points.slice(1, -1).forEach((point) => {
    const previous = sampled[sampled.length - 1];
    if (distanceBetweenTrackPoints(previous, point) >= minimumDistanceMeters) {
      sampled.push(point);
    }
  });
  sampled.push(points[points.length - 1]);
  return sampled;
}

export function smoothCurvePoints(points: TrackPoint[]) {
  if (points.length < 3) {
    return points;
  }

  let smoothed = points;
  for (let iteration = 0; iteration < curveSmoothingIterations; iteration += 1) {
    const next: TrackPoint[] = [smoothed[0]];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const current = smoothed[index];
      const following = smoothed[index + 1];
      next.push({
        lat: current.lat * 0.75 + following.lat * 0.25,
        lng: current.lng * 0.75 + following.lng * 0.25,
      });
      next.push({
        lat: current.lat * 0.25 + following.lat * 0.75,
        lng: current.lng * 0.25 + following.lng * 0.75,
      });
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }

  return smoothed;
}

export function preparedCurveStroke(points: TrackPoint[]) {
  const sampled = samplePointsByDistance(points, curveRawSampleMeters);
  const smoothed = smoothCurvePoints(sampled);
  return samplePointsByDistance(smoothed, curveCommitSampleMeters);
}
