import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bmxEventAmbienceUrl } from '../../src/lib/audioCues';

describe('race ambience asset', () => {
  it('ships the licensed event ambience at the public URL used by the race', () => {
    const assetPath = resolve(process.cwd(), 'public', bmxEventAmbienceUrl.replace(/^\//, ''));
    const licensePath = resolve(process.cwd(), 'public/assets/AMBIENCE.md');

    expect(existsSync(assetPath)).toBe(true);
    expect(readFileSync(assetPath).byteLength).toBeGreaterThan(100_000);
    expect(readFileSync(licensePath, 'utf8')).toMatch(/Mixkit Sound Effects Free License/);
  });
});
