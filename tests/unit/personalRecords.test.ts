import { describe, expect, it } from 'vitest';
import { personalRecordAchievements, previousPersonalBestTimes } from '../../src/lib/personalRecords';
import type { GhostLap, PlayerSlot } from '../../src/types';

const players: PlayerSlot[] = [
  { id: 1, name: 'Robby P', colorName: 'lime', accent: '#84e047', deviceId: 1 },
  { id: 2, name: 'Rasheen "The Machine" Hicks', colorName: 'blue', accent: '#38a8f5', deviceId: 2 },
  { id: 3, name: 'Barry Ellis', colorName: 'red', accent: '#ff4e48', deviceId: 3 },
  { id: 4, name: 'New Rider', colorName: 'yellow', accent: '#ffd83d', deviceId: 4 },
];

function ghost(overrides: Partial<GhostLap>): GhostLap {
  return {
    version: 1,
    id: 'ghost-1',
    trackId: 'test-track',
    trackName: 'Test Track',
    riderName: 'Robby P',
    ownerKey: 'owner-1',
    ownerName: 'Owner',
    colorName: 'lime',
    accent: '#84e047',
    source: 'personal',
    raceSource: 'live',
    lapCount: 1,
    finishTimeMs: 30_000,
    thirtyFootTimeMs: null,
    savedAt: 1,
    analyticsPublic: false,
    medalRank: null,
    summary: null,
    zoneResults: [],
    points: [],
    ...overrides,
  };
}

describe('personal race records', () => {
  it('freezes each entered rider previous best from the current account', () => {
    const bestTimes = previousPersonalBestTimes(players, [
      ghost({ id: 'robby-slower', finishTimeMs: 31_000 }),
      ghost({ id: 'robby-best', riderName: '  ROBBY   P ', finishTimeMs: 29_500 }),
      ghost({ id: 'rasheen-best', riderName: 'Rasheen "The Machine" Hicks', finishTimeMs: 30_250 }),
      ghost({ id: 'another-account', riderName: 'Barry Ellis', ownerKey: 'owner-2', finishTimeMs: 20_000 }),
      ghost({ id: 'demo-result', riderName: 'Barry Ellis', raceSource: 'demo', finishTimeMs: 21_000 }),
    ], 'owner-1');

    expect(bestTimes).toEqual({ 1: 29_500, 2: 30_250 });
  });

  it('awards every rider who beats their own prior record', () => {
    const records = personalRecordAchievements([
      { playerId: 1, finishTimeMs: 29_200 },
      { playerId: 2, finishTimeMs: 30_250 },
      { playerId: 3, finishTimeMs: 28_000 },
      { playerId: 4, finishTimeMs: 25_000 },
    ], {
      1: 29_500,
      2: 30_250,
      3: 29_000,
    });

    expect(records[1]).toMatchObject({ finishTimeMs: 29_200, previousBestMs: 29_500, improvementMs: 300 });
    expect(records[2]).toBeUndefined();
    expect(records[3]).toMatchObject({ finishTimeMs: 28_000, previousBestMs: 29_000, improvementMs: 1_000 });
    expect(records[4]).toBeUndefined();
  });
});
