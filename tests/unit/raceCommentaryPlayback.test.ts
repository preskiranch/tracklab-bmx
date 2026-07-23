import { describe, expect, it } from 'vitest';
import {
  browserSpeechWatchdogMs,
  commentaryLineRequestBudgetMs,
  commentaryNeedsImmediateLine,
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
});
