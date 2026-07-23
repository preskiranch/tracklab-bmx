import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class StalledAudio extends EventTarget {
  currentTime = 0;
  loop = false;
  muted = false;
  preload = '';
  src: string;
  volume = 1;

  constructor(src = '') {
    super();
    this.src = src;
  }

  load() {}

  pause() {}

  play() {
    return new Promise<void>(() => {
      // Intentionally unresolved to reproduce the affected browser behavior.
    });
  }

  removeAttribute(name: string) {
    if (name === 'src') {
      this.src = '';
    }
  }

  setAttribute() {}
}

describe('race audio resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal('Audio', StalledAudio);
    vi.stubGlobal('window', {
      AudioContext: undefined,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not let unresolved media priming block the cadence', async () => {
    const { primeAudioCues } = await import('../../src/lib/audioCues');
    let completed = false;
    const prime = primeAudioCues().then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(1_199);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await prime;
    expect(completed).toBe(true);
  });

  it('falls back when the UCI media element never reports playback', async () => {
    const { playUciRandomStartVoice } = await import('../../src/lib/audioCues');
    const voiceStart = playUciRandomStartVoice(100);

    await vi.advanceTimersByTimeAsync(101);

    await expect(voiceStart).resolves.toMatchObject({ source: 'fallback' });
  });
});
