import type { TrackPoint } from '../types';

export const northBayGameArenaWidth = 1586;
export const northBayGameArenaHeight = 992;

// Local plane: existing route-distance and zone math works without coupling the
// illustrated canvas to the satellite map's real-world coordinates.
const metersPerPixel = 0.085;
const metersPerDegree = 111_320;

export function northBayGameArenaPixelsForMeters(meters: number) {
  return meters / metersPerPixel;
}

export function arenaPointToTrackPoint(x: number, y: number): TrackPoint {
  return { lat: -y * metersPerPixel / metersPerDegree, lng: x * metersPerPixel / metersPerDegree };
}

export function trackPointToArenaPoint(point: TrackPoint) {
  return { x: point.lng * metersPerDegree / metersPerPixel, y: -point.lat * metersPerDegree / metersPerPixel };
}
