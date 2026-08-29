import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bmxEventAmbienceLayerVolumes,
  bmxEventAmbienceProfile,
  bmxEventAmbienceSources,
  bmxEventAmbienceVariationCount,
  raceAudioMixProfile,
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

  it('keeps configured ambience under commentary while reserving cadence headroom', () => {
    const normal = bmxEventAmbienceLayerVolumes(0.1);
    const commentary = bmxEventAmbienceLayerVolumes(0.1, { commentary: true });
    const gate = bmxEventAmbienceLayerVolumes(0.1, { gate: true });
    const both = bmxEventAmbienceLayerVolumes(0.1, { commentary: true, gate: true });

    expect(normal).toEqual({ bed: 0.042, crowd: 0.012 });
    expect(commentary).toEqual(normal);
    expect(gate.bed).toBeCloseTo(normal.bed * 0.025, 10);
    expect(gate.crowd).toBeCloseTo(normal.crowd * 0.025, 10);
    expect(both).toEqual(gate);
    expect(raceAudioMixProfile.cadenceVoiceGain).toBeGreaterThan(2);
    expect(raceAudioMixProfile.cadenceToneVolume).toBeGreaterThan(0.65);
  });

  it('clamps unreasonable ambience preferences before applying the fixed mix', () => {
    expect(bmxEventAmbienceLayerVolumes(-1)).toEqual({ bed: 0, crowd: 0 });
    expect(bmxEventAmbienceLayerVolumes(4)).toEqual({ bed: 0.084, crowd: 0.024 });
  });
});
