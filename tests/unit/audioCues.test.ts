import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bmxEventAmbienceProfile,
  bmxEventAmbienceSources,
  bmxEventAmbienceVariationCount,
} from '../../src/lib/audioCues';

describe('race ambience asset', () => {
  it('ships every licensed event ambience source used by the race', () => {
    const licensePath = resolve(process.cwd(), 'public/assets/AMBIENCE.md');

    expect(bmxEventAmbienceSources).toHaveLength(7);
    for (const source of bmxEventAmbienceSources) {
      const assetPath = resolve(process.cwd(), 'public', source.url.replace(/^\//, ''));
      expect(existsSync(assetPath)).toBe(true);
      expect(readFileSync(assetPath).byteLength).toBeGreaterThan(100_000);
    }
    const license = readFileSync(licensePath, 'utf8');
    expect(license).toMatch(/Mixkit Sound Effects Free License/);
    expect(license).toMatch(/112 race-by-race ambience profiles/);
  });

  it('builds at least 100 materially distinct race ambience profiles', () => {
    const profiles = Array.from(
      { length: bmxEventAmbienceVariationCount },
      (_, index) => bmxEventAmbienceProfile(index),
    );
    const signatures = profiles.map((profile) => (
      `${profile.sourceUrl}:${profile.startOffsetSeconds}:${profile.playbackRate}`
    ));

    expect(bmxEventAmbienceVariationCount).toBeGreaterThanOrEqual(100);
    expect(new Set(signatures).size).toBe(bmxEventAmbienceVariationCount);
    expect(new Set(profiles.map((profile) => profile.sourceUrl)).size).toBe(7);
  });
});
