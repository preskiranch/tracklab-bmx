import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playCommentaryMediaBlob,
} from '../../src/lib/commentaryMediaPlayback';
import { primeCommentaryMediaElement } from '../../src/lib/commentaryMediaPrime';

class DeferredCommentaryAudio {
  currentTime = 0;
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  pauseCount = 0;
  preload = '';
  src = '';
  volume = 1;
  playResults: Promise<void>[] = [];

  get currentSrc() {
    return this.src;
  }

  load() {}

  pause() {
    this.paused = true;
    this.pauseCount += 1;
  }

  play() {
    this.paused = false;
    return this.playResults.shift() ?? Promise.resolve();
  }

  setAttribute() {}
}

describe('commentary media playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let blobSequence = 0;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:commentary-${++blobSequence}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never lets a late unlock continuation pause or rewind live speech', async () => {
    let resolveUnlock = () => {};
    const unlockPlayback = new Promise<void>((resolve) => {
      resolveUnlock = resolve;
    });
    const audio = new DeferredCommentaryAudio();
    audio.playResults.push(unlockPlayback, Promise.resolve());
    const generationRef = { current: 0 };
    const activeCancelRef = { current: null as (() => void) | null };
    const onStart = vi.fn();

    const prime = primeCommentaryMediaElement({
      audio: audio as unknown as HTMLAudioElement,
      generationRef,
      unlockSource: 'data:audio/wav;base64,silent',
      timeoutMs: 1_000,
    });
    const playback = playCommentaryMediaBlob({
      audio: audio as unknown as HTMLAudioElement,
      audioBlob: new Blob(['speech']),
      volume: 1,
      generationRef,
      activeCancelRef,
      shouldContinue: () => true,
      onStart,
      watchdogMs: 5_000,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('blob:commentary-1');
    const pausesBeforeLateUnlock = audio.pauseCount;

    resolveUnlock();
    await Promise.resolve();
    await Promise.resolve();

    await expect(prime).resolves.toBe(false);
    expect(audio.pauseCount).toBe(pausesBeforeLateUnlock);
    expect(audio.src).toBe('blob:commentary-1');
    expect(audio.currentTime).toBe(0);
    expect(audio.volume).toBe(1);

    audio.onended?.();
    await expect(playback).resolves.toBe(true);
  });

  it('reports playback start only after the media play promise resolves', async () => {
    let resolvePlayback = () => {};
    const pendingPlayback = new Promise<void>((resolve) => {
      resolvePlayback = resolve;
    });
    const audio = new DeferredCommentaryAudio();
    audio.playResults.push(pendingPlayback);
    const onStart = vi.fn();
    const playback = playCommentaryMediaBlob({
      audio: audio as unknown as HTMLAudioElement,
      audioBlob: new Blob(['speech']),
      volume: 1,
      generationRef: { current: 0 },
      activeCancelRef: { current: null },
      shouldContinue: () => true,
      onStart,
      watchdogMs: 5_000,
    });

    await Promise.resolve();
    expect(onStart).not.toHaveBeenCalled();

    resolvePlayback();
    await Promise.resolve();
    await Promise.resolve();
    expect(onStart).toHaveBeenCalledTimes(1);

    audio.onended?.();
    await expect(playback).resolves.toBe(true);
  });

  it('does not report a start when a cancelled iOS play promise resolves late', async () => {
    let resolvePlayback = () => {};
    const pendingPlayback = new Promise<void>((resolve) => {
      resolvePlayback = resolve;
    });
    const audio = new DeferredCommentaryAudio();
    audio.playResults.push(pendingPlayback);
    const onStart = vi.fn();
    const activeCancelRef = { current: null as (() => void) | null };
    const playback = playCommentaryMediaBlob({
      audio: audio as unknown as HTMLAudioElement,
      audioBlob: new Blob(['speech']),
      volume: 1,
      generationRef: { current: 0 },
      activeCancelRef,
      shouldContinue: () => true,
      onStart,
      watchdogMs: 5_000,
    });

    activeCancelRef.current?.();
    await expect(playback).resolves.toBe(false);
    resolvePlayback();
    await Promise.resolve();
    await Promise.resolve();

    expect(onStart).not.toHaveBeenCalled();
  });
});
