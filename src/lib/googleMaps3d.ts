import type { TrackPoint } from '../types';
import { distanceBetweenTrackPoints } from './trackMapping';

const minimumPreviewRangeMeters = 180;
const maximumPreviewRangeMeters = 5_000;

export function previewRangeMeters(points: TrackPoint[], center: TrackPoint) {
  const farthestPointMeters = points.reduce((maximum, point) => (
    Math.max(maximum, distanceBetweenTrackPoints(center, point))
  ), 0);

  return Math.round(Math.max(
    minimumPreviewRangeMeters,
    Math.min(maximumPreviewRangeMeters, farthestPointMeters * 3.2),
  ));
}

export function elevatedPath(points: TrackPoint[], altitudeMeters = 1.25) {
  return points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    altitude: altitudeMeters,
  }));
}
