import { describe, expect, it } from 'vitest';
import { trackCatalog } from '../../src/data/trackCatalog';
import {
  trackAppleDirectionsUrl,
  trackGoogleDirectionsUrl,
  trackGoogleEarthUrl,
} from '../../src/lib/mapLinks';
import { trackCenter } from '../../src/lib/googleMaps';
import type { TrackLocatorRecord } from '../../src/types';

const track = trackCatalog.find((item) => item.id === 'north-bay-bmx-napa-valley') ?? trackCatalog[0];
const destination = `${trackCenter(track).lat},${trackCenter(track).lng}`;

describe('public track map links', () => {
  it('builds keyless Google Maps driving directions to the selected track', () => {
    const url = new URL(trackGoogleDirectionsUrl(track));

    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe(destination);
    expect(url.searchParams.get('travelmode')).toBe('driving');
  });

  it('builds Apple Maps driving directions to the selected track', () => {
    const url = new URL(trackAppleDirectionsUrl(track));

    expect(url.origin).toBe('https://maps.apple.com');
    expect(url.searchParams.get('daddr')).toBe(destination);
    expect(url.searchParams.get('dirflg')).toBe('d');
  });

  it('builds a Google Earth location link', () => {
    expect(decodeURIComponent(trackGoogleEarthUrl(track))).toContain(destination);
  });

  it('builds links from the compact public locator record', () => {
    const center = trackCenter(track);
    const locatorTrack: TrackLocatorRecord = {
      id: track.id,
      name: track.name,
      country: track.country,
      countryCode: track.countryCode,
      state: track.state,
      region: track.region,
      source: track.source,
      latitude: center.lat,
      longitude: center.lng,
    };
    const url = new URL(trackGoogleDirectionsUrl(locatorTrack));

    expect(url.searchParams.get('destination')).toBe(`${center.lat},${center.lng}`);
  });
});
