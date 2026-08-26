import { describe, expect, it, vi } from 'vitest';
import {
  generatePreRaceLine,
  localPreRaceLine,
  preRaceTrackResearchCacheKey,
  sanitizePreRaceTrackContext,
} from '../../cloud/preRaceBriefing.mjs';

const nicknameTrack = {
  id: 'north-bay-bmx',
  name: 'North Bay BMX',
  country: 'United States',
  city: 'Napa',
  state: 'California',
  surface: 'dirt',
  lengthMeters: 340,
  hasProSet: false,
  riders: [
    { playerId: 1, name: 'Connor Fields (The Captain)', colorName: 'blue' },
    { playerId: 2, name: 'Maya Torres', colorName: 'lime' },
  ],
};

describe('nickname-aware pre-race calls', () => {
  it('uses a supplied nickname naturally in the local briefing fallback', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const line = localPreRaceLine(nicknameTrack, { available: false });
    random.mockRestore();

    expect(line).toContain('The Captain');
    expect(line).toContain('Maya Torres');
  });

  it('accepts AI briefings that use a nickname instead of repeating the parenthetical entry', async () => {
    const lines = [
      'At North Bay BMX, The Captain and Maya Torres settle onto the gate as the dirt course waits and the opening charge draws close.',
      'The Captain joins Maya Torres on the North Bay BMX hill, where the dirt layout is ready and every eye turns toward the gate.',
      'North Bay BMX welcomes Maya Torres and The Captain to the gate, with a dirt course ahead and the next race only moments away.',
    ];
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{
          content: [{
            type: 'output_text',
            text: JSON.stringify({ lines }),
          }],
        }],
      }),
    });

    const report = await generatePreRaceLine({
      track: nicknameTrack,
      weather: { available: false },
      research: { facts: [] },
      apiKey: 'test-key',
      fetchImplementation,
    });

    expect(report.source).toBe('ai');
    expect(report.line).toContain('The Captain');
    expect(report.line).not.toContain('(The Captain)');
  });
});

describe('pre-race track research cache scope', () => {
  const sanitizedTrack = (overrides: Record<string, unknown> = {}) => sanitizePreRaceTrackContext({
    id: 'shared-client-id',
    name: 'Preski Ranch Drag Strip',
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'California',
    city: 'Napa',
    address: '100 Track Way, Napa, CA',
    latitude: 38.2975,
    longitude: -122.2869,
    surface: 'Custom sprint route',
    lengthMeters: 300,
    source: 'Custom',
    sourceUrl: 'https://example.test/preski-drag-strip',
    sourceType: 'manual',
    zoneNames: ['Launch', 'Finish'],
    riders: [{
      playerId: 1,
      name: 'Rider One',
      colorName: 'lime',
      personalBestMs: 14_500,
    }],
    ...overrides,
  });

  it('does not share research when client-supplied ids match but sanitized track metadata differs', () => {
    const original = sanitizedTrack();
    const impersonatingTrack = sanitizedTrack({
      name: 'Different BMX Facility',
      city: 'Reno',
      latitude: 39.5296,
      longitude: -119.8138,
      sourceUrl: 'https://example.test/different-bmx-facility',
    });

    expect(original).not.toBeNull();
    expect(impersonatingTrack).not.toBeNull();
    expect(original?.id).toBe(impersonatingTrack?.id);
    expect(preRaceTrackResearchCacheKey(original)).toMatch(/^track-research-v2:[a-f0-9]{64}$/);
    expect(preRaceTrackResearchCacheKey(original)).not.toBe(
      preRaceTrackResearchCacheKey(impersonatingTrack),
    );
  });

  it('keeps custom-track research stable across rider and personal-result changes', () => {
    const first = sanitizedTrack({
      knownTrackBestMs: 14_100,
      knownTrackBestRider: 'Rider One',
      knownTrackBestAt: '2026-08-01',
    });
    const nextAthlete = sanitizedTrack({
      knownTrackBestMs: 13_900,
      knownTrackBestRider: 'Rider Two',
      knownTrackBestAt: '2026-08-26',
      riders: [{
        playerId: 4,
        name: 'Rider Two',
        colorName: 'red',
        personalBestMs: 13_900,
        personalThirtyFootMs: 2_450,
      }],
    });

    expect(first).not.toBeNull();
    expect(nextAthlete).not.toBeNull();
    expect(preRaceTrackResearchCacheKey(first)).toBe(preRaceTrackResearchCacheKey(nextAthlete));
  });
});
