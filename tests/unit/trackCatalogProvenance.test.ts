import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

type CatalogTrack = {
  id: string;
  country: string;
  providerId?: string;
  verificationStatus?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

type TrackDatabase = {
  trackCount: number;
  coverage?: {
    countries?: number;
    officialRecords?: number;
    supplementalRecords?: number;
  };
  tracks: CatalogTrack[];
};

let database: TrackDatabase;

beforeAll(async () => {
  const path = new URL('../../public/data/track-database.json', import.meta.url);
  database = JSON.parse(await readFile(path, 'utf8')) as TrackDatabase;
});

describe('global track catalog provenance', () => {
  it('keeps the generated count and identifiers consistent', () => {
    expect(database.trackCount).toBe(database.tracks.length);
    expect(new Set(database.tracks.map((track) => track.id)).size).toBe(database.tracks.length);
  });

  it('requires official and federation records to retain usable locator data', () => {
    const official = database.tracks.filter((track) => (
      track.verificationStatus === 'official-track-directory'
      || track.verificationStatus === 'federation-directory'
    ));
    expect(official.length).toBeGreaterThan(600);
    official.forEach((track) => {
      expect(track.providerId).toBeTruthy();
      expect(track.address).toBeTruthy();
      expect(Number.isFinite(track.latitude)).toBe(true);
      expect(Number.isFinite(track.longitude)).toBe(true);
    });
  });

  it('includes the official AusCycling feed and priority global locations', () => {
    expect(database.tracks.filter((track) => track.providerId === 'auscycling').length).toBeGreaterThanOrEqual(100);
    expect(database.tracks.some((track) => track.country === 'Aruba')).toBe(true);
    expect(database.tracks.some((track) => track.country === 'China')).toBe(true);
  });

  it('never represents supplemental community data as federation verified', () => {
    const supplemental = database.tracks.filter((track) => track.verificationStatus === 'supplemental');
    expect(supplemental.length).toBeGreaterThan(0);
    supplemental.forEach((track) => expect(track.providerId).toBe('openstreetmap-overpass'));
    expect(database.coverage?.supplementalRecords).toBe(supplemental.length);
  });
});
