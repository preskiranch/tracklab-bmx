import { describe, expect, it } from 'vitest';
import {
  browserSpeechWatchdogMs,
  commentaryLineRequestBudgetMs,
  commentaryNeedsImmediateLine,
  completeFieldFinishReplacesActiveCall,
  enqueueFinishCommentaryEvents,
  finishCommentaryReleaseTimeoutMs,
  raceStateStopsCommentary,
  shouldInterruptCommentaryForEvent,
} from '../../src/lib/raceCommentaryPlayback';

describe('race commentary playback sequencing', () => {
  it('waits for browser speech completion instead of advancing after a short estimate', () => {
    expect(browserSpeechWatchdogMs('Avery charges through the rhythm section.')).toBe(12_000);
    expect(browserSpeechWatchdogMs(Array.from({ length: 40 }, () => 'racing').join(' '))).toBe(30_000);
  });

  it('replaces calls that are still being prepared without cutting off spoken sentences', () => {
    expect(shouldInterruptCommentaryForEvent('speaking', 'finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('speaking', 'rider-finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'finish')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('preparing', 'rider-finish')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('thinking', 'finish')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('thinking', 'lead-change')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('speaking', 'lead-change')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'position-change')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('preparing', 'pedal-zone')).toBe(false);
  });

  it('skips generative wording latency for live passes', () => {
    expect(commentaryNeedsImmediateLine('lead-change')).toBe(true);
    expect(commentaryNeedsImmediateLine('position-change')).toBe(true);
    expect(commentaryNeedsImmediateLine('rider-finish')).toBe(true);
    expect(commentaryLineRequestBudgetMs('lead-change')).toBe(0);
    expect(commentaryLineRequestBudgetMs('position-change')).toBe(0);
    expect(commentaryLineRequestBudgetMs('rider-finish')).toBe(0);
    expect(commentaryLineRequestBudgetMs('pedal-zone')).toBe(1_200);
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
});
