import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  isNormalizedPhoneNumber,
  isServiceUrl,
  normalizePhoneNumber,
  normalizeSocialUrl,
  normalizeTrackContactFields,
  phoneHrefFor,
} from '../../scripts/lib/track-contact-fields.mjs';
import {
  extractUsaBmxMicrositeContact,
  isSafeUsaBmxMicrositeResponseUrl,
  usaBmxMicrositeUrl,
} from '../../scripts/lib/usa-bmx-microsite.mjs';
import { safePhoneNumber, trackExternalLinks } from '../../src/lib/trackExternalLinks';

type ContactTrack = {
  id: string;
  providerId?: string;
  websiteUrl?: unknown;
  facebookUrl?: unknown;
  instagramUrl?: unknown;
  tiktokUrl?: unknown;
  youtubeUrl?: unknown;
  phoneNumber?: unknown;
  sourceRecord?: Record<string, unknown>;
};

let fullTracks: ContactTrack[];
let locatorTracks: ContactTrack[];

beforeAll(async () => {
  const [databaseJson, locatorJson] = await Promise.all([
    readFile(new URL('../../public/data/track-database.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/track-locator.json', import.meta.url), 'utf8'),
  ]);
  fullTracks = (JSON.parse(databaseJson) as { tracks: ContactTrack[] }).tracks;
  locatorTracks = (JSON.parse(locatorJson) as { tracks: ContactTrack[] }).tracks;
});

describe('track contact normalization', () => {
  it('normalizes exact service hosts but admits reviewed TikTok/YouTube only through the registry', () => {
    expect(normalizeTrackContactFields({
      websiteUrl: 'youtube.com/@official-track',
      tiktokUrl: 'http://www.tiktok.com/@official-track',
    })).toEqual({});
    expect(normalizeSocialUrl('http://www.tiktok.com/@official-track', 'tiktok'))
      .toBe('https://www.tiktok.com/@official-track');
    expect(isServiceUrl('https://youtu.be/example', 'youtube')).toBe(true);
    expect(isServiceUrl('https://youtube.com.evil.example/example', 'youtube')).toBe(false);
    expect(isServiceUrl('https://not-tiktok.com/@track', 'tiktok')).toBe(false);
  });

  it('preserves a safe phone display and derives a punctuation-free tel target', () => {
    expect(normalizePhoneNumber(' +1 (205) 586-2863 ')).toBe('+1 (205) 586-2863');
    expect(phoneHrefFor('+1 (205) 586-2863')).toBe('tel:+12055862863');
    expect(isNormalizedPhoneNumber('+1 (205) 586-2863')).toBe(true);
    expect(normalizePhoneNumber(undefined)).toBeUndefined();
    expect(normalizePhoneNumber(false)).toBeUndefined();
    expect(normalizePhoneNumber('+1 (205 586-2863')).toBeUndefined();
    expect(normalizePhoneNumber('205-586-2863; 205-598-7006')).toBeUndefined();
  });

  it('falls back from an invalid direct value to exact source metadata and omits missing fields', () => {
    expect(normalizeTrackContactFields({
      phoneNumber: 'not a phone',
      youtubeUrl: 'https://youtube.com.evil.example/track',
      sourceRecord: {
        osmTags: {
          'contact:phone': '+39 331 4570302',
          'contact:youtube': 'https://www.youtube.com/@verified-track',
        },
      },
    })).toEqual({ phoneNumber: '+39 331 4570302' });
    expect(normalizeTrackContactFields({})).toEqual({});
    expect(normalizeTrackContactFields({ phoneNumber: false })).toEqual({});
  });

  it('keeps runtime and generated phone validation on the same trust boundary', () => {
    const cases = [
      '+1 (205) 586-2863',
      '0405525970',
      '+39 331 4570302',
      '+1 (205 586-2863',
      '12345',
      '555-CALL-NOW',
      '205-586-2863 / 205-598-7006',
    ];
    cases.forEach((value) => {
      expect(safePhoneNumber(value)).toBe(normalizePhoneNumber(value));
      expect(trackExternalLinks({ phoneNumber: value }).phoneHref).toBe(phoneHrefFor(value));
    });
  });
});

