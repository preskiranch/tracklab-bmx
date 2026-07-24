import { describe, expect, it } from 'vitest';
import {
  browserSpeechWatchdogMs,
  commentaryLineRequestBudgetMs,
  commentaryNeedsImmediateLine,
  completeFieldFinishReplacesActiveCall,
  enqueueFinishCommentaryEvents,
  finishCommentaryReleaseTimeoutMs,
  raceStateStopsCommentary,
  shouldReplacePendingCallForFinish,
  shouldInterruptCommentaryForEvent,
} from '../../src/lib/raceCommentaryPlayback';

describe('race commentary playback sequencing', () => {
  it('waits for browser speech completion instead of advancing after a short estimate', () => {
    expect(browserSpeechWatchdogMs('Avery charges through the rhythm section.')).toBe(12_000);
    expect(browserSpeechWatchdogMs(Array.from({ length: 40 }, () => 'racing').join(' '))).toBe(30_000);
  });

  it('only replaces calls before paid speech preparation begins', () => {
    expect(shouldInterruptCommentaryForEvent('speaking', 'finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('speaking', 'rider-finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'rider-finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('thinking', 'finish')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('thinking', 'lead-change')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('speaking', 'lead-change')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'position-change')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'pedal-zone')).toBe(false);
  });

  it('skips generative wording latency for live passes', () => {
    expect(commentaryNeedsImmediateLine('lead-change')).toBe(true);
    expect(commentaryNeedsImmediateLine('position-change')).toBe(true);
    expect(commentaryNeedsImmediateLine('rider-finish')).toBe(true);
    expect(commentaryLineRequestBudgetMs('lead-change')).toBe(0);
    expect(commentaryLineRequestBudgetMs('position-change')).toBe(0);
    expect(commentaryLineRequestBudgetMs('rider-finish')).toBe(0);
    expect(commentaryLineRequestBudgetMs('pedal-zone')).toBe(800);
  });

  it('preserves finish playback until the race returns to the gate', () => {
    expect(raceStateStopsCommentary('finished')).toBe(false);
    expect(raceStateStopsCommentary('ready')).toBe(true);
  });

  it('bounds stalled finish playback so fullscreen can always release', () => {
    expect(finishCommentaryReleaseTimeoutMs).toBe(40_000);
  });

  it('replaces delayed placement calls with one authoritative full-field result', () => {
    const riders = [
      { playerId: 1, name: 'Avery', rank: 1, distanceMeters: 300, driveAllowed: false, finished: true },
      { playerId: 2, name: 'Blake', rank: 2, distanceMeters: 300, driveAllowed: false, finished: true },
      { playerId: 3, name: 'Casey', rank: 3, distanceMeters: 300, driveAllowed: false, finished: true },
      { playerId: 4, name: 'Drew', rank: 4, distanceMeters: 300, driveAllowed: false, finished: true },
    ];
    const event = (id: string, kind: 'finish' | 'rider-finish', finishingPlayerId: number) => ({
      id,
      kind,
      sequence: Number(id),
      occurredAt: Date.now(),
      trackName: 'Test Track',
      raceLengthMeters: 300,
      progress: 1,
      coursePhase: 'last-straight' as const,
      battleState: 'clear-lead' as const,
      leaderPlayerId: 1,
      finishingPlayerId,
      pedalReferenceAllowed: false,
      closeBattles: [],
      riders,
    });
    const queued = enqueueFinishCommentaryEvents(
      [
        {
          ...event('0', 'finish', 1),
          kind: 'race-update',
        },
        event('1', 'finish', 1),
        event('2', 'rider-finish', 2),
      ],
      [event('3', 'rider-finish', 3), event('4', 'rider-finish', 4)],
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id: '4', finishingPlayerId: 4 });
    expect(completeFieldFinishReplacesActiveCall(queued[0])).toBe(true);
  });

  it('drops stale race action when a rider reaches the finish', () => {
    const riders = [
      { playerId: 1, name: 'Avery', rank: 1, distanceMeters: 300, driveAllowed: false, finished: true },
      { playerId: 2, name: 'Blake', rank: 2, distanceMeters: 285, driveAllowed: false, finished: false },
    ];
    const finishEvent = {
      id: 'finish-1',
      kind: 'finish' as const,
      sequence: 2,
      occurredAt: Date.now(),
      trackName: 'Test Track',
      raceLengthMeters: 300,
      progress: 1,
      coursePhase: 'last-straight' as const,
      battleState: 'clear-lead' as const,
      leaderPlayerId: 1,
      finishingPlayerId: 1,
      pedalReferenceAllowed: false,
      closeBattles: [],
      riders,
    };
    const queued = enqueueFinishCommentaryEvents(
      [{ ...finishEvent, id: 'live-1', kind: 'race-update' }],
      [finishEvent],
    );

    expect(queued).toEqual([finishEvent]);
    expect(shouldReplacePendingCallForFinish('preparing', finishEvent, 'race-update')).toBe(true);
    expect(shouldReplacePendingCallForFinish('speaking', finishEvent, 'race-update')).toBe(false);
    expect(shouldReplacePendingCallForFinish('preparing', finishEvent, 'finish')).toBe(false);
  });

  it('replaces any silent pending call with the final results summary', () => {
    const finalResult = {
      id: 'final-results',
      kind: 'rider-finish' as const,
      resultsFinal: true,
      sequence: 5,
      occurredAt: Date.now(),
      trackName: 'Test Track',
      raceLengthMeters: 300,
      progress: 1,
      coursePhase: 'last-straight' as const,
      battleState: 'clear-lead' as const,
      leaderPlayerId: 1,
      finishingPlayerId: 4,
      pedalReferenceAllowed: false,
      closeBattles: [],
      riders: [
        { playerId: 1, name: 'Avery', rank: 1, distanceMeters: 300, driveAllowed: false, finished: true },
        { playerId: 2, name: 'Blake', rank: 2, distanceMeters: 296, driveAllowed: false, finished: false },
        { playerId: 3, name: 'Casey', rank: 3, distanceMeters: 291, driveAllowed: false, finished: false },
        { playerId: 4, name: 'Drew', rank: 4, distanceMeters: 281, driveAllowed: false, finished: false },
      ],
    };

    expect(completeFieldFinishReplacesActiveCall(finalResult)).toBe(true);
    expect(shouldReplacePendingCallForFinish('thinking', finalResult, 'finish')).toBe(true);
    expect(shouldReplacePendingCallForFinish('preparing', finalResult, 'finish')).toBe(true);
    expect(shouldReplacePendingCallForFinish('speaking', finalResult, 'race-update')).toBe(false);
  });
});
