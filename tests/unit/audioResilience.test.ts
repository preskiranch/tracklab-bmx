import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class StalledAudio extends EventTarget {
  static instances: StalledAudio[] = [];
  static onPlay: ((audio: StalledAudio) => void) | null = null;
  static stallPlayback = true;

  currentTime = 0;
  loadCount = 0;
  playCount = 0;
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
    this.playCount += 1;
    this.paused = false;
    StalledAudio.onPlay?.(this);
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
    StalledAudio.onPlay = null;
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

  it('keeps every real prime behind zero graph gain while iOS audio is suspended', async () => {
    StalledAudio.stallPlayback = false;
    const gainWrites: number[] = [];
    const gainAtPlay: number[] = [];
    const audioNode = () => ({ connect() {}, disconnect() {} });
    class SuspendedPrimeAudioContext {
      currentTime = 7;
      destination = {};
      state = 'suspended';

      createMediaElementSource() {
        return audioNode();
      }

      createBiquadFilter() {
        return {
          ...audioNode(),
          type: 'lowpass',
          frequency: { setValueAtTime() {} },
          Q: { setValueAtTime() {} },
          gain: { setValueAtTime() {} },
        };
      }

      createGain() {
        return {
          ...audioNode(),
          gain: {
            cancelScheduledValues() {},
            setValueAtTime(value: number) {
              gainWrites.push(value);
            },
          },
        };
      }

      createDynamicsCompressor() {
        const param = { setValueAtTime() {} };
        return {
          ...audioNode(),
          threshold: param,
          knee: param,
          ratio: param,
          attack: param,
          release: param,
        };
      }

      createOscillator() {
        return {
          ...audioNode(),
          frequency: { setValueAtTime() {} },
          start() {},
          stop() {},
          type: 'sine',
        };
      }

      resume() {
        return new Promise<void>(() => undefined);
      }
    }
    vi.stubGlobal('window', {
      AudioContext: SuspendedPrimeAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    let unlockSource = '';
    StalledAudio.onPlay = (audio) => {
      if (audio.src !== unlockSource) {
        gainAtPlay.push(gainWrites.at(-1) ?? Number.NaN);
      }
    };
    const {
      bmxEventAmbienceSources,
      primeAudioCues,
      startGateMediaUnlockUrl,
      uciRandomStartVoiceUrl,
    } = await import('../../src/lib/audioCues');
    unlockSource = startGateMediaUnlockUrl;

    const prime = primeAudioCues();
    const played = StalledAudio.instances.filter((audio) => audio.playCount > 0);
    expect(played.filter((audio) => audio.src !== startGateMediaUnlockUrl).map((audio) => audio.src))
      .toEqual([
        uciRandomStartVoiceUrl,
        ...bmxEventAmbienceSources.map((source) => source.url),
      ]);
    expect(gainAtPlay).toEqual([0.00001, 0.00001, 0.00001]);
    const silentTonePool = played.filter((audio) => audio.src === startGateMediaUnlockUrl);
    expect(silentTonePool).toHaveLength(4);
    expect(silentTonePool.map((audio) => audio.volume)).toEqual([1, 1, 1, 1]);

    await vi.advanceTimersByTimeAsync(1_201);
    await prime;
  });

  it('primes each exact tone element with silence for a later suspended-context fallback', async () => {
    class PermissionAwareAudio extends StalledAudio {
      static unlockSource = '';
      unlocked = false;

      override play() {
        this.playCount += 1;
        if (this.src === PermissionAwareAudio.unlockSource) {
          this.unlocked = true;
          this.paused = false;
          return Promise.resolve();
        }
        if (this.src.startsWith('data:audio/wav') && !this.unlocked) {
          this.paused = true;
          return Promise.reject(new DOMException('User activation required', 'NotAllowedError'));
        }
        this.paused = false;
        return Promise.resolve();
      }
    }
    const audioNode = () => ({ connect() {}, disconnect() {} });
    const audioParam = () => ({
      cancelScheduledValues() {},
      exponentialRampToValueAtTime() {},
      setValueAtTime() {},
    });
    let contextInstance: PermissionAudioContext | null = null;
    class PermissionAudioContext {
      currentTime = 0;
      destination = {};
      state = 'running';

      constructor() {
        contextInstance = this;
      }

      createMediaElementSource() {
        return audioNode();
      }

      createBiquadFilter() {
        return {
          ...audioNode(),
          type: 'lowpass',
          frequency: audioParam(),
          Q: audioParam(),
          gain: audioParam(),
        };
      }

      createGain() {
        return { ...audioNode(), gain: audioParam() };
      }

      createDynamicsCompressor() {
        return {
          ...audioNode(),
          threshold: audioParam(),
          knee: audioParam(),
          ratio: audioParam(),
          attack: audioParam(),
          release: audioParam(),
        };
      }

      createOscillator() {
        return {
          ...audioNode(),
          frequency: audioParam(),
          start() {},
          stop() {},
          type: 'sine',
        };
      }

      decodeAudioData() {
        return Promise.resolve({});
      }

      resume() {
        return this.state === 'running'
          ? Promise.resolve()
          : new Promise<void>(() => undefined);
      }
    }
    vi.stubGlobal('Audio', PermissionAwareAudio);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    vi.stubGlobal('window', {
      AudioContext: PermissionAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const {
      playStartGateTone,
      primeAudioCues,
      startGateMediaUnlockUrl,
    } = await import('../../src/lib/audioCues');
    PermissionAwareAudio.unlockSource = startGateMediaUnlockUrl;

    await primeAudioCues();
    const tonePool = StalledAudio.instances.filter((audio) => (
      audio instanceof PermissionAwareAudio && audio.src === startGateMediaUnlockUrl
    )) as PermissionAwareAudio[];
    expect(tonePool).toHaveLength(4);
    expect(tonePool.every((audio) => audio.unlocked && audio.paused)).toBe(true);

    expect(contextInstance).not.toBeNull();
    contextInstance!.state = 'suspended';
    playStartGateTone('uci-red');
    await Promise.resolve();
    await Promise.resolve();

    expect(tonePool[0].unlocked).toBe(true);
    expect(tonePool[0].src).not.toBe(startGateMediaUnlockUrl);
    expect(tonePool[0].playCount).toBe(2);
    expect(tonePool[0].paused).toBe(false);
  });

  it('refuses direct ambience when Web Audio stays suspended and cannot route media', async () => {
    StalledAudio.stallPlayback = false;
    class UnroutableSuspendedAudioContext {
      currentTime = 0;
      destination = {};
      state = 'suspended';

      resume() {
        return new Promise<void>(() => undefined);
      }
    }
    vi.stubGlobal('window', {
      AudioContext: UnroutableSuspendedAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const {
      bmxEventAmbienceSources,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    const start = startBmxEventAmbience();
    await vi.advanceTimersByTimeAsync(801);

    await expect(start).resolves.toBe(false);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    expect(layers).toHaveLength(2);
    expect(layers.map((audio) => audio.playCount)).toEqual([0, 0]);
    expect(layers.every((audio) => audio.paused)).toBe(true);
  });

  it('falls back when the UCI media element never reports playback', async () => {
    const speak = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: vi.fn(),
        speak,
      },
    });
    const { playUciRandomStartVoice } = await import('../../src/lib/audioCues');
    const voiceStart = playUciRandomStartVoice(100);

    await vi.advanceTimersByTimeAsync(101);

    await expect(voiceStart).resolves.toMatchObject({ source: 'fallback' });
    expect(speak).not.toHaveBeenCalled();
  });

  it('does not revive a pending UCI voice after the gate audio is stopped', async () => {
    const {
      playUciRandomStartVoice,
      stopStartGateAudio,
      uciRandomStartVoiceUrl,
    } = await import('../../src/lib/audioCues');

    const voiceStart = playUciRandomStartVoice(100);
    const cadenceAudio = StalledAudio.instances.find((audio) => (
      audio.src.endsWith(uciRandomStartVoiceUrl)
    ));
    expect(cadenceAudio).toBeDefined();

    stopStartGateAudio();
    await vi.advanceTimersByTimeAsync(101);

    await expect(voiceStart).resolves.toMatchObject({ source: 'cancelled' });
    expect(cadenceAudio).toMatchObject({ paused: true, currentTime: 0 });
    expect(StalledAudio.instances).toHaveLength(1);
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

  it('returns the confirmed monotonic onset used by a running Web Audio tone', async () => {
    const oscillatorStarts: number[] = [];
    vi.stubGlobal('performance', { now: () => 321.875 });
    class ConfirmedGateAudioContext {
      currentTime = 7;
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
          frequency: { setValueAtTime() {} },
          start(at: number) {
            oscillatorStarts.push(at);
          },
          stop() {},
          type: 'sine',
        };
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: ConfirmedGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playStartGateToneConfirmed } = await import('../../src/lib/audioCues');

    await expect(playStartGateToneConfirmed('uci-red')).resolves.toEqual({
      kind: 'uci-red',
      source: 'web-audio',
      startedAtMonotonic: 321.875,
    });
    expect(oscillatorStarts).toEqual([7]);
    expect(StalledAudio.instances).toHaveLength(0);
  });

  it('waits for delayed media playback before confirming the tone onset', async () => {
    let monotonicTimestamp = 100;
    vi.stubGlobal('performance', { now: () => monotonicTimestamp });
    StalledAudio.onPlay = (audio) => {
      window.setTimeout(() => {
        monotonicTimestamp = 184.5;
        audio.dispatchEvent(new Event('playing'));
      }, 85);
    };
    const { playStartGateToneConfirmed } = await import('../../src/lib/audioCues');
    let resolved = false;
    const onset = playStartGateToneConfirmed('uci-red').then((result) => {
      resolved = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(84);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(onset).resolves.toEqual({
      kind: 'uci-red',
      source: 'media-element',
      startedAtMonotonic: 184.5,
    });
    expect(StalledAudio.instances[0]).toMatchObject({ playCount: 1, paused: false });
  });

  it('keeps Web Audio active through staging and releases it after the race', async () => {
    StalledAudio.stallPlayback = false;
    const oscillatorStops: number[] = [];
    const oscillatorDisconnects: number[] = [];
    const gainDisconnects: number[] = [];
    const oscillatorFrequencies: number[] = [];
    let oscillatorStarts = 0;

    class KeepAliveAudioContext {
      currentTime = 4;
      destination = {};
      state = 'running';

      createGain() {
        return {
          connect() {},
          disconnect() {
            gainDisconnects.push(1);
          },
          gain: {
            setValueAtTime() {},
          },
        };
      }

      createOscillator() {
        return {
          connect() {},
          disconnect() {
            oscillatorDisconnects.push(1);
          },
          frequency: {
            setValueAtTime(value: number) {
              oscillatorFrequencies.push(value);
            },
          },
          start() {
            oscillatorStarts += 1;
          },
          stop(at?: number) {
            oscillatorStops.push(at ?? 4);
          },
          type: 'sine',
        };
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: KeepAliveAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const {
      primeAudioCues,
      stopRaceAudioKeepAlive,
    } = await import('../../src/lib/audioCues');

    await primeAudioCues();
    await primeAudioCues();

    expect(oscillatorStarts).toBe(3);
    expect(oscillatorFrequencies).toEqual([40, 18, 40]);
    expect(oscillatorStops).toEqual([4.03, 4.03]);

    stopRaceAudioKeepAlive();

    expect(oscillatorStops).toEqual([4.03, 4.03, 4]);
    expect(oscillatorDisconnects).toHaveLength(1);
    expect(gainDisconnects).toHaveLength(1);
  });

  it('uses the audible media fallback while Web Audio is still suspended', async () => {
    StalledAudio.stallPlayback = false;
    class SuspendedGateAudioContext {
      currentTime = 0;
      destination = {};
      state = 'suspended';

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: SuspendedGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playStartGateTone } = await import('../../src/lib/audioCues');

    playStartGateTone('uci-red');
    await vi.advanceTimersByTimeAsync(1);

    expect(StalledAudio.instances).toHaveLength(1);
    expect(StalledAudio.instances[0]).toMatchObject({
      muted: false,
      paused: false,
      volume: 1,
    });
    expect(StalledAudio.instances[0].src).toMatch(/^data:audio\/wav;base64,/);
  });

  it('does not revive a stale gate tone after a delayed audio-context resume', async () => {
    const frequencies: number[] = [];
    let resolveResume: (() => void) | undefined;
    const resumed = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });

    class DelayedGateAudioContext {
      currentTime = 0;
      destination = {};
      state = 'suspended';

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
          stop() {},
          type: 'sine',
        };
      }

      resume() {
        return resumed.then(() => {
          this.state = 'running';
        });
      }
    }
    vi.stubGlobal('window', {
      AudioContext: DelayedGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playStartGateTone, stopStartGateAudio } = await import('../../src/lib/audioCues');

    playStartGateTone('uci-red');
    await vi.advanceTimersByTimeAsync(501);
    stopStartGateAudio();
    resolveResume?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(frequencies).toEqual([]);
    expect(StalledAudio.instances[0]).toMatchObject({ paused: true, currentTime: 0 });
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

  it('does not start ambience after stop wins a delayed audio-context resume', async () => {
    StalledAudio.stallPlayback = false;
    let resolveResume: (() => void) | undefined;
    const resumed = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });

    class DelayedAmbienceAudioContext {
      currentTime = 0;
      destination = {};
      state = 'suspended';

      createMediaElementSource() {
        return { connect() {} };
      }

      createGain() {
        return {
          connect() {},
          gain: {
            cancelScheduledValues() {},
            setValueAtTime() {},
          },
        };
      }

      resume() {
        return resumed.then(() => {
          this.state = 'running';
        });
      }
    }
    vi.stubGlobal('window', {
      AudioContext: DelayedAmbienceAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const {
      bmxEventAmbienceSources,
      startBmxEventAmbience,
      stopBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    const start = startBmxEventAmbience();
    stopBmxEventAmbience();
    resolveResume?.();
    await Promise.resolve();
    await Promise.resolve();

    await expect(start).resolves.toBe(false);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    expect(layers).toHaveLength(2);
    expect(layers.map((audio) => audio.playCount)).toEqual([0, 0]);
    expect(layers.every((audio) => audio.paused)).toBe(true);
  });

  it('does not start ambience after stop wins an unresolved prime wait', async () => {
    const {
      bmxEventAmbienceSources,
      primeAudioCues,
      startBmxEventAmbience,
      stopBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    const prime = primeAudioCues();
    await Promise.resolve();
    const start = startBmxEventAmbience();
    stopBmxEventAmbience();
    await vi.advanceTimersByTimeAsync(1_201);

    await expect(start).resolves.toBe(false);
    await prime;
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    expect(layers).toHaveLength(2);
    expect(layers.map((audio) => audio.playCount)).toEqual([1, 1]);
    expect(layers.every((audio) => audio.paused)).toBe(true);
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

  it('keeps both ambience layers at the configured mix throughout commentary', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceSources,
      setBmxEventAmbienceCommentaryDucked,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await startBmxEventAmbience(0.1);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    const normalVolumes = layers.map((audio) => audio.volume);

    setBmxEventAmbienceCommentaryDucked(true);
    layers.forEach((audio, index) => {
      expect(audio.volume).toBeCloseTo(normalVolumes[index], 8);
    });

    setBmxEventAmbienceCommentaryDucked(false);
    layers.forEach((audio, index) => {
      expect(audio.volume).toBeCloseTo(normalVolumes[index], 8);
    });
  });

  it('uses graph gains for ambience because iOS may ignore media-element volume', async () => {
    StalledAudio.stallPlayback = false;
    const gainNodes: Array<{
      gain: {
        value: number;
        cancelScheduledValues: (at: number) => void;
        setValueAtTime: (value: number, at: number) => void;
      };
    }> = [];
    class AmbienceAudioContext {
      currentTime = 3;
      destination = {};
      state = 'running';

      createMediaElementSource() {
        return { connect() {} };
      }

      createGain() {
        const node = {
          connect() {},
          gain: {
            value: 1,
            cancelScheduledValues() {},
            setValueAtTime(value: number) {
              this.value = value;
            },
          },
        };
        gainNodes.push(node);
        return node;
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: AmbienceAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const {
      bmxEventAmbienceSources,
      setBmxEventAmbienceCommentaryDucked,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await startBmxEventAmbience(0.1);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));

    expect(gainNodes.map((node) => node.gain.value)).toEqual([0.042, 0.012]);
    expect(layers.map((audio) => audio.volume)).toEqual([1, 1]);

    setBmxEventAmbienceCommentaryDucked(true);
    expect(gainNodes[0].gain.value).toBeCloseTo(0.042, 10);
    expect(gainNodes[1].gain.value).toBeCloseTo(0.012, 10);
    expect(layers.map((audio) => audio.volume)).toEqual([1, 1]);
  });

  it('ducks ambience for the complete spoken-and-tone cadence and releases after green', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceSources,
      playStartGateTone,
      playUciRandomStartVoice,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await startBmxEventAmbience(0.1);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    const normalVolumes = layers.map((audio) => audio.volume);

    await expect(playUciRandomStartVoice(100)).resolves.toMatchObject({ source: 'audio' });
    expect(layers[0].volume).toBeCloseTo(normalVolumes[0] * 0.025, 10);
    expect(layers[1].volume).toBeCloseTo(normalVolumes[1] * 0.025, 10);

    playStartGateTone('uci-red');
    await vi.advanceTimersByTimeAsync(500);
    expect(layers[0].volume).toBeCloseTo(normalVolumes[0] * 0.025, 10);
    expect(layers[1].volume).toBeCloseTo(normalVolumes[1] * 0.025, 10);

    playStartGateTone('uci-green');
    await vi.advanceTimersByTimeAsync(2_329);
    expect(layers[0].volume).toBeCloseTo(normalVolumes[0] * 0.025, 10);
    await vi.advanceTimersByTimeAsync(2);
    expect(layers.map((audio) => audio.volume)).toEqual(normalVolumes);
  });

  it('releases cadence ducking when a backgrounded tablet catches up to stale green', async () => {
    StalledAudio.stallPlayback = false;
    const {
      bmxEventAmbienceSources,
      playStartGateTone,
      releaseBmxEventAmbienceGateDuck,
      startBmxEventAmbience,
    } = await import('../../src/lib/audioCues');

    await startBmxEventAmbience(0.1);
    const layers = StalledAudio.instances.filter((audio) => (
      bmxEventAmbienceSources.some((source) => audio.src.endsWith(source.url))
    ));
    const normalVolumes = layers.map((audio) => audio.volume);

    playStartGateTone('uci-red');
    await vi.advanceTimersByTimeAsync(500);
    expect(layers[0].volume).toBeCloseTo(normalVolumes[0] * 0.025, 10);
    expect(layers[1].volume).toBeCloseTo(normalVolumes[1] * 0.025, 10);

    // The synchronized timeline intentionally skips an expired green tone
    // after background catch-up, but entering the race must still end ducking.
    releaseBmxEventAmbienceGateDuck();
    expect(layers.map((audio) => audio.volume)).toEqual(normalVolumes);
  });

  it('reuses the cadence element and its gain graph after a media playback failure', async () => {
    const audioNode = () => ({ connect() {}, disconnect() {} });
    let mediaSourceCount = 0;
    class RetryGateAudioContext {
      currentTime = 1;
      destination = {};
      state = 'running';

      createMediaElementSource() {
        mediaSourceCount += 1;
        return audioNode();
      }

      createBiquadFilter() {
        return {
          ...audioNode(),
          type: 'lowpass',
          frequency: { setValueAtTime() {} },
          Q: { setValueAtTime() {} },
          gain: { setValueAtTime() {} },
        };
      }

      createGain() {
        return {
          ...audioNode(),
          gain: { setValueAtTime() {} },
        };
      }

      createDynamicsCompressor() {
        const param = { setValueAtTime() {} };
        return {
          ...audioNode(),
          threshold: param,
          knee: param,
          ratio: param,
          attack: param,
          release: param,
        };
      }

      createOscillator() {
        return {
          ...audioNode(),
          frequency: { setValueAtTime() {} },
          start() {},
          stop() {},
          type: 'sine',
        };
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    vi.stubGlobal('window', {
      AudioContext: RetryGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playUciRandomStartVoice, uciRandomStartVoiceUrl } = await import('../../src/lib/audioCues');

    const failedPlayback = playUciRandomStartVoice(100);
    await vi.advanceTimersByTimeAsync(101);
    await expect(failedPlayback).resolves.toMatchObject({ source: 'fallback' });
    const cadenceElement = StalledAudio.instances.find((audio) => (
      audio.src === '' || audio.src.endsWith(uciRandomStartVoiceUrl)
    ));
    expect(cadenceElement).toBeDefined();

    StalledAudio.stallPlayback = false;
    await expect(playUciRandomStartVoice(100)).resolves.toMatchObject({ source: 'audio' });
    expect(mediaSourceCount).toBe(1);
    expect(StalledAudio.instances).toContain(cadenceElement);
  });

  it('waits for a suspended WKWebView context before connecting and playing cadence', async () => {
    StalledAudio.stallPlayback = false;
    let resolveResume = () => {};
    const resumeGate = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    let mediaSourceCount = 0;
    const gainValues: number[] = [];
    const audioNode = () => ({ connect() {}, disconnect() {} });
    class ResumingGateAudioContext {
      currentTime = 5;
      destination = {};
      state = 'suspended';

      createMediaElementSource() {
        mediaSourceCount += 1;
        return audioNode();
      }

      createBiquadFilter() {
        return {
          ...audioNode(),
          type: 'lowpass',
          frequency: { setValueAtTime() {} },
          Q: { setValueAtTime() {} },
          gain: { setValueAtTime() {} },
        };
      }

      createGain() {
        return {
          ...audioNode(),
          gain: {
            setValueAtTime(value: number) {
              gainValues.push(value);
            },
          },
        };
      }

      createDynamicsCompressor() {
        const param = { setValueAtTime() {} };
        return {
          ...audioNode(),
          threshold: param,
          knee: param,
          ratio: param,
          attack: param,
          release: param,
        };
      }

      resume() {
        return resumeGate.then(() => {
          this.state = 'running';
        });
      }
    }
    vi.stubGlobal('window', {
      AudioContext: ResumingGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { playUciRandomStartVoice, raceAudioMixProfile } = await import('../../src/lib/audioCues');

    let settled = false;
    const playback = playUciRandomStartVoice(500).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mediaSourceCount).toBe(0);

    resolveResume();
    await Promise.resolve();
    await Promise.resolve();

    await expect(playback).resolves.toMatchObject({ source: 'audio' });
    expect(mediaSourceCount).toBe(1);
    expect(gainValues).toContain(raceAudioMixProfile.cadenceVoiceGain);
  });

  it('boosts and limits the UCI cadence media on a running tablet audio context', async () => {
    StalledAudio.stallPlayback = false;
    const gainValues: number[] = [];
    const filterTypes: string[] = [];
    const compressorValues: Record<string, number[]> = {};
    const audioNode = () => ({ connect() {}, disconnect() {} });
    const audioParam = (key: string) => ({
      setValueAtTime(value: number) {
        (compressorValues[key] ??= []).push(value);
      },
    });

    class MixedGateAudioContext {
      currentTime = 2;
      destination = {};
      state = 'running';

      createMediaElementSource() {
        return audioNode();
      }

      createBiquadFilter() {
        const node = {
          ...audioNode(),
          frequency: audioParam('frequency'),
          Q: audioParam('Q'),
          gain: audioParam('filterGain'),
          _type: '',
          set type(value: string) {
            this._type = value;
            filterTypes.push(value);
          },
          get type() {
            return this._type;
          },
        };
        return node;
      }

      createGain() {
        return {
          ...audioNode(),
          gain: {
            setValueAtTime(value: number) {
              gainValues.push(value);
            },
          },
        };
      }

      createDynamicsCompressor() {
        return {
          ...audioNode(),
          threshold: audioParam('threshold'),
          knee: audioParam('knee'),
          ratio: audioParam('ratio'),
          attack: audioParam('attack'),
          release: audioParam('release'),
        };
      }

      createOscillator() {
        return {
          ...audioNode(),
          frequency: { setValueAtTime() {} },
          start() {},
          stop() {},
          type: 'sine',
        };
      }

      decodeAudioData() {
        return Promise.resolve({});
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    })));
    vi.stubGlobal('window', {
      AudioContext: MixedGateAudioContext,
      webkitAudioContext: undefined,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      speechSynthesis: undefined,
    });
    const { primeAudioCues, raceAudioMixProfile } = await import('../../src/lib/audioCues');

    await primeAudioCues();

    expect(filterTypes).toEqual(['highpass', 'peaking']);
    expect(gainValues).toContain(raceAudioMixProfile.cadenceVoiceGain);
    expect(compressorValues.threshold).toContain(raceAudioMixProfile.cadenceVoiceLimiterThresholdDb);
    expect(compressorValues.ratio).toContain(raceAudioMixProfile.cadenceVoiceLimiterRatio);
  });
});
