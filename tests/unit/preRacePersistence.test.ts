import { describe, expect, it } from 'vitest';
import {
  loadLeaderboards,
  loadPreRaceRiderStats,
  saveLocalRaceResults,
} from '../../cloud/persistence.mjs';

describe('pre-race rider history', () => {
  it('tracks starts, personal bests, wins, and the current winning streak', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const profileKey = `user:history-${suffix}`;
    const trackId = `track-${suffix}`;
    const common = {
      profileKey,
      trackId,
      trackName: 'History Test BMX',
    };

    await saveLocalRaceResults({
      ...common,
      sessionId: `one-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: 'Maya Torres',
        rank: 2,
        finishTimeMs: 32_000,
        distanceMeters: 340,
      }],
    });
    await saveLocalRaceResults({
      ...common,
      sessionId: `two-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: 'Maya Torres',
        rank: 1,
        finishTimeMs: 31_500,
        distanceMeters: 340,
      }],
    });
    await saveLocalRaceResults({
      ...common,
      sessionId: `three-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: 'Maya Torres',
        rank: 1,
        finishTimeMs: 31_200,
        distanceMeters: 340,
      }],
    });

    await expect(loadPreRaceRiderStats(trackId, profileKey, ['Maya Torres']))
      .resolves.toEqual([{
        name: 'Maya Torres',
        starts: 3,
        wins: 2,
        currentWinStreak: 2,
        bestFinishTimeMs: 31_200,
      }]);
  });

  it('returns rider photos and caps each track leaderboard at 50 records', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const trackId = `leaderboard-track-${suffix}`;
    const photoUrl = 'data:image/jpeg;base64,QUJDRA==';

    await Promise.all(Array.from({ length: 52 }, (_, index) => saveLocalRaceResults({
      profileKey: `user:leaderboard-${index}-${suffix}`,
      trackId,
      trackName: 'Leaderboard Test BMX',
      sessionId: `leaderboard-session-${index}-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: `Rider ${index + 1}`,
        photoUrl,
        rank: 1,
        finishTimeMs: 30_000 + index,
        distanceMeters: 340,
        topCadence: 200 - index,
      }],
    })));

    const leaderboards = await loadLeaderboards(trackId, 50);
    expect(leaderboards.rpm).toHaveLength(50);
    expect(leaderboards.rpm[0]).toMatchObject({
      rider: 'Rider 1',
      photoUrl,
      value: 200,
    });
    expect(leaderboards.rpm.at(-1)?.rider).toBe('Rider 50');
  });
});
