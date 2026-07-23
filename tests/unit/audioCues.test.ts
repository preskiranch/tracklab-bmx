import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bmxEventAmbienceProfile,
  bmxEventAmbienceSources,
  bmxEventAmbienceVariationCount,
} from '../../src/lib/audioCues';

describe('race ambience asset', () => {
  it('ships both licensed sources used by the continuous race soundscape', () => {
    const licensePath = resolve(process.cwd(), 'public/assets/AMBIENCE.md');

    expect(bmxEventAmbienceSources).toHaveLength(2);
    for (const source of bmxEventAmbienceSources) {
      const assetPath = resolve(process.cwd(), 'public', source.url.replace(/^\//, ''));
      expect(existsSync(assetPath)).toBe(true);
      expect(readFileSync(assetPath).byteLength).toBeGreaterThan(100_000);
    }
    const license = readFileSync(licensePath, 'utf8');
    expect(license).toMatch(/Mixkit Sound Effects Free License/);
    expect(license).toMatch(/128 race-by-race ambience profiles/);
    expect(license).toMatch(/always-on trackside crowd bed/);
  });

  it('builds at least 100 distinct profiles without entering the quiet crowd tail', () => {
    const profiles = Array.from(
      { length: bmxEventAmbienceVariationCount },
      (_, index) => bmxEventAmbienceProfile(index),
    );
    const signatures = profiles.map((profile) => (
      `${profile.bedStartOffsetSeconds}:${profile.startOffsetSeconds}:${profile.loopStartOffsetSeconds}:${profile.playbackRate}`
    ));

    expect(bmxEventAmbienceVariationCount).toBeGreaterThanOrEqual(100);
    expect(new Set(signatures).size).toBe(bmxEventAmbienceVariationCount);
    expect(new Set(profiles.map((profile) => profile.bedSourceUrl))).toEqual(new Set([
      bmxEventAmbienceSources[0].url,
    ]));
    expect(new Set(profiles.map((profile) => profile.sourceUrl))).toEqual(new Set([
      bmxEventAmbienceSources[1].url,
    ]));
    expect(profiles.every((profile) => (
      profile.startOffsetSeconds < profile.loopEndOffsetSeconds
      && profile.loopStartOffsetSeconds < profile.loopEndOffsetSeconds
      && profile.loopEndOffsetSeconds < bmxEventAmbienceSources[1].durationSeconds
    ))).toBe(true);
  });
});
