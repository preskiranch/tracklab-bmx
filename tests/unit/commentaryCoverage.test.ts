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
    closeBattles: [],
    riders,
  };
}

describe('full-field commentary coverage', () => {
  it('keeps the front two connected while naming the least-covered trailing rider', () => {
    const firstFocus = selectCommentaryFocusRiders(event(2), [], 3);
    expect(firstFocus.map((rider) => rider.playerId)).toEqual([1, 2, 3]);

    const raceLines = ['Blake Rivers runs second while Casey Lane holds third.'];
    const secondFocus = selectCommentaryFocusRiders(event(4, 'pedal-zone'), raceLines, 3);
    expect(secondFocus.map((rider) => rider.playerId)).toEqual([1, 2, 4]);

    expect([...commentaryRiderMentionCounts(riders, raceLines).entries()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
    ]);
  });

  it('alternates trailing coverage as race-call memory changes', () => {
    const fullOrder = ['Avery Stone leads; Blake Rivers runs second; Casey Lane holds third; Drew Parker is fourth.'];
    const firstCall = selectCommentaryFocusRiders(event(3, 'pedal-zone'), fullOrder, 3);
    const secondCall = selectCommentaryFocusRiders(
      event(4, 'pedal-zone'),
      [...fullOrder, 'Avery Stone leads with Blake Rivers second and Casey Lane third.'],
      3,
    );

    expect(firstCall.map((rider) => rider.playerId)).toEqual([1, 2, 3]);
    expect(secondCall.map((rider) => rider.playerId)).toEqual([1, 2, 4]);
  });

  it('keeps the actual pass riders required during a lead change', () => {
    const leadChange = {
      ...event(4, 'lead-change'),
      leaderPlayerId: 3,
      previousLeaderPlayerId: 1,
    };

    expect(requiredCommentaryRiders(leadChange, []).map((rider) => rider.playerId))
      .toEqual([3, 1, 2]);
  });

  it('keeps a new-leader call centered on the new and displaced leaders', () => {
    const leadChange = {
      ...event(4, 'lead-change'),
      leaderPlayerId: 2,
      previousLeaderPlayerId: 1,
      closeBattles: [{
        frontPlayerId: 3,
        behindPlayerId: 4,
        position: 3,
        gapMeters: 0.4,
      }],
    };

    expect(requiredCommentaryRiders(leadChange, []).map((rider) => rider.playerId))
      .toEqual([2, 1, 3]);
  });

  it('prioritizes the tightest passing threat anywhere while keeping the leader connected', () => {
    const closeBattles = [
      { frontPlayerId: 1, behindPlayerId: 2, position: 1, gapMeters: 0.5 },
      { frontPlayerId: 3, behindPlayerId: 4, position: 3, gapMeters: 0.3 },
    ];
    const tightestBattleCall = requiredCommentaryRiders({
      ...event(3, 'pedal-zone'),
      closeBattles,
    }, []);
    const leadBattleCall = requiredCommentaryRiders({
      ...event(4, 'pedal-zone'),
      closeBattles: [
        { ...closeBattles[0], gapMeters: 0.1 },
        closeBattles[1],
      ],
    }, []);

    expect(tightestBattleCall.map((rider) => rider.playerId)).toEqual([1, 3, 4]);
    expect(leadBattleCall.map((rider) => rider.playerId)).toEqual([1, 2, 3]);
  });

  it('keeps both riders involved in a mid-pack pass required', () => {
    const positionChange = {
      ...event(6, 'position-change'),
      passingPlayerId: 3,
      passedPlayerId: 2,
    };

    expect(requiredCommentaryRiders(positionChange, []).map((rider) => rider.playerId))
      .toEqual([3, 2, 1]);
  });

  it('requires the rider who just crossed for each placement call', () => {
    const riderFinish = {
      ...event(8, 'rider-finish'),
      finishingPlayerId: 3,
    };

    expect(requiredCommentaryRiders(riderFinish, []).map((rider) => rider.playerId))
      .toEqual([3]);
  });

  it('adds a wry aside only occasionally and never to the gate or finish', () => {
    expect(commentaryUsesWryAside(event(4, 'pedal-zone'))).toBe(false);
    expect(commentaryUsesWryAside(event(5, 'pedal-zone'))).toBe(true);
    expect(commentaryUsesWryAside(event(10, 'finish'))).toBe(false);
    expect(commentaryUsesWryAside(event(10, 'rider-finish'))).toBe(false);
    expect(commentaryUsesWryAside(event(10, 'race-start'))).toBe(false);
  });
});
