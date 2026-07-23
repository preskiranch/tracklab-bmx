import { describe, expect, it } from 'vitest';
import {
  defaultRaceCommentaryPreferences,
  defaultRaceRiderOverlayLayout,
  normalizeDemoRiderNames,
  normalizeRaceCommentaryPreferences,
  normalizeRaceRiderOverlayLayout,
  normalizeRaceViewPreferences,
} from '../../src/lib/raceViewPreferences';

describe('race view preferences', () => {
  it('uses a larger two-axis rider panel by default', () => {
    expect(defaultRaceRiderOverlayLayout).toMatchObject({
      width: 940,
      height: 220,
      locked: false,
    });
  });

  it('normalizes saved panel size, position, and lock state', () => {
    expect(normalizeRaceRiderOverlayLayout({
      xPct: -1,
      yPct: 4,
      width: 2400,
      height: 20,
      locked: true,
    })).toEqual({
      xPct: 0,
      yPct: 1,
      width: 1800,
      height: 190,
      locked: true,
    });
  });

  it('keeps camera and rider panel preferences separated by track', () => {
    const preferences = normalizeRaceViewPreferences({
      cameraLocked: true,
      earthCamerasByTrack: {
        north: { angle: 20, heading: 370, zoom: 19, updatedAt: 12 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0.1, yPct: 0.6, width: 1000, height: 180, locked: true },
      },
    });

    expect(preferences.cameraLocked).toBe(true);
    expect(preferences.earthCamerasByTrack.north.heading).toBe(10);
    expect(preferences.riderOverlaysByTrack.north).toMatchObject({
      width: 1000,
      height: 190,
      locked: true,
    });
    expect(preferences.commentary).toEqual(defaultRaceCommentaryPreferences);
  });

  it('normalizes per-account announcer choices and bounded adaptive memory', () => {
    const commentary = normalizeRaceCommentaryPreferences({
      enabled: false,
      ambientEnabled: false,
      ambientVolume: 4,
      ambientVolumeLocked: false,
      model: 'unsupported-model',
      voicePreset: 'british-man',
      volume: 4,
      adaptiveMemory: false,
      recentLines: [...Array.from({ length: 120 }, (_, index) => ` Call ${index} `), 42],
    });

    expect(commentary).toMatchObject({
      enabled: false,
      ambientEnabled: false,
      ambientVolume: 0.2,
      ambientVolumeLocked: false,
      model: 'gpt-5.6-terra',
      voicePreset: 'british-man',
      volume: 1,
      adaptiveMemory: false,
    });
    expect(commentary.recentLines).toHaveLength(96);
    expect(commentary.recentLines[0]).toBe('Call 24');
    expect(commentary.recentLines.at(-1)).toBe('Call 119');
  });

  it('preserves the American woman announcer choice', () => {
    expect(normalizeRaceCommentaryPreferences({
      voicePreset: 'american-woman',
    }).voicePreset).toBe('american-woman');
  });

  it('normalizes four per-account demo rider names', () => {
    expect(normalizeDemoRiderNames({
      1: '  Maya   Torres ',
      2: 'Jordan Lee',
      4: 'R'.repeat(80),
      5: 'Not a valid lane',
    })).toEqual({
      1: 'Maya Torres',
      2: 'Jordan Lee',
      4: 'R'.repeat(64),
    });
  });
});
