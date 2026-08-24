import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadLeaderboards,
  loadGhostLaps,
  loadPreRaceRiderStats,
  loadTrainingSessions,
  saveGhostLap,
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
    await saveLocalRaceResults({
      ...common,
      sessionId: `legacy-corrupt-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: 'Maya Torres',
        rank: 1,
        finishTimeMs: 1,
        distanceMeters: 340,
        topCadence: 923_334,
        averageCadence: 68_458.7,
        topSpeedKph: 151_080.1,
        averageSpeedKph: 9.4,
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
    const history = await loadTrainingSessions(profileKey, { from: 0, to: Date.now() + 1_000 });
    const finishes = history.flatMap((session: any) => (
      Array.isArray(session.details?.summaries)
        ? session.details.summaries.map((summary: any) => summary.finishTimeMs)
        : []
    ));
    expect(finishes).not.toContain(1);
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

  it('keeps legacy corrupt cadence and speed rows off public leaderboards', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const trackId = `legacy-corrupt-leaderboard-${suffix}`;
    const save = (profileKey: string, riderName: string, topCadence: number, topSpeedKph: number) => (
      saveLocalRaceResults({
        profileKey,
        trackId,
        trackName: 'Legacy Guard BMX',
        sessionId: `${profileKey}-${suffix}`,
        summaries: [{
          playerId: 1,
          riderName,
          rank: 1,
          finishTimeMs: 30_000,
          distanceMeters: 340,
          topCadence,
          topSpeedKph,
        }],
      })
    );

    await save(`user:valid-${suffix}`, 'Valid boundary', 200, 83);
    await save(`user:fraction-${suffix}`, 'Over fractional boundary', 200.01, 83.01);
    await save(`user:legacy-${suffix}`, 'Legacy corrupt', 923_334, 151_080.1);
    await saveLocalRaceResults({
      profileKey: `user:no-sensors-${suffix}`,
      trackId,
      trackName: 'Legacy Guard BMX',
      sessionId: `no-sensors-${suffix}`,
      summaries: [{
        playerId: 1,
        riderName: 'No sensor metrics',
        rank: 1,
        finishTimeMs: 30_000,
        distanceMeters: 340,
      }],
    });

    const leaderboards = await loadLeaderboards(trackId, 10);
    expect(leaderboards.rpm).toEqual([expect.objectContaining({ rider: 'Valid boundary', value: 200 })]);
    expect(leaderboards.speed).toEqual([
      expect.objectContaining({ rider: 'Valid boundary', value: expect.closeTo(83 * 0.621371, 5) }),
    ]);
  });

  it('quarantines a legacy corrupt fastest ghost before ranking and limiting', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const trackId = `legacy-ghost-${suffix}`;
    const save = (riderName: string, finishTimeMs: number, summary: Record<string, number>) => saveGhostLap({
      version: 1,
      id: `ghost-${riderName}-${suffix}`,
      trackId,
      trackName: 'Legacy Ghost Guard BMX',
      riderName,
      ownerKey: `user:${riderName}-${suffix}`,
      ownerName: riderName,
      colorName: 'lime',
      accent: '#7ade36',
      source: 'personal',
      raceSource: 'live',
      lapCount: 1,
      finishTimeMs,
      thirtyFootTimeMs: null,
      savedAt: Date.now(),
      analyticsPublic: true,
      medalRank: null,
      summary,
      zoneResults: [],
      points: [
        { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
        { elapsedMs: finishTimeMs, distanceMeters: 300, velocityMps: 10, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      ],
    });

    await save('Corrupt fastest', 1, { topCadence: 923_334, topSpeedKph: 151_080.1 });
    await save('Valid first', 20_000, { topCadence: 200, averageCadence: 180, topSpeedKph: 83, averageSpeedKph: 70 });
    await save('Valid second', 21_000, { topCadence: 190, averageCadence: 170, topSpeedKph: 75, averageSpeedKph: 65 });

    const ghosts = await loadGhostLaps(trackId, '', [], 1);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ riderName: 'Valid first', finishTimeMs: 20_000, medalRank: 1 });
  });

  it('lets a slower valid ghost replace a legacy spike under the same personal-best key', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const trackId = `legacy-ghost-replacement-${suffix}`;
    const ownerKey = `user:legacy-ghost-replacement-${suffix}`;
    const ghost = (id: string, finishTimeMs: number, summary: Record<string, number>, savedAt: number) => ({
      version: 1,
      id,
      trackId,
      trackName: 'Legacy Replacement BMX',
      riderName: 'Recovering Rider',
      ownerKey,
      ownerName: 'Recovering Rider',
      colorName: 'lime',
      accent: '#7ade36',
      source: 'personal',
      raceSource: 'live',
      lapCount: 1,
      finishTimeMs,
      thirtyFootTimeMs: null,
      savedAt,
      analyticsPublic: true,
      medalRank: null,
      summary,
      zoneResults: [],
      points: [
        { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
        { elapsedMs: finishTimeMs, distanceMeters: 300, velocityMps: 10, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
      ],
    });
    await saveGhostLap(ghost('legacy-spike', 1, { topCadence: 923_334, topSpeedKph: 151_080.1 }, 1_000));
    const replacement = await saveGhostLap(ghost(
      'valid-replacement',
      20_000,
      { topCadence: 190, averageCadence: 170, topSpeedKph: 75, averageSpeedKph: 65 },
      2_000,
    ));

    expect(replacement).toMatchObject({ id: 'valid-replacement', finish_time_ms: 20_000 });
    const ghosts = await loadGhostLaps(trackId, ownerKey, [], 30);
    expect(ghosts.find((entry) => entry.riderName === 'Recovering Rider')).toMatchObject({
      id: 'valid-replacement',
      finishTimeMs: 20_000,
    });

    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    expect(source).toContain('!storedGhostHasAcceptedBikeMetrics(current)');
    expect(source).toContain('WHERE NOT (${acceptedGhostBikeMetricsSql(`${schema}.ghost_laps`)})');
  });

  it('quarantines every rider outcome from a race with one corrupt sibling', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const trackId = `whole-race-quarantine-${suffix}`;
    const sessionId = `shared-race-${suffix}`;
    const corruptProfile = `user:corrupt-winner-${suffix}`;
    const validProfile = `user:valid-loser-${suffix}`;
    await saveLocalRaceResults({
      sessionId,
      profileKey: corruptProfile,
      trackId,
      trackName: 'Whole Race Guard BMX',
      summaries: [{
        playerId: 1,
        riderName: 'Corrupt Winner',
        rank: 1,
        finishTimeMs: 1,
        distanceMeters: 300,
        topCadence: 923_334,
      }],
    });
    await saveLocalRaceResults({
      sessionId,
      profileKey: validProfile,
      trackId,
      trackName: 'Whole Race Guard BMX',
      summaries: [{
        playerId: 2,
        riderName: 'Valid Loser',
        rank: 2,
        finishTimeMs: 20_000,
        distanceMeters: 300,
        topCadence: 180,
      }],
    });

    await expect(loadPreRaceRiderStats(trackId, validProfile, ['Valid Loser'])).resolves.toEqual([]);
    await expect(loadTrainingSessions(validProfile, { from: 0, to: Date.now() + 1_000 })).resolves.toEqual([]);
  });
});
