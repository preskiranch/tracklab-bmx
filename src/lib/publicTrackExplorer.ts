import type { TrackLocatorRecord } from '../types';

export type PublicTrackExplorerMarker = {
  position: { lat: number; lng: number };
  track: TrackLocatorRecord;
};

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
