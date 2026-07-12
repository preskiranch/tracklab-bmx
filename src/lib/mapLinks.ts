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

export function trackGoogleDirectionsUrl(track: MapLinkTrack) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', coordinatePair(track));
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

export function trackAppleDirectionsUrl(track: MapLinkTrack) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('daddr', coordinatePair(track));
  url.searchParams.set('dirflg', 'd');
  return url.toString();
}

export function trackGoogleEarthUrl(track: MapLinkTrack) {
  return `https://earth.google.com/web/search/${encodeURIComponent(coordinatePair(track))}`;
}
