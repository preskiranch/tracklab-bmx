import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bikeRaceAudioMode,
  bmxBikeMechanicsUrl,
} from '../../src/lib/bikeRaceAudio';

const movingRider = {
  driveAllowed: true,
  finishedAt: null,
  lastRawCadence: 92,
  velocity: 8,
};

describe('per-rider BMX bike audio', () => {
  it('follows the same pedal-zone state used by the rider animation', () => {
    expect(bikeRaceAudioMode('racing', movingRider)).toBe('pedaling');
    expect(bikeRaceAudioMode('racing', {
      ...movingRider,
      driveAllowed: false,
    })).toBe('freewheel');
    expect(bikeRaceAudioMode('racing', {
      ...movingRider,
      lastRawCadence: 0,
    })).toBe('silent');
  });

  it('stays silent outside a live race and after a rider finishes', () => {
    expect(bikeRaceAudioMode('ready', movingRider)).toBe('silent');
    expect(bikeRaceAudioMode('finished', movingRider)).toBe('silent');
    expect(bikeRaceAudioMode('racing', {
      ...movingRider,
      finishedAt: 12_500,
    })).toBe('silent');
  });

  it('ships the attributed BMX recording with the application', () => {
    const assetPath = resolve(
      process.cwd(),
      'public',
      bmxBikeMechanicsUrl.replace(/^\//, ''),
    );
    const creditPath = resolve(process.cwd(), 'public/assets/BIKE-AUDIO.md');

    expect(existsSync(assetPath)).toBe(true);
    expect(readFileSync(assetPath).byteLength).toBeGreaterThan(500_000);
    expect(readFileSync(creditPath, 'utf8')).toMatch(
      /Creative Commons Attribution 4\.0/,
    );
  });
});
