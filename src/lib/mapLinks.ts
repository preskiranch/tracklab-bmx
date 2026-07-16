import type { TrackLocatorRecord, TrackRecord } from '../types';
import { trackCenter } from './googleMaps';

type MapLinkTrack = TrackRecord | TrackLocatorRecord;

function isFullTrackRecord(track: MapLinkTrack): track is TrackRecord {
  return 'outline' in track && Array.isArray(track.outline);
}

function coordinatePair(track: MapLinkTrack) {
  const center = isFullTrackRecord(track)
    ? trackCenter(track)
    : { lat: Number(track.latitude), lng: Number(track.longitude) };
  return `${center.lat},${center.lng}`;
}

export function trackGoogleMapsUrl(track: MapLinkTrack) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', coordinatePair(track));
  return url.toString();
}

export function trackAppleMapsUrl(track: MapLinkTrack) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('ll', coordinatePair(track));
  url.searchParams.set('q', track.name);
  return url.toString();
}

export function trackGoogleEarthUrl(track: MapLinkTrack) {
  return `https://earth.google.com/web/search/${encodeURIComponent(coordinatePair(track))}`;
}
