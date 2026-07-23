import { describe, expect, it } from 'vitest';
import {
  commentaryRiderMentionCounts,
  commentaryUsesWryAside,
  requiredCommentaryRiders,
  selectCommentaryFocusRiders,
} from '../../cloud/commentaryCoverage.mjs';

const riders = [
  { playerId: 1, name: 'Avery Stone', rank: 1 },
  { playerId: 2, name: 'Blake Rivers', rank: 2 },
  { playerId: 3, name: 'Casey Lane', rank: 3 },
  { playerId: 4, name: 'Drew Parker', rank: 4 },
];

function event(sequence = 2, kind = 'positions-established') {
  return {
    sequence,
    kind,
    leaderPlayerId: 1,
    riders,
  };
}

describe('full-field commentary coverage', () => {
  it('rotates through riders who have not been named in the current race', () => {
    const firstFocus = selectCommentaryFocusRiders(event(2), [], 2);
    expect(firstFocus.map((rider) => rider.playerId)).toEqual([2, 3]);

    const raceLines = ['Blake Rivers runs second while Casey Lane holds third.'];
    const secondFocus = selectCommentaryFocusRiders(event(3, 'pedal-zone'), raceLines, 2);
    expect(secondFocus.map((rider) => rider.playerId)).toEqual([4, 1]);

    expect([...commentaryRiderMentionCounts(riders, raceLines).entries()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
    ]);
  });

  it('keeps the actual pass riders required during a lead change', () => {
    const leadChange = {
      ...event(4, 'lead-change'),
      leaderPlayerId: 3,
      previousLeaderPlayerId: 1,
    };

    expect(requiredCommentaryRiders(leadChange, []).map((rider) => rider.playerId))
      .toEqual([3, 1]);
  });

  it('adds a wry aside only occasionally and never to the gate or finish', () => {
    expect(commentaryUsesWryAside(event(4, 'pedal-zone'))).toBe(false);
    expect(commentaryUsesWryAside(event(5, 'pedal-zone'))).toBe(true);
    expect(commentaryUsesWryAside(event(10, 'finish'))).toBe(false);
    expect(commentaryUsesWryAside(event(10, 'race-start'))).toBe(false);
  });
});
