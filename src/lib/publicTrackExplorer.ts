import type { TrackLocatorRecord } from '../types';
import { distanceBetweenTrackPoints } from './trackMapping';

export type PublicTrackExplorerMarker = {
  position: { lat: number; lng: number };
  track: TrackLocatorRecord;
};

export const publicTrackEarthInitialRangeMeters = 1_400;

/**
 * Google 3D's camera range is the distance from the camera to its target, not
 * the width of the visible ground. This multiplier gives the directory a
 * predictable reveal radius: a close track view stays local, while lifting
 * the camera progressively brings regional, national, and global tracks in.
 */
export function publicTrackEarthRevealRadiusMeters(rangeMeters: number) {
  const range = Number.isFinite(rangeMeters) ? Math.max(0, rangeMeters) : publicTrackEarthInitialRangeMeters;
  return Math.min(21_000_000, Math.max(4_000, range * 5));
}

/** Keep the labeled end of every pin visibly above terrain at every camera height. */
export function publicTrackEarthPinAltitudeMeters(rangeMeters: number) {
  const range = Number.isFinite(rangeMeters) ? Math.max(0, rangeMeters) : publicTrackEarthInitialRangeMeters;
  return Math.round(Math.min(12_000, Math.max(90, 50 + Math.sqrt(range) * 2)));
}

export function publicTrackExplorerPoint(track: TrackLocatorRecord) {
  const lat = Number(track.latitude);
  const lng = Number(track.longitude);
  return Number.isFinite(lat)
    && lat >= -90
    && lat <= 90
    && Number.isFinite(lng)
    && lng >= -180
    && lng <= 180
    ? { lat, lng }
    : null;
}

export function publicTrackExplorerMarkers(tracks: TrackLocatorRecord[]): PublicTrackExplorerMarker[] {
  const seenTrackIds = new Set<string>();
  const markers: PublicTrackExplorerMarker[] = [];
  tracks.forEach((track) => {
    if (seenTrackIds.has(track.id)) return;
    const position = publicTrackExplorerPoint(track);
    if (!position) return;
    seenTrackIds.add(track.id);
    markers.push({ position, track });
  });
  return markers;
}

export function publicTrackExplorerMarkerTitle(track: TrackLocatorRecord) {
  const location = [track.city, track.state, track.country].filter(Boolean).join(', ');
  return `${track.name}${location ? ` — ${location}` : ''}. Open TrackLab track details`;
}

export function publicTrackEarthVisibleMarkers(
  markers: PublicTrackExplorerMarker[],
  center: { lat: number; lng: number },
  rangeMeters: number,
  selectedTrackId: string,
) {
  const revealRadius = publicTrackEarthRevealRadiusMeters(rangeMeters);
  return markers
    .map((marker) => ({
      ...marker,
      distanceMeters: distanceBetweenTrackPoints(center, marker.position),
    }))
    .filter(({ distanceMeters, track }) => (
      track.id === selectedTrackId || distanceMeters <= revealRadius
    ))
    .sort((left, right) => (
      Number(right.track.id === selectedTrackId) - Number(left.track.id === selectedTrackId)
      || left.distanceMeters - right.distanceMeters
      || left.track.name.localeCompare(right.track.name)
    ));
}
