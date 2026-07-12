import type { TrackRecord } from '../types';
import { trackCenter } from './googleMaps';

function coordinatePair(track: TrackRecord) {
  const center = trackCenter(track);
  return `${center.lat},${center.lng}`;
}

export function trackGoogleDirectionsUrl(track: TrackRecord) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', coordinatePair(track));
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

export function trackAppleDirectionsUrl(track: TrackRecord) {
  const url = new URL('https://maps.apple.com/');
  url.searchParams.set('daddr', coordinatePair(track));
  url.searchParams.set('dirflg', 'd');
  return url.toString();
}

export function trackGoogleEarthUrl(track: TrackRecord) {
  return `https://earth.google.com/web/search/${encodeURIComponent(coordinatePair(track))}`;
}