describe('USA BMX microsite contact verification', () => {
  const expectedRecord = {
    id: 551,
    name: 'Oak Mountain BMX',
    state_abbreviation: 'AL',
  };
  const nextData = (track = { id: 551, name: 'Oak Mountain BMX' }) => `<!doctype html>
    <script type="application/json" id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          track,
          msHomepageData: {
            hero_section: {
              ...track,
              primary_contact_phone: '205-586-2863',
              secondary_contact_phone: '205-598-7006',
            },
          },
        },
      },
    })}</script>`;

  it('derives the official route and accepts only an exact track id/name match', () => {
    expect(usaBmxMicrositeUrl(expectedRecord)).toBe(
      'https://www.usabmx.com/tracks/al-oak-mountain-bmx',
    );
    expect(extractUsaBmxMicrositeContact(nextData(), expectedRecord)).toEqual({
      matched: true,
      phoneNumber: '205-586-2863',
    });
    expect(extractUsaBmxMicrositeContact(
      nextData({ id: 552, name: 'Different BMX' }),
      expectedRecord,
    )).toBeUndefined();
  });

  it('fails closed for malformed payloads, invalid phones, and non-official redirects', () => {
    expect(extractUsaBmxMicrositeContact('<html></html>', expectedRecord)).toBeUndefined();
    expect(extractUsaBmxMicrositeContact(
      nextData().replace('205-586-2863', 'call-us'),
      expectedRecord,
    )).toEqual({ matched: true });
    expect(isSafeUsaBmxMicrositeResponseUrl('https://www.usabmx.com/tracks/al-oak-mountain-bmx')).toBe(true);
    expect(isSafeUsaBmxMicrositeResponseUrl('https://evil.example/tracks/al-oak-mountain-bmx')).toBe(false);
    expect(isSafeUsaBmxMicrositeResponseUrl('https://evil@www.usabmx.com/tracks/al-oak-mountain-bmx')).toBe(false);
  });
});

describe('generated track contacts', () => {
  it('preserves every optional contact field exactly in the public locator', () => {
    const fields = [
      'websiteUrl',
      'facebookUrl',
      'instagramUrl',
      'tiktokUrl',
      'youtubeUrl',
      'phoneNumber',
    ] as const;
    const locatorById = new Map(locatorTracks.map((track) => [track.id, track]));
    expect(locatorTracks).toHaveLength(fullTracks.length);
    fullTracks.forEach((track) => {
      const locator = locatorById.get(track.id);
      expect(locator).toBeDefined();
      fields.forEach((field) => expect(locator?.[field]).toBe(track[field]));
    });
  });

  it('omits missing contacts and keeps every emitted value valid', () => {
    fullTracks.forEach((track) => {
      expect(track.phoneNumber).not.toBe(false);
      expect(track.tiktokUrl).not.toBe(false);
      expect(track.youtubeUrl).not.toBe(false);
      if (track.phoneNumber !== undefined) {
        expect(isNormalizedPhoneNumber(track.phoneNumber)).toBe(true);
      }
      if (track.tiktokUrl !== undefined) {
        expect(isServiceUrl(track.tiktokUrl, 'tiktok')).toBe(true);
      }
      if (track.youtubeUrl !== undefined) {
        expect(isServiceUrl(track.youtubeUrl, 'youtube')).toBe(true);
      }
    });
  });

  it('retains official phone provenance for the photographed Oak Mountain track', () => {
    const oakMountain = fullTracks.find((track) => track.id === 'oak-mountain-bmx');
    expect(oakMountain?.phoneNumber).toBe('205-586-2863');
    expect(oakMountain?.sourceRecord).toMatchObject({
      contactSource: 'USA BMX track microsite __NEXT_DATA__',
      contactSourceUrl: 'https://www.usabmx.com/tracks/al-oak-mountain-bmx',
      contactSourceField: 'msHomepageData.hero_section.primary_contact_phone',
    });
  });
});
