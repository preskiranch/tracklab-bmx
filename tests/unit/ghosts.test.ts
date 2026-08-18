import { describe, expect, it } from 'vitest';
import { ghostsForTrackRoute, mergeGhostLaps, playbackGhostLap, sanitizeGhostLap } from '../../src/lib/ghosts';

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
});
