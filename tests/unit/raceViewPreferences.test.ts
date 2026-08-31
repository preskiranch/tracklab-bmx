import { describe, expect, it } from 'vitest';
import {
  defaultRaceCommentaryPreferences,
  defaultRaceRiderOverlayLayout,
  mergeRaceViewPreferences,
  normalizeDemoRiderNames,
  normalizeDemoRiderPhotos,
  normalizeRaceCommentaryPreferences,
  normalizeRaceRiderOverlayLayout,
  normalizeRaceViewPreferences,
} from '../../src/lib/raceViewPreferences';
import {
  applyGlobalRaceViewPreferences,
  globalRaceViewNeedsPublication,
} from '../../src/lib/globalRaceView';

describe('race view preferences', () => {
  it('uses a larger two-axis rider panel by default', () => {
    expect(defaultRaceRiderOverlayLayout).toMatchObject({
      width: 940,
      height: 220,
      locked: false,
    });
  });

  it('retries newer locked player-card layouts without requiring a saved camera', () => {
    const account = normalizeRaceViewPreferences({
      cameraLocked: false,
      earthCamerasByTrack: {},
      riderOverlaysByTrack: {
        'la-salle:sprint:100ft': {
          xPct: 0.04,
          yPct: 0.7,
          width: 820,
          height: 190,
          locked: true,
        },
      },
      riderOverlayUpdatedAtByTrack: { 'la-salle:sprint:100ft': 200 },
    });
    const staleGlobal = normalizeRaceViewPreferences({
      riderOverlaysByTrack: {
        'la-salle:sprint:100ft': {
          xPct: 0.04,
          yPct: 0.7,
          width: 940,
          height: 220,
          locked: true,
        },
      },
      riderOverlayUpdatedAtByTrack: { 'la-salle:sprint:100ft': 100 },
    });

    expect(globalRaceViewNeedsPublication(account, null)).toBe(true);
    expect(globalRaceViewNeedsPublication(account, staleGlobal)).toBe(true);
    expect(globalRaceViewNeedsPublication(account, account)).toBe(false);
    expect(globalRaceViewNeedsPublication(normalizeRaceViewPreferences({
      ...account,
      riderOverlaysByTrack: {
        'la-salle:sprint:100ft': {
          ...account.riderOverlaysByTrack['la-salle:sprint:100ft'],
          locked: false,
        },
      },
    }), staleGlobal)).toBe(false);
  });

  it('keeps newer locked camera and player-card edits applied while a global retry is pending', () => {
    const account = normalizeRaceViewPreferences({
      cameraLocked: true,
      cameraLockedUpdatedAt: 300,
      earthCamerasByTrack: {
        'la-salle:sprint:100ft': {
          angle: 42,
          heading: 120,
          zoom: 20,
          updatedAt: 300,
        },
      },
      riderOverlaysByTrack: {
        'la-salle:sprint:100ft': {
          xPct: 0.08,
          yPct: 0.72,
          width: 800,
          height: 190,
          locked: true,
        },
      },
      riderOverlayUpdatedAtByTrack: { 'la-salle:sprint:100ft': 300 },
    });
    const staleGlobal = normalizeRaceViewPreferences({
      cameraLocked: true,
      cameraLockedUpdatedAt: 100,
      earthCamerasByTrack: {
        'la-salle:sprint:100ft': {
          angle: 10,
          heading: 20,
          zoom: 17,
          updatedAt: 100,
        },
        'nelson-road:sprint:100ft': {
          angle: 30,
          heading: 90,
          zoom: 19,
          updatedAt: 250,
        },
      },
      riderOverlaysByTrack: {
        'la-salle:sprint:100ft': {
          xPct: 0.04,
          yPct: 0.7,
          width: 940,
          height: 220,
          locked: true,
        },
      },
      riderOverlayUpdatedAtByTrack: { 'la-salle:sprint:100ft': 100 },
    });

    expect(globalRaceViewNeedsPublication(account, staleGlobal)).toBe(true);
    const pendingRetryView = applyGlobalRaceViewPreferences(account, staleGlobal, {
      preserveNewerLockedAccountEntries: true,
    });

    expect(pendingRetryView.earthCamerasByTrack['la-salle:sprint:100ft']).toMatchObject({
      angle: 42,
      heading: 120,
      updatedAt: 300,
    });
    expect(pendingRetryView.riderOverlaysByTrack['la-salle:sprint:100ft']).toMatchObject({
      width: 800,
      height: 190,
      locked: true,
    });
    expect(pendingRetryView.riderOverlayUpdatedAtByTrack['la-salle:sprint:100ft']).toBe(300);
    expect(pendingRetryView.earthCamerasByTrack['nelson-road:sprint:100ft']).toMatchObject({
      angle: 30,
      heading: 90,
      updatedAt: 250,
    });

    // This is the snapshot App keeps if the retry rejects. Without the pending
    // option, the authoritative global behavior for ordinary clients is intact.
    expect(applyGlobalRaceViewPreferences(account, staleGlobal)
      .riderOverlaysByTrack['la-salle:sprint:100ft'].width).toBe(940);
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

  it('keeps the CSS reference viewport with saved camera and rider-panel composition', () => {
    const preferences = normalizeRaceViewPreferences({
      earthCamerasByTrack: {
        north: {
          angle: 47,
          heading: 90,
          zoom: 20,
          updatedAt: 12,
          referenceViewport: { width: 1366.125, height: 1024.555 },
        },
      },
      riderOverlaysByTrack: {
        north: {
          xPct: 0.04,
          yPct: 0.7,
          width: 940,
          height: 220,
          locked: true,
          referenceViewport: { width: 1366.125, height: 1024.555 },
        },
      },
    });

    expect(preferences.earthCamerasByTrack.north.referenceViewport).toEqual({
      width: 1366.13,
      height: 1024.56,
    });
    expect(preferences.riderOverlaysByTrack.north.referenceViewport).toEqual({
      width: 1366.13,
      height: 1024.56,
    });
  });

  it('normalizes the single announcer engine and bounded adaptive memory', () => {
    const commentary = normalizeRaceCommentaryPreferences({
      enabled: false,
      ambientEnabled: false,
      ambientVolume: 4,
      ambientVolumeLocked: false,
      model: 'unsupported-model',
      voicePreset: 'british-man',
      volume: 4,
      adaptiveMemory: false,
      recentLines: [...Array.from({ length: 300 }, (_, index) => ` Call ${index} `), 42],
    });

    expect(commentary).toMatchObject({
      enabled: false,
      ambientEnabled: false,
      ambientVolume: 0.2,
      ambientVolumeLocked: false,
      voicePreset: 'american-man',
      volume: 1,
      adaptiveMemory: true,
    });
    expect(commentary.recentLines).toHaveLength(240);
    expect(commentary.recentLines[0]).toBe('Call 60');
    expect(commentary.recentLines.at(-1)).toBe('Call 299');
    expect(commentary).not.toHaveProperty('model');
  });

  it('normalizes every legacy announcer choice to the American male voice', () => {
    expect(normalizeRaceCommentaryPreferences({
      voicePreset: 'american-woman',
    }).voicePreset).toBe('american-man');
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

  it('keeps only safe per-account demo rider photos', () => {
    const photoUrl = 'data:image/jpeg;base64,QUJDRA==';
    expect(normalizeDemoRiderPhotos({
      1: photoUrl,
      2: 'data:image/svg+xml;base64,PHN2Zz4=',
      5: photoUrl,
    })).toEqual({ 1: photoUrl });
  });

  it('keeps newer names and per-track layouts when a stale browser saves other preferences', () => {
    const current = normalizeRaceViewPreferences({
      cameraLocked: true,
      cameraLockedUpdatedAt: 200,
      earthCamerasByTrack: {
        north: { angle: 42, heading: 180, zoom: 20, updatedAt: 200 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0.1, yPct: 0.7, width: 1100, height: 260, locked: true },
      },
      riderOverlayUpdatedAtByTrack: { north: 200 },
      demoRiderNames: { 1: 'Maya Torres', 2: 'Jordan Lee' },
      demoRiderNamesUpdatedAt: 200,
      demoRiderPhotos: { 1: 'data:image/jpeg;base64,QUJDRA==' },
      demoRiderPhotosUpdatedAt: 200,
      commentary: { ...defaultRaceCommentaryPreferences, volume: 0.8 },
      commentaryUpdatedAt: 200,
    });
    const merged = mergeRaceViewPreferences(current, {
      cameraLocked: false,
      cameraLockedUpdatedAt: 100,
      earthCamerasByTrack: {
        north: { angle: 0, heading: 0, zoom: 17, updatedAt: 100 },
        south: { angle: 30, heading: 90, zoom: 19, updatedAt: 250 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0, yPct: 0, width: 320, height: 190, locked: false },
      },
      riderOverlayUpdatedAtByTrack: { north: 100 },
      demoRiderNames: {},
      demoRiderNamesUpdatedAt: 100,
      demoRiderPhotos: {},
      demoRiderPhotosUpdatedAt: 100,
      commentary: { ...defaultRaceCommentaryPreferences, volume: 0.6 },
      commentaryUpdatedAt: 300,
    });

    expect(merged.cameraLocked).toBe(true);
    expect(merged.earthCamerasByTrack.north).toMatchObject({ angle: 42, heading: 180, zoom: 20 });
    expect(merged.earthCamerasByTrack.south).toMatchObject({ angle: 30, heading: 90, zoom: 19 });
    expect(merged.riderOverlaysByTrack.north).toMatchObject({ width: 1100, height: 260, locked: true });
    expect(merged.demoRiderNames).toEqual({ 1: 'Maya Torres', 2: 'Jordan Lee' });
    expect(merged.demoRiderPhotos).toEqual({ 1: 'data:image/jpeg;base64,QUJDRA==' });
    expect(merged.commentary.volume).toBe(1);
  });

  it('uses zero revisions for legacy cameras so loading them does not invent a newer edit', () => {
    expect(normalizeRaceViewPreferences({
      earthCamerasByTrack: {
        north: { angle: 20, heading: 40 },
      },
    }).earthCamerasByTrack.north.updatedAt).toBe(0);
  });

  it('applies the developer camera globally without replacing account-only settings', () => {
    const account = normalizeRaceViewPreferences({
      cameraLocked: false,
      cameraLockedUpdatedAt: 400,
      earthCamerasByTrack: {
        north: { angle: 20, heading: 40, zoom: 18, updatedAt: 400 },
        south: { angle: 30, heading: 90, zoom: 19, updatedAt: 300 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0.1, yPct: 0.7, width: 900, height: 220, locked: true },
      },
      demoRiderNames: { 1: 'Maya Torres' },
      demoRiderNamesUpdatedAt: 500,
      commentary: { ...defaultRaceCommentaryPreferences, ambientEnabled: false },
      commentaryUpdatedAt: 500,
    });
    const global = normalizeRaceViewPreferences({
      cameraLocked: true,
      cameraLockedUpdatedAt: 900,
      earthCamerasByTrack: {
        north: { angle: 55, heading: 225, zoom: 21, updatedAt: 900 },
      },
      riderOverlaysByTrack: {
        north: { xPct: 0.04, yPct: 0.64, width: 940, height: 190, locked: true },
      },
      riderOverlayUpdatedAtByTrack: { north: 900 },
    });

    const applied = applyGlobalRaceViewPreferences(account, global);

    expect(applied.cameraLocked).toBe(true);
    expect(applied.earthCamerasByTrack.north).toMatchObject({
      angle: 55,
      heading: 225,
      zoom: 21,
    });
    expect(applied.earthCamerasByTrack.south).toMatchObject({
      angle: 30,
      heading: 90,
    });
    expect(applied.riderOverlaysByTrack.north).toMatchObject({
      xPct: 0.04,
      yPct: 0.64,
      width: 940,
      height: 190,
      locked: true,
    });
    expect(applied.riderOverlayUpdatedAtByTrack.north).toBe(900);
    expect(applied.demoRiderNames).toEqual({ 1: 'Maya Torres' });
    expect(applied.commentary.ambientEnabled).toBe(false);
  });
});
