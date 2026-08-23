import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyTrackSocialLinkRegistry,
  isPublicIpAddress,
  normalizePublicHttpUrl,
  validateTrackSocialAuditManifest,
  validateTrackSocialLinkParity,
  validateTrackSocialLinkRegistry,
} from '../../scripts/lib/track-social-links.mjs';

type SocialTrack = {
  id: string;
  sourceUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  sourceRecord?: Record<string, unknown>;
};

let registry: any;
let manifest: any;
let fullTracks: SocialTrack[];
let locatorTracks: SocialTrack[];

beforeAll(async () => {
  const [registryJson, manifestJson, databaseJson, locatorJson] = await Promise.all([
    readFile(new URL('../../data/track-social-links.json', import.meta.url), 'utf8'),
    readFile(new URL('../../data/audits/track-social-audit.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/track-database.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/track-locator.json', import.meta.url), 'utf8'),
  ]);
  registry = JSON.parse(registryJson);
  manifest = JSON.parse(manifestJson);
  fullTracks = JSON.parse(databaseJson).tracks;
  locatorTracks = JSON.parse(locatorJson).tracks;
});

describe('reviewed track social-link registry', () => {
  it('is the exact allowlist for full and locator output', () => {
    expect(validateTrackSocialLinkRegistry(registry, fullTracks)).toEqual([]);
    expect(validateTrackSocialLinkParity(registry, fullTracks)).toEqual([]);
    expect(validateTrackSocialLinkParity(registry, locatorTracks, 'public locator')).toEqual([]);
    expect(registry.tracksEvaluated).toBe(1_305);
    expect(registry.links.filter((entry: any) => entry.tiktok)).toHaveLength(2);
    expect(registry.links.filter((entry: any) => entry.youtube)).toHaveLength(12);
  });

  it('fails closed for unreviewed inputs and overlays only registry values', () => {
    const [cleaned] = applyTrackSocialLinkRegistry([{
      id: 'track-one',
      tiktokUrl: 'https://www.tiktok.com/@unreviewed',
      youtubeUrl: 'https://www.youtube.com/@unreviewed',
      sourceRecord: { socialLinkProvenance: { youtube: { sourceKind: 'unreviewed' } } },
    }], { schemaVersion: 1, tracksEvaluated: 1, links: [] });
    expect(cleaned).not.toHaveProperty('tiktokUrl');
    expect(cleaned).not.toHaveProperty('youtubeUrl');
    expect(cleaned.sourceRecord).not.toHaveProperty('socialLinkProvenance');
  });

  it('rejects content URLs, lookalike hosts, duplicate accounts, and unknown tracks', () => {
    const invalid = {
      schemaVersion: 1,
      tracksEvaluated: fullTracks.length,
      links: [
        {
          trackId: fullTracks[0].id,
          youtube: {
            url: 'https://www.youtube.com/watch?v=video',
            sourceUrl: 'https://localhost/source',
            requestedSourceUrl: 'https://example.com/source',
            sourceKind: 'exact-official-website',
            evidence: [{}],
          },
        },
        {
          trackId: 'unknown-track',
          youtube: {
            url: 'https://youtube.com.evil.test/@track',
            sourceUrl: 'https://public.example.test/source',
            requestedSourceUrl: 'https://public.example.test/source',
            sourceKind: 'guess',
            evidence: [],
          },
        },
      ],
    };
    expect(validateTrackSocialLinkRegistry(invalid, fullTracks)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid youtube account URL'),
      expect.stringContaining('invalid youtube sourceUrl'),
      expect.stringContaining('unknown trackId'),
      expect.stringContaining('invalid youtube sourceKind'),
      expect.stringContaining('missing youtube evidence'),
    ]));

    const repeatedAccount = (trackId: string) => ({
      trackId,
      youtube: {
        url: 'https://www.youtube.com/@same-track-account',
        sourceUrl: 'https://www.usabmx.com/tracks/al-oak-mountain-bmx',
        requestedSourceUrl: 'https://www.usabmx.com/tracks/al-oak-mountain-bmx',
        sourceKind: 'exact-official-website',
        evidence: [{}],
      },
    });
    expect(validateTrackSocialLinkRegistry({
      schemaVersion: 1,
      auditedAt: '2026-08-23T00:00:00.000Z',
      tracksEvaluated: fullTracks.length,
      links: [repeatedAccount(fullTracks[0].id), repeatedAccount(fullTracks[1].id)]
        .sort((left, right) => left.trackId.localeCompare(right.trackId)),
    }, fullTracks)).toEqual(expect.arrayContaining([
      expect.stringContaining(`youtube URL duplicates`),
    ]));
  });
});

describe('social audit completeness and network boundaries', () => {
  it('records a final result for every catalog track and exactly backs the registry', () => {
    expect(validateTrackSocialAuditManifest(manifest, registry, fullTracks)).toEqual([]);
    expect(manifest.records).toHaveLength(1_305);
    expect(new Set(manifest.records.map((record: any) => record.trackId)).size).toBe(1_305);
    expect(manifest.summary.pendingCandidates).toBe(0);
    expect(manifest.summary.staleReviewDecisions).toBe(0);
    expect(manifest.summary.conflictingVerified).toBe(0);
    expect(manifest.summary.duplicateVerifiedUrls).toBe(0);
    expect(manifest.summary.retainedSourceUrlsEvaluated).toBe(295);
    expect(manifest.summary.retainedSocialMetadataValuesEvaluated).toBe(0);
    expect(manifest.summary.catalogExcludedRetainedUrlsEvaluated).toBe(2);
    expect(manifest.summary.exactPagesPlanned).toBe(426);
    expect(manifest.summary.uniquePagesRequested).toBe(426);
    expect(manifest.summary.candidatesFound).toBe(21);
    expect(manifest.summary.rejectedCandidates).toBe(7);
  });

  it('blocks private, reserved, credentialed, and custom-port audit targets', () => {
    for (const value of [
      'http://localhost/path',
      'http://intranet/path',
      'http://127.0.0.1/path',
      'http://10.1.2.3/path',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/path',
      'http://[fd00::1]/path',
      'http://[::ffff:127.0.0.1]/path',
      'http://router.home.arpa/path',
      'https://example.com/path',
      'https://user:secret@track.example/path',
      'https://track.example:8443/path',
      'https://www.usabmx.com:8443/path',
    ]) {
      expect(normalizePublicHttpUrl(value)).toBeUndefined();
    }
    expect(normalizePublicHttpUrl('https://www.usabmx.com/tracks/al-oak-mountain-bmx'))
      .toBe('https://www.usabmx.com/tracks/al-oak-mountain-bmx');
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('192.0.78.12')).toBe(true);
    expect(isPublicIpAddress('192.168.1.1')).toBe(false);
    expect(isPublicIpAddress('192.0.2.10')).toBe(false);
    expect(isPublicIpAddress('198.51.100.10')).toBe(false);
    expect(isPublicIpAddress('203.0.113.10')).toBe(false);
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true);
    expect(isPublicIpAddress('2001:db8::1')).toBe(false);
  });
});
