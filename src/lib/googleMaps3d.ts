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
