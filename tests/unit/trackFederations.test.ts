import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyFederationRegistry,
  createFederationResolver,
  isSafeFederationUrl,
  validateFederationPair,
  validateFederationRegistry,
} from '../../scripts/lib/track-federations.mjs';

type FederationLink = {
  federationName?: string;
  federationUrl?: string;
};

type GeneratedTrack = FederationLink & {
  id: string;
  countryCode: string;
  source?: string;
  providerId?: string;
  state?: string;
  linkKind?: string;
};

let registry: Array<Record<string, string>>;
let fullTracks: GeneratedTrack[];
let locatorTracks: GeneratedTrack[];

beforeAll(async () => {
  const [registryJson, databaseJson, locatorJson] = await Promise.all([
    readFile(new URL('../../data/federations.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/track-database.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/track-locator.json', import.meta.url), 'utf8'),
  ]);
  registry = JSON.parse(registryJson) as Array<Record<string, string>>;
  fullTracks = (JSON.parse(databaseJson) as { tracks: GeneratedTrack[] }).tracks;
  locatorTracks = (JSON.parse(locatorJson) as { tracks: GeneratedTrack[] }).tracks;
});

describe('track federation registry', () => {
  it('contains a verified country default for every current catalog country', () => {
    expect(validateFederationRegistry(registry)).toEqual([]);
    const countryDefaults = registry.filter((entry) => !entry.trackId && !entry.source && !entry.state);
    expect(countryDefaults).toHaveLength(49);
    expect(new Set(countryDefaults.map((entry) => entry.countryCode))).toEqual(
      new Set(fullTracks.map((track) => track.countryCode)),
    );
  });

  it('rejects incomplete, duplicate, unknown-country, and unsafe registry entries', () => {
    expect(validateFederationRegistry([
      {
        countryCode: 'US',
        federationName: 'USA BMX',
        federationUrl: 'https://www.usabmx.com/',
        linkKind: 'official',
      },
      {
        countryCode: 'US',
        federationName: 'Duplicate',
        federationUrl: 'https://example.test/',
        linkKind: 'official',
      },
      {
        countryCode: 'XX',
        federationName: 'Unknown',
        federationUrl: 'javascript:alert(1)',
        linkKind: 'official',
      },
      {
        countryCode: 'CA',
        federationName: 'BMX Canada',
        linkKind: 'official',
      },
    ])).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate federation selector'),
      expect.stringContaining('known uppercase ISO 3166-1 alpha-2 code'),
      expect.stringContaining('safe HTTP(S) URL'),
      expect.stringContaining('missing federationUrl'),
    ]));
    expect(isSafeFederationUrl('https://owner:secret@example.test/')).toBe(false);
    expect(validateFederationPair({ federationName: 'USA BMX' }, 'test track')).toEqual([
      'test track: federationName and federationUrl must be supplied together',
    ]);
    expect(validateFederationPair({
      federationName: 'USA BMX',
      federationUrl: 'javascript:alert(1)',
    }, 'test track')).toEqual([
      'test track: federationUrl must be a safe HTTP(S) URL without credentials',
    ]);
  });

  it('resolves track override, then exact state, then country', () => {
    const resolve = createFederationResolver([
      {
        countryCode: 'US',
        federationName: 'National federation',
        federationUrl: 'https://national.example.test/',
        linkKind: 'official',
      },
      {
        countryCode: 'US',
        state: 'California',
        federationName: 'State association',
        federationUrl: 'https://state.example.test/',
        linkKind: 'official',
      },
      {
        countryCode: 'US',
        source: 'Official directory',
        federationName: 'Source association',
        federationUrl: 'https://source.example.test/',
        linkKind: 'official',
      },
      {
        countryCode: 'US',
        trackId: 'track-override',
        federationName: 'Track association',
        federationUrl: 'https://track-id.example.test/',
        linkKind: 'authoritative-directory-fallback',
      },
    ]);

    expect(resolve({
      countryCode: 'US',
      state: 'California',
      federationName: 'Track sanctioning body',
      federationUrl: 'https://track.example.test/',
    })).toEqual({
      federationName: 'Track sanctioning body',
      federationUrl: 'https://track.example.test/',
    });
    expect(resolve({ countryCode: 'US', state: 'California' })).toEqual({
      federationName: 'State association',
      federationUrl: 'https://state.example.test/',
    });
    expect(resolve({
      id: 'track-override',
      countryCode: 'US',
      source: 'Official directory',
      state: 'California',
    })).toEqual({
      federationName: 'Track association',
      federationUrl: 'https://track-id.example.test/',
    });
    expect(resolve({
      id: 'other-track',
      countryCode: 'US',
      source: 'Official directory',
      state: 'California',
    })).toEqual({
      federationName: 'Source association',
      federationUrl: 'https://source.example.test/',
    });
    expect(resolve({ countryCode: 'US', state: 'Nevada' })).toEqual({
      federationName: 'National federation',
      federationUrl: 'https://national.example.test/',
    });
    expect(resolve({ countryCode: 'US', state: 'Northern California' })).toEqual({
      federationName: 'National federation',
      federationUrl: 'https://national.example.test/',
    });
    expect(resolve({
      countryCode: 'US',
      source: 'Official directory mirror',
      state: 'California',
    })).toEqual({
      federationName: 'State association',
      federationUrl: 'https://state.example.test/',
    });
  });

  it('does not infer a federation from provider or source text', () => {
    const [unmapped] = applyFederationRegistry([{
      id: 'uruguay-track',
      countryCode: 'UY',
      state: 'Montevideo',
      providerId: 'usabmx',
      source: 'USA BMX / BMX Canada',
    }], registry);
    expect(unmapped).not.toHaveProperty('federationName');
    expect(unmapped).not.toHaveProperty('federationUrl');
  });

  it('preserves the resolved pair in the full and locator databases', () => {
    expect(fullTracks).toHaveLength(1_305);
    const locatorById = new Map(locatorTracks.map((track) => [track.id, track]));
    fullTracks.forEach((track) => {
      const locator = locatorById.get(track.id);
      expect(locator?.federationName).toBe(track.federationName);
      expect(locator?.federationUrl).toBe(track.federationUrl);
      expect(Boolean(track.federationName)).toBe(Boolean(track.federationUrl));
      expect(track.federationName).toBeTruthy();
      expect(track.federationUrl).toBeTruthy();
      expect(locator).not.toHaveProperty('linkKind');
    });

    const canadaBySource = new Map(fullTracks
      .filter((track) => track.countryCode === 'CA')
      .map((track) => [track.source, track.federationName]));
    expect(canadaBySource.get('USA BMX / BMX Canada')).toBe('BMX Canada');
    expect(canadaBySource.get('Cycling Canada')).toBe('Cycling Canada');

    const federationFor = (countryCode: string, state: string) => fullTracks.find((track) => (
      track.countryCode === countryCode && track.state === state
    ))?.federationName;
    expect(federationFor('GB', 'Alba / Scotland')).toBe('Scottish Cycling');
    expect(federationFor('GB', 'Cymru / Wales')).toBe('Beicio Cymru');
    expect(federationFor('GB', 'Northern Ireland / Tuaisceart éIreann')).toBe('Cycling Ireland BMX');
    expect(federationFor('CN', 'Hong Kong')).toBe('Cycling Association of Hong Kong, China');
    expect(federationFor('CN', '新界 New Territories')).toBe('Cycling Association of Hong Kong, China');
  });
});
