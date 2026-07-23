import { describe, expect, it } from 'vitest';
import {
  browserSpeechWatchdogMs,
  raceStateStopsCommentary,
  shouldInterruptCommentaryForEvent,
} from '../../src/lib/raceCommentaryPlayback';

describe('race commentary playback sequencing', () => {
  it('waits for browser speech completion instead of advancing after a short estimate', () => {
    expect(browserSpeechWatchdogMs('Avery charges through the rhythm section.')).toBe(12_000);
    expect(browserSpeechWatchdogMs(Array.from({ length: 40 }, () => 'racing').join(' '))).toBe(30_000);
  });

  it('lets an active sentence finish before the winner call', () => {
    expect(shouldInterruptCommentaryForEvent('speaking', 'finish')).toBe(false);
    expect(shouldInterruptCommentaryForEvent('preparing', 'finish')).toBe(true);
    expect(shouldInterruptCommentaryForEvent('thinking', 'finish')).toBe(true);
  });

  it('preserves finish playback until the race returns to the gate', () => {
    expect(raceStateStopsCommentary('finished')).toBe(false);
    expect(raceStateStopsCommentary('ready')).toBe(true);
  });
});
