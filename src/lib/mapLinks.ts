import type { TrackLocatorRecord, TrackRecord } from '../types';
import { trackCenter } from './googleMaps';
import { trackLabPublicOrigin } from './serviceOrigins';

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

export function trackGoogleMapsDirectionsUrl(track: MapLinkTrack) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', coordinatePair(track));
  return url.toString();
}

export function trackGoogleEarthUrl(track: MapLinkTrack) {
  return `https://earth.google.com/web/search/${encodeURIComponent(coordinatePair(track))}`;
}

export const maximumTrackLocatorIdLength = 140;

export function normalizeTrackLocatorId(value: unknown) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  return candidate.length > 0
    && candidate.length <= maximumTrackLocatorIdLength
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(candidate)
    ? candidate
    : '';
}

export function trackLocatorShareUrl(trackId: unknown, origin?: string) {
  const normalizedTrackId = normalizeTrackLocatorId(trackId);
  if (!normalizedTrackId) return '';
  const baseOrigin = origin ?? trackLabPublicOrigin;
  try {
    const url = new URL('/', baseOrigin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.searchParams.set('locator', normalizedTrackId);
    url.hash = 'track-locator';
    return url.toString();
  } catch {
    return '';
  }
}

export function trackLocatorIdFromHref(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return '';
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'https://tracklab.invalid' : window.location.origin);
    return normalizeTrackLocatorId(url.searchParams.get('locator'));
  } catch {
    return '';
  }
}

export async function copyTrackLocatorLink(
  trackId: unknown,
  options: {
    origin?: string;
    clipboard?: Pick<Clipboard, 'writeText'> | null;
    document?: Document | null;
  } = {},
) {
  const href = trackLocatorShareUrl(trackId, options.origin);
  if (!href) throw new Error('This track does not have a shareable TrackLab link.');
  const clipboard = options.clipboard === undefined
    ? (typeof navigator === 'undefined' ? null : navigator.clipboard)
    : options.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(href);
      return href;
    } catch {
      // Safari and embedded web views may expose Clipboard but deny a write.
    }
  }
  const documentValue = options.document === undefined
    ? (typeof document === 'undefined' ? null : document)
    : options.document;
  if (!documentValue?.body || typeof documentValue.execCommand !== 'function') {
    throw new Error('Copy is unavailable on this device.');
  }
  const input = documentValue.createElement('textarea');
  input.value = href;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  documentValue.body.appendChild(input);
  input.select();
  const copied = documentValue.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy is unavailable on this device.');
  return href;
}
