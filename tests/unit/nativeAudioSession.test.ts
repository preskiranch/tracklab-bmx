import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native iPad race audio session', () => {
  it('declares TrackLab race audio as primary playback without activating at launch', () => {
    const source = readFileSync(
      new URL('../../ios/App/App/AppDelegate.swift', import.meta.url),
      'utf8',
    );

    expect(source).toContain('import AVFAudio');
    expect(source).toMatch(/setCategory\(\s*\.playback,\s*mode:\s*\.moviePlayback/s);
    expect(source).not.toMatch(/setActive\(true/);
  });

  it('eagerly primes the commentary media element inside the user gesture stack', () => {
    const source = readFileSync(
      new URL('../../src/hooks/useRaceCommentary.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/import\s*\{[\s\S]*primeCommentaryMediaElement[\s\S]*\}\s*from '\.\.\/lib\/commentaryMediaPrime';/);
    expect(source).not.toContain("import('../lib/commentaryMediaPrime')");
    expect(source).toContain('const mediaPrime = primeCommentaryMediaElement({');
  });
});
