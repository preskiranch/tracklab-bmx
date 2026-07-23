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
  playbackRate = 1;
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

  it('uses the primed media cadence when playback is available', async () => {
    StalledAudio.stallPlayback = false;
    const {
      playUciRandomStartVoice,
      primeAudioCues,
      uciRandomStartVoiceUrl,
    } = await import('../../src/lib/audioCues');

    await primeAudioCues();
    await expect(playUciRandomStartVoice(100)).resolves.toMatchObject({ source: 'audio' });

    const cadenceAudio = StalledAudio.instances.find((audio) => audio.src.endsWith(uciRandomStartVoiceUrl));
    expect(cadenceAudio).toMatchObject({
      muted: false,
      paused: false,
      volume: 1,
    });
  });

  it('starts each UCI light tone immediately through Web Audio when available', async () => {
    const frequencies: number[] = [];
    const stopTimes: number[] = [];
    class GateAudioContext {
      currentTime = 4;
      destination = {};
      state = 'running';

      createGain() {
        return {
          connect() {},
          gain: {
            exponentialRampToValueAtTime() {},
            setValueAtTime() {},
          },
        };
      }

      createOscillator() {
        return {
          connect() {},
          frequency: {
            setValueAtTime(value: number) {
              frequencies.push(value);
            },
          },
          start() {},
          stop(at: number) {
            stopTimes.push(at);
          },
          type: 'sine',
        };
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: GateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playStartGateTone } = await import('../../src/lib/audioCues');

    playStartGateTone('uci-red');

    expect(frequencies).toEqual([632]);
    expect(stopTimes[0]).toBeCloseTo(4.062, 5);
    expect(StalledAudio.instances).toHaveLength(0);
  });

  it('does not reload or stop ambience when cadence preparation runs', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceSources,
      primeAudioCues,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await primeAudioCues();
    await startBmxEventAmbience();
    const ambienceLayers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    const activeStartOffsets = ambienceLayers.map((audio) => audio.currentTime);
    await primeAudioCues();

    expect(ambienceLayers).toHaveLength(2);
    ambienceLayers.forEach((ambience, index) => {
      expect(ambience).toMatchObject({
        loadCount: 1,
        paused: false,
        currentTime: activeStartOffsets[index],
      });
      expect(ambience.volume).toBeGreaterThan(0);
    });
  });

  it('keeps the crowd layer out of the silent end of its recording', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceSources,
      primeAudioCues,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await primeAudioCues();
    await startBmxEventAmbience();
    const crowd = StalledAudio.instances.find((audio) => (
      audio.src.endsWith(bmxEventAmbienceSources[1].url)
    ));
    expect(crowd).toBeDefined();
    crowd!.currentTime = 70;
    crowd!.dispatchEvent(new Event('timeupdate'));

    expect(crowd!.currentTime).toBeGreaterThanOrEqual(4);
    expect(crowd!.currentTime).toBeLessThan(68);
  });
});
