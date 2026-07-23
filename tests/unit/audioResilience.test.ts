import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class StalledAudio extends EventTarget {
  static instances: StalledAudio[] = [];
  static stallPlayback = true;

  currentTime = 0;
  loadCount = 0;
  loop = false;
  muted = false;
  paused = true;
  preload = '';
  src: string;
  volume = 1;

  constructor(src = '') {
    super();
    this.src = src;
    StalledAudio.instances.push(this);
  }

  load() {
    this.loadCount += 1;
  }

  pause() {
    this.paused = true;
  }

  play() {
    this.paused = false;
    if (!StalledAudio.stallPlayback) {
      return Promise.resolve();
    }
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
    StalledAudio.instances = [];
    StalledAudio.stallPlayback = true;
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

  it('does not reload or stop ambience when cadence preparation runs', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceUrl,
      primeAudioCues,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await primeAudioCues();
    await startBmxEventAmbience();
    await primeAudioCues();

    const ambience = StalledAudio.instances.find((audio) => audio.src === bmxEventAmbienceUrl);
    expect(ambience).toMatchObject({
      loadCount: 1,
      paused: false,
      volume: 0.065,
    });
  });
});
