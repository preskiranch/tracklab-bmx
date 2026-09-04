import { describe, expect, it } from 'vitest';
import { uciRandomDelayMaxMs, uciRandomDelayMinMs, uciStartToneIntervalMs } from '../../src/lib/uciStartGate';
import {
  createReactionTestCadenceDelay,
  createReactionTestCadencePlan,
  createReactionTestResult,
  fireReactionTestCue,
  formatReactionTime,
  normalizeReactionInputTimestamp,
  reactionStageAtTimestamp,
} from '../../src/lib/reactionTest';
import { uciVoiceWatchGateOffsetMs } from '../../src/lib/audioCues';

describe('Reaction Test UCI cadence plan', () => {
  it('uses the existing UCI random-delay bounds inclusively', () => {
    expect(createReactionTestCadenceDelay(() => 0)).toBe(uciRandomDelayMinMs);
    expect(createReactionTestCadenceDelay(() => 0.99999999)).toBe(uciRandomDelayMaxMs);
  });

  it('starts the shortest random hold only after the bundled voice finishes speaking', () => {
    const plan = createReactionTestCadencePlan(1_000, uciRandomDelayMinMs);
    expect(uciVoiceWatchGateOffsetMs).toBe(5_620);
    expect(plan.firstRedAt).toBe(1_000 + 5_620 + 100);
  });

  it('shares the existing voice offset and tone interval for all four cues', () => {
    const plan = createReactionTestCadencePlan(1_000, 2_000);
    expect(plan.firstRedAt).toBe(1_000 + uciVoiceWatchGateOffsetMs + 2_000);
    expect(plan.cues.map((cue) => cue.at)).toEqual([
      plan.firstRedAt,
      plan.firstRedAt + uciStartToneIntervalMs,
      plan.firstRedAt + (uciStartToneIntervalMs * 2),
      plan.firstRedAt + (uciStartToneIntervalMs * 3),
    ]);
    expect(plan.cues.map((cue) => cue.stage)).toEqual(['red', 'yellow-1', 'yellow-2', 'green']);
  });

  it('gives the first light/timer and green/gate one logical timestamp each', () => {
    const [red, , , green] = createReactionTestCadencePlan(1_000, 100).cues;
    const redEvent = fireReactionTestCue(red, () => 2_345.67);
    const greenEvent = fireReactionTestCue(green, () => 2_705.67);
    expect(redEvent.startsTimer).toBe(true);
    expect(redEvent.firedAt).toBe(2_345.67);
    expect(greenEvent.releasesGate).toBe(true);
    expect(greenEvent.firedAt).toBe(2_705.67);
  });
});

describe('Reaction Test scoring', () => {
  it('uses the physical input timestamp and translates legacy WebKit epoch timestamps', () => {
    expect(normalizeReactionInputTimestamp(2_450.25, 2_500, 1_800_000_000_000)).toBe(2_450.25);
    expect(normalizeReactionInputTimestamp(1_800_000_002_450.25, 2_500, 1_800_000_000_000)).toBe(2_450.25);
    expect(normalizeReactionInputTimestamp(0, 2_500, 1_800_000_000_000)).toBe(2_500);
  });

  it('rates a queued touch against cue events that actually fired', () => {
    const plan = createReactionTestCadencePlan(1_000, 100);
    const cueEvents = plan.cues.map((cue, index) => fireReactionTestCue(
      cue,
      () => 10_000 + (index * 120),
    ));
    expect(reactionStageAtTimestamp(cueEvents, 9_999.99)).toBe('too-early');
    expect(reactionStageAtTimestamp(cueEvents, 10_000)).toBe('red');
    expect(reactionStageAtTimestamp(cueEvents, 10_180)).toBe('yellow-1');
    expect(reactionStageAtTimestamp(cueEvents, 10_400)).toBe('green');
  });

  it('keeps precise timing internally and displays hundredths of a second', () => {
    const result = createReactionTestResult({
      id: 'attempt',
      timerStartedAt: 1_000.123,
      timerStartedAtEpoch: 10_000,
      recordedAt: 2_274.567,
      recordedAtEpoch: 11_274.444,
      stage: 'yellow-1',
      cadenceDelayMs: 1_200,
    });
    expect(result.reactionTimeMs).toBeCloseTo(1_274.444, 6);
    expect(formatReactionTime(result.reactionTimeMs)).toBe('1.27');
    expect(result.rating).toBe('great');
  });

  it('preserves a false start as invalid instead of treating it as a response', () => {
    const result = createReactionTestResult({
      id: 'false-start',
      timerStartedAt: null,
      timerStartedAtEpoch: null,
      recordedAt: 1_050,
      recordedAtEpoch: 20_000,
      stage: 'too-early',
      cadenceDelayMs: 900,
    });
    expect(result).toMatchObject({
      valid: false,
      falseStart: true,
      reactionTimeMs: null,
      rating: 'false-start',
    });
  });
});
