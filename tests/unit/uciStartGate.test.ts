import { describe, expect, it } from 'vitest';
import {
  uciGreenToneDurationSeconds,
  uciRandomDelayMaxMs,
  uciRandomDelayMinMs,
  uciShortToneDurationSeconds,
  uciStartToneIntervalMs,
} from '../../src/lib/uciStartGate';

describe('UCI random start timing', () => {
  it('keeps the UCI random hold and synchronized tone timing', () => {
    expect(uciRandomDelayMinMs).toBe(100);
    expect(uciRandomDelayMaxMs).toBe(2700);
    expect(uciStartToneIntervalMs).toBe(120);
    expect(uciShortToneDurationSeconds).toBe(0.06);
    expect(uciGreenToneDurationSeconds).toBe(2.25);
  });
});
