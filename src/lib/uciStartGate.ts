export const uciRandomDelayMinMs = 100;
export const uciRandomDelayMaxMs = 2700;
export const uciStartToneIntervalMs = 120;
export const uciShortToneDurationSeconds = 0.06;
export const uciGreenToneDurationSeconds = 2.25;

/**
 * Draw the official random hold shared by Race Intervals and Reaction Test.
 * Web Crypto avoids a short, repeatable Math.random sequence when it is
 * available; the injected source keeps deterministic unit tests possible.
 */
export function createUciRandomDelayMs(random?: () => number) {
  const range = uciRandomDelayMaxMs - uciRandomDelayMinMs + 1;
  if (random) {
    const sample = Math.max(0, Math.min(0.999999999, random()));
    return uciRandomDelayMinMs + Math.floor(sample * range);
  }

  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const maxUnbiased = Math.floor(0x100000000 / range) * range;
    const value = new Uint32Array(1);
    do {
      cryptoApi.getRandomValues(value);
    } while (value[0] >= maxUnbiased);
    return uciRandomDelayMinMs + (value[0] % range);
  }

  return uciRandomDelayMinMs + Math.floor(Math.random() * range);
}
