import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ghostsForTrackRoute,
  legacyRacePersistencePlan,
  loadGhostLapsFromCloud,
  mergeGhostLaps,
  playbackGhostLap,
  sanitizeGhostLap,
} from '../../src/lib/ghosts';

function rawGhost(lapCount: number, riderName = 'Studio Rider') {
  return {
    version: 1,
    id: `ghost-${lapCount}-${riderName}`,
    trackId: 'lasalle-loop',
    trackName: 'La Salle University',
    riderName,
    ownerKey: 'user:studio',
    ownerName: 'Studio',
    colorName: 'lime',
    accent: '#7ade36',
    source: 'personal',
    raceSource: 'live',
    lapCount,
    finishTimeMs: lapCount * 20_000,
    thirtyFootTimeMs: 1_800,
    savedAt: 1_000,
    analyticsPublic: false,
    medalRank: lapCount === 1 ? 1 : 2,
    summary: null,
    zoneResults: [],
    points: [
      { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: lapCount * 20_000, distanceMeters: lapCount * 300, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    ],
  };
}

describe('ghost lap categories and privacy metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps DNF race and training history when no playback ghost can be built', () => {
    expect(legacyRacePersistencePlan(1, 0)).toEqual({
      saveHistory: true,
      saveGhosts: false,
    });
    expect(legacyRacePersistencePlan(1, 1)).toEqual({
      saveHistory: true,
      saveGhosts: true,
    });
    expect(legacyRacePersistencePlan(0, 0)).toEqual({
      saveHistory: false,
      saveGhosts: false,
    });
  });

  it('keeps one-lap and multi-lap records in separate race selections', () => {
    const oneLap = sanitizeGhostLap(rawGhost(1));
    const threeLaps = sanitizeGhostLap(rawGhost(3, 'Three Lap Rider'));
    expect(oneLap).not.toBeNull();
    expect(threeLaps).not.toBeNull();

    const ghosts = [oneLap!, threeLaps!];
    expect(ghostsForTrackRoute(ghosts, 'lasalle-loop', undefined, 1).map((ghost) => ghost.id)).toEqual([oneLap!.id]);
    expect(ghostsForTrackRoute(ghosts, 'lasalle-loop', undefined, 3).map((ghost) => ghost.id)).toEqual([threeLaps!.id]);
  });

  it('keeps straight-sprint records separate by distance and Air setting', () => {
    const airFive = sanitizeGhostLap({
      ...rawGhost(1, 'Sprint Rider'),
      sprintDistanceFeet: 500,
      sprintAirSetting: 5,
    });
    const airSix = sanitizeGhostLap({
      ...rawGhost(1, 'Sprint Rider'),
      id: 'ghost-air-six',
      sprintDistanceFeet: 500,
      sprintAirSetting: 6,
    });
    const sixHundredFeet = sanitizeGhostLap({
      ...rawGhost(1, 'Sprint Rider'),
      id: 'ghost-six-hundred',
      sprintDistanceFeet: 600,
      sprintAirSetting: 5,
    });

    const ghosts = [airFive!, airSix!, sixHundredFeet!];
    expect(ghostsForTrackRoute(ghosts, 'lasalle-loop', undefined, 1, 500, 5))
      .toEqual([airFive]);
    expect(ghostsForTrackRoute(ghosts, 'lasalle-loop', undefined, 1, 500, 6))
      .toEqual([airSix]);
    expect(ghostsForTrackRoute(ghosts, 'lasalle-loop', undefined, 1, 600, 5))
      .toEqual([sixHundredFeet]);
  });

  it('defaults legacy ghosts to one lap with private analytics and no medal', () => {
    const legacy = rawGhost(1) as Record<string, unknown>;
    delete legacy.lapCount;
    delete legacy.analyticsPublic;
    delete legacy.medalRank;
    delete legacy.raceSource;

    expect(sanitizeGhostLap(legacy)).toMatchObject({
      lapCount: 1,
      analyticsPublic: false,
      medalRank: null,
      raceSource: 'live',
    });
  });

  it('separates legacy demo ghosts from personal live Wattbike ghosts', () => {
    const legacyDemo = rawGhost(1, 'Demo Rider 2') as Record<string, unknown>;
    const legacyLive = rawGhost(1, 'Wattbike Trainer') as Record<string, unknown>;
    delete legacyDemo.raceSource;
    delete legacyLive.raceSource;

    expect(sanitizeGhostLap(legacyDemo)?.raceSource).toBe('demo');
    expect(sanitizeGhostLap(legacyLive)?.raceSource).toBe('live');
  });

  it('does not retain demo laps in the selectable ghost collection', () => {
    const demoGhost = rawGhost(1, 'Demo Rider 1');
    demoGhost.raceSource = 'demo';

    expect(mergeGhostLaps([], [demoGhost])).toEqual([]);
  });

  it('quarantines legacy ghosts created from corrupt cadence or speed', () => {
    const corruptSummary = {
      ...rawGhost(1, 'Corrupt summary'),
      finishTimeMs: 1,
      summary: { topCadence: 923_334, averageCadence: 68_458.7, topSpeedKph: 151_080.1 },
    };
    const corruptPoint = {
      ...rawGhost(1, 'Corrupt point'),
      finishTimeMs: 1,
      points: [
        rawGhost(1).points[0],
        { ...rawGhost(1).points[1], velocityMps: 41_966.7 },
      ],
    };
    const boundary = {
      ...rawGhost(1, 'Boundary rider'),
      summary: { topCadence: 200, averageCadence: 200, topSpeedKph: 83, averageSpeedKph: 83 },
      points: rawGhost(1).points.map((point) => ({ ...point, velocityMps: 83 / 3.6 })),
    };

    expect(sanitizeGhostLap(corruptSummary)).toBeNull();
    expect(sanitizeGhostLap(corruptPoint)).toBeNull();
    expect(sanitizeGhostLap(boundary)).not.toBeNull();
    expect(mergeGhostLaps([], [corruptSummary, corruptPoint])).toEqual([]);
  });

  it('preserves a safe rider photo for ranked ghost cards', () => {
    const ghost = rawGhost(1) as ReturnType<typeof rawGhost> & { photoUrl?: string };
    ghost.photoUrl = 'data:image/jpeg;base64,QUJDRA==';

    expect(sanitizeGhostLap(ghost)?.photoUrl).toBe(ghost.photoUrl);
  });

  it('ranks selectable ghosts by finish time regardless of ownership source', () => {
    const personal = rawGhost(1, 'Personal Rider');
    personal.finishTimeMs = 23_000;
    const friend = rawGhost(1, 'Friend Rider');
    friend.source = 'friend';
    friend.finishTimeMs = 21_000;
    const worldwide = rawGhost(1, 'Worldwide Rider');
    worldwide.source = 'top';
    worldwide.finishTimeMs = 19_000;

    const ranked = [personal, friend, worldwide]
      .map(sanitizeGhostLap)
      .filter((ghost) => ghost != null);

    expect(ghostsForTrackRoute(ranked, 'lasalle-loop').map((ghost) => ghost.riderName)).toEqual([
      'Worldwide Rider',
      'Friend Rider',
      'Personal Rider',
    ]);
  });

  it('requests a focused friend ghost without treating the client hint as authorization', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ghosts: [rawGhost(1, 'Friend Rider')] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    await loadGhostLapsFromCloud(
      'lasalle-loop',
      'user:me',
      [],
      { distanceFeet: 500, airSetting: 5 },
      { ghostId: 'friend-ghost-1', profileId: 'friend-profile-1' },
    );

    const url = new URL(String(fetcher.mock.calls[0]?.[0]), 'https://tracklab.test');
    expect(url.searchParams.get('trackId')).toBe('lasalle-loop');
    expect(url.searchParams.get('friendGhostId')).toBe('friend-ghost-1');
    expect(url.searchParams.get('friendProfileId')).toBe('friend-profile-1');
    expect(url.searchParams.get('sprintDistanceFeet')).toBe('500');
    expect(url.searchParams.get('sprintAirSetting')).toBe('5');
  });

  it('stages a selected ghost at rest on the start line before playback begins', () => {
    const savedGhost = rawGhost(1);
    savedGhost.points[0].distanceMeters = 4.5;
    savedGhost.points[0].velocityMps = 8;
    const ghost = sanitizeGhostLap(savedGhost);
    expect(ghost).not.toBeNull();

    expect(playbackGhostLap(ghost!, 0, 0)).toMatchObject({
      colorName: 'yellow',
      accent: '#ff6a00',
      distance: 0,
      velocity: 0,
      phase: 'pedaling',
      finishedAt: null,
    });
  });

  it('interpolates a sparse race ghost forward across normal and dropped render frames', () => {
    const savedGhost = rawGhost(1, 'Frame-stable ghost');
    savedGhost.finishTimeMs = 1_000;
    savedGhost.points = [
      { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 250, distanceMeters: 10, velocityMps: 20, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 1_000, distanceMeters: 40, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    ];
    const ghost = sanitizeGhostLap(savedGhost);
    expect(ghost).not.toBeNull();

    // Includes a 250ms dropped-frame gap between 250ms and 500ms. Playback
    // must advance from elapsed time, not reset or wait for every frame.
    const playback = [0, 16, 33, 250, 500, 750, 999, 1_000, 1_250]
      .map((elapsedMs) => playbackGhostLap(ghost!, elapsedMs, 0)!);

    expect(playback.map((rider) => rider.distance)).toEqual([
      0,
      0.64,
      1.32,
      10,
      20,
      30,
      39.96,
      40,
      40,
    ]);
    expect(playback.every((rider, index) => (
      index === 0 || rider.distance >= playback[index - 1].distance
    ))).toBe(true);
    expect(playback.at(-1)).toMatchObject({
      distance: 40,
      velocity: 0,
      finishedAt: 1_000,
    });
  });

  it('interpolates a late first trace sample from the start line instead of teleporting', () => {
    const savedGhost = rawGhost(1, 'Late trace rider');
    savedGhost.points = [
      // Older recordings could start at the first post-render point rather
      // than an explicit gate-origin sample.
      { elapsedMs: 800, distanceMeters: 8, velocityMps: 10, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 20_000, distanceMeters: 300, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    ];

    const ghost = sanitizeGhostLap(savedGhost);
    expect(ghost).not.toBeNull();
    expect(ghost!.points[0]).toMatchObject({ elapsedMs: 0, distanceMeters: 0, velocityMps: 0 });
    expect(playbackGhostLap(ghost!, 80, 0)?.distance).toBeCloseTo(0.8, 5);
    expect(playbackGhostLap(ghost!, 400, 0)?.distance).toBeCloseTo(4, 5);
  });

  it('holds the final traced ghost position through a terminal trace gap', () => {
    const savedGhost = rawGhost(1, 'Interrupted trace rider');
    savedGhost.finishTimeMs = 1_000;
    savedGhost.points = [
      { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 800, distanceMeters: 8, velocityMps: 10, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    ];

    const ghost = sanitizeGhostLap(savedGhost);
    expect(ghost).not.toBeNull();
    expect(playbackGhostLap(ghost!, 900, 0)).toMatchObject({
      distance: 8,
      velocity: 0,
      finishedAt: null,
    });
  });

  it('keeps malformed ghost trace distances monotonic instead of correcting backward', () => {
    const savedGhost = rawGhost(1, 'Corrected trace rider');
    savedGhost.points = [
      { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 100, distanceMeters: 5, velocityMps: 20, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 200, distanceMeters: 2, velocityMps: 20, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      { elapsedMs: 20_000, distanceMeters: 300, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    ];

    const ghost = sanitizeGhostLap(savedGhost);
    expect(ghost).not.toBeNull();
    expect(ghost!.points.every((point, index) => (
      index === 0 || point.distanceMeters >= ghost!.points[index - 1].distanceMeters
    ))).toBe(true);
  });
});
