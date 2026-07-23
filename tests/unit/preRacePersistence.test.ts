import { describe, expect, it } from 'vitest';
import {
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
});
