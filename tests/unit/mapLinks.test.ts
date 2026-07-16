import { describe, expect, it } from 'vitest';
import { trackCatalog } from '../../src/data/trackCatalog';
import {
  trackAppleMapsUrl,
  trackGoogleMapsUrl,
  trackGoogleEarthUrl,
} from '../../src/lib/mapLinks';
import { trackCenter } from '../../src/lib/googleMaps';
import type { TrackLocatorRecord } from '../../src/types';

const track = trackCatalog.find((item) => item.id === 'north-bay-bmx-napa-valley') ?? trackCatalog[0];
const destination = `${trackCenter(track).lat},${trackCenter(track).lng}`;

describe('public track map links', () => {
  it('opens the selected track as an exact Google Maps location', () => {
    const url = new URL(trackGoogleMapsUrl(track));

    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe(destination);
    expect(url.searchParams.has('destination')).toBe(false);
  });

  it('opens a named pin for the selected track in Apple Maps', () => {
    const url = new URL(trackAppleMapsUrl(track));

    expect(url.origin).toBe('https://maps.apple.com');
    expect(url.searchParams.get('ll')).toBe(destination);
    expect(url.searchParams.get('q')).toBe(track.name);
    expect(url.searchParams.has('daddr')).toBe(false);
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
    const url = new URL(trackGoogleMapsUrl(locatorTrack));

    expect(url.searchParams.get('query')).toBe(`${center.lat},${center.lng}`);
  });
});
