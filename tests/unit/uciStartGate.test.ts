import { describe, expect, it, vi } from 'vitest';
import {
  createUciRandomDelayMs,
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

  it('draws both inclusive bounds from the shared cadence randomizer', () => {
    expect(createUciRandomDelayMs(() => 0)).toBe(uciRandomDelayMinMs);
    expect(createUciRandomDelayMs(() => 0.999999999)).toBe(uciRandomDelayMaxMs);
  });
});


it('requests fresh crypto randomness for each start instead of reusing a fixed delay', () => {
  const draws = [0, 200, 2600, 950];
  const source = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
    (array as Uint32Array)[0] = draws.shift()!;
    return array;
  });
  try {
    expect(Array.from({length:4}, () => createUciRandomDelayMs())).toEqual([100,300,2700,1050]);
    expect(source).toHaveBeenCalledTimes(4);
  } finally { source.mockRestore(); }
});
