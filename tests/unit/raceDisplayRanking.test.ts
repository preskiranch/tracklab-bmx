import { describe, expect, it } from 'vitest';
import { normalizedRaceDisplayRanks } from '../../src/lib/raceDisplayRanking';

describe('race display ranking', () => {
  it('shows a false starter as unranked and promotes the eligible leader to first', () => {
    const ranks = normalizedRaceDisplayRanks([
      { id: 'false-starter', distanceMeters: 300, finishedAt: 14_000, rank: 1, disqualified: true },
      { id: 'eligible-leader', distanceMeters: 280, finishedAt: 15_000, rank: 2 },
      { id: 'eligible-chaser', distanceMeters: 260, finishedAt: 16_000, rank: 3 },
    ]);

    expect(ranks.has('false-starter')).toBe(false);
    expect(ranks.get('eligible-leader')).toBe(1);
    expect(ranks.get('eligible-chaser')).toBe(2);
  });

  it('uses race progress before client-local rank while riders are still racing', () => {
    const ranks = normalizedRaceDisplayRanks([
      { id: 'remote-a', distanceMeters: 80, finishedAt: null, rank: 1 },
      { id: 'remote-b', distanceMeters: 95, finishedAt: null, rank: 1 },
    ]);

    expect(ranks.get('remote-b')).toBe(1);
    expect(ranks.get('remote-a')).toBe(2);
  });
});
