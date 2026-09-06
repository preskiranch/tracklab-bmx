import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrackLabAudioContext } from '../../src/lib/audioCues';

vi.mock('../../src/lib/audioCues', () => ({
  getTrackLabAudioContext: vi.fn(), startGateMediaUnlockUrl: 'data:audio/wav;base64,silence',
}));

class MediaAudio extends EventTarget {
  static instances: MediaAudio[] = [];
  src = ''; preload = ''; muted = false; volume = 1; currentTime = 0;
  pause = vi.fn(); load = vi.fn(); setAttribute = vi.fn();
  play = vi.fn(async () => { this.dispatchEvent(new Event('playing')); });
  constructor() { super(); MediaAudio.instances.push(this); }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('Audio', MediaAudio);
  MediaAudio.instances = [];
  vi.mocked(getTrackLabAudioContext).mockReturnValue(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('reaction gate media recovery', () => {
  it('silently primes the exact fallback elements inside the gesture and keeps baked mix levels', async () => {
    const gate = await import('../../src/lib/reactionGateAudio');
    const prime = gate.primeReactionGateAirSounds();
    expect(MediaAudio.instances).toHaveLength(2);
    for (const audio of MediaAudio.instances) {
      expect(audio.play).toHaveBeenCalledOnce();
      expect(audio.src).toContain('data:audio/wav');
      expect(audio.volume).toBe(1);
      expect(audio.muted).toBe(false);
    }
    expect(await prime).toBe(true);
    const [drop, raise] = MediaAudio.instances;
    expect(drop.src).toBe(gate.reactionGateAirProfiles.drop.url);
    expect(raise.src).toBe(gate.reactionGateAirProfiles.raise.url);
    await gate.primeReactionGateAirSounds();
    expect(drop.play).toHaveBeenCalledOnce();
    const stop = gate.playReactionGateAirSound('raise');
    expect(raise.play).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(raise.pause).toHaveBeenCalledTimes(1); // silent priming only
    stop(); stop();
    expect(raise.pause).toHaveBeenCalledTimes(2);
    expect(drop.play).toHaveBeenCalledOnce();
  });

  it('expires delayed playback and does not replay a stale gate after a late unlock', async () => {
    const gate = await import('../../src/lib/reactionGateAudio');
    await gate.primeReactionGateAirSounds();
    const drop = MediaAudio.instances[0];
    let resolvePlay!: () => void;
    drop.play.mockImplementationOnce(() => new Promise(resolve => { resolvePlay = resolve; }));
    gate.playReactionGateAirSound('drop');
    await vi.advanceTimersByTimeAsync(250);
    expect(drop.pause).toHaveBeenCalledTimes(2);
    resolvePlay();
    await Promise.resolve();
    expect(drop.pause).toHaveBeenCalledTimes(3);
  });

  it('does not let an old pending play cancel a newer movement', async () => {
    const gate = await import('../../src/lib/reactionGateAudio');
    await gate.primeReactionGateAirSounds();
    const drop = MediaAudio.instances[0];
    let resolveOldPlay!: () => void;
    drop.play.mockImplementationOnce(() => new Promise(resolve => { resolveOldPlay = resolve; }));
    const stopOld = gate.playReactionGateAirSound('drop');
    stopOld();
    gate.playReactionGateAirSound('drop');
    const pausesBeforeLateResolution = drop.pause.mock.calls.length;
    resolveOldPlay();
    await Promise.resolve();
    expect(drop.pause).toHaveBeenCalledTimes(pausesBeforeLateResolution);
  });

  it('retries denied media priming without playing a full-volume cue during preparation', async () => {
    const gate = await import('../../src/lib/reactionGateAudio');
    const denied = class extends MediaAudio {
      constructor() { super(); this.play.mockRejectedValueOnce(new Error('NotAllowedError')); }
    };
    vi.stubGlobal('Audio', denied);
    expect(await gate.primeReactionGateAirSounds()).toBe(false);
    const [drop] = MediaAudio.instances;
    gate.playReactionGateAirSound('drop');
    expect(drop.play).toHaveBeenCalledOnce();
    expect(await gate.primeReactionGateAirSounds()).toBe(true);
    expect(drop.src).toBe(gate.reactionGateAirProfiles.drop.url);
  });
});
