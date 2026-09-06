import { getTrackLabAudioContext, startGateMediaUnlockUrl } from './audioCues';

export type ReactionGateAirDirection = 'drop' | 'raise';

/** Final mix levels are baked into the WAVs; the return is reversed and faint. */
export const reactionGateAirProfiles = Object.freeze({
  drop: { durationSeconds: 1, url: '/assets/reaction-gate-rb26-drop-1s.wav' },
  raise: { durationSeconds: 2, url: '/assets/reaction-gate-rb26-raise-2s.wav' },
});

type GateAirBuffers = Record<ReactionGateAirDirection, AudioBuffer>;
const buffers = new WeakMap<AudioContext, GateAirBuffers>();
const pending = new WeakMap<AudioContext, Promise<boolean>>();
type GateAirMedia = { audio: HTMLAudioElement; primed: boolean; generation: number };
const media = new Map<ReactionGateAirDirection, GateAirMedia>();
let mediaPriming: Promise<boolean> | null = null;

function within<T>(task: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    task.then(resolve, () => resolve(fallback)).finally(() => clearTimeout(timer));
  });
}

/** Prime the actual fallback elements during a click, using zero PCM at full
 * volume. iOS does not transfer media permission from the starter's elements,
 * and some WKWebViews ignore element.volume. The final WAV levels are baked in.
 */
function primeGateAirMedia(): Promise<boolean> {
  if (mediaPriming) return mediaPriming;
  if (typeof Audio === 'undefined') return Promise.resolve(false);
  const tasks = (['drop', 'raise'] as const).map(async direction => {
    let entry = media.get(direction);
    if (!entry) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      entry = { audio, primed: false, generation: 0 };
      media.set(direction, entry);
    }
    if (entry.primed) return true;
    const { audio } = entry;
    audio.src = startGateMediaUnlockUrl;
    audio.muted = false;
    audio.volume = 1;
    audio.load();
    const primed = await within(audio.play().then(() => true), 700, false);
    audio.pause();
    audio.src = reactionGateAirProfiles[direction].url;
    audio.load();
    entry.primed = primed;
    return primed;
  });
  mediaPriming = Promise.all(tasks).then(results => results.every(Boolean))
    .catch(() => false).finally(() => { mediaPriming = null; });
  return mediaPriming;
}

/** Call directly from Start or Try Again. A context may have been suspended or
 * replaced since the previous attempt, so both permission and buffers matter.
 */
export async function primeReactionGateAirSounds(): Promise<boolean> {
  let resumed: Promise<boolean> = Promise.resolve(false);
  try {
    const context = getTrackLabAudioContext();
    if (context) {
      resumed = context.state === 'running' ? Promise.resolve(true)
        : within(context.resume().then(() => context.state === 'running'), 700, false);
    }
  } catch {
    // The separately primed media path can still carry the decorative cue.
  }
  // Start play() before the first await, while browser user activation is live.
  const mediaReady = primeGateAirMedia();
  const [running, decoded, fallbackReady] = await Promise.all([
    resumed, prepareReactionGateAirSounds(), mediaReady,
  ]);
  return (running && decoded) || fallbackReady;
}

function playGateAirMedia(direction: ReactionGateAirDirection): () => void {
  const entry = media.get(direction);
  if (!entry?.primed) return () => undefined;
  const { audio } = entry;
  const generation = ++entry.generation;
  const startedAt = performance.now();
  let cancelled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (deadline) clearTimeout(deadline);
    audio.removeEventListener('playing', onPlaying);
    audio.removeEventListener('ended', dispose);
    audio.removeEventListener('error', cancel);
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    dispose();
    if (generation === entry.generation) audio.pause();
  };
  const onPlaying = () => {
    if (performance.now() - startedAt > 250) cancel();
    else if (deadline) clearTimeout(deadline);
  };
  audio.addEventListener('playing', onPlaying);
  audio.addEventListener('ended', dispose);
  audio.addEventListener('error', cancel);
  try {
    audio.currentTime = 0;
    deadline = setTimeout(cancel, 250);
    void audio.play().then(() => {
      if (cancelled && generation === entry.generation) audio.pause();
    }, cancel);
  } catch {
    cancel();
  }
  return cancel;
}

/**
 * Load the exact auditioned samples before the UCI cadence. Decoding in the
 * shared context lets Web Audio adapt to a device's rate without changing pitch.
 * Gate movement itself never awaits a network request or queues stale playback.
 */
export async function prepareReactionGateAirSounds(): Promise<boolean> {
  let context: AudioContext | null;
  try {
    context = getTrackLabAudioContext();
  } catch {
    return false;
  }
  if (!context || context.state === 'closed') return false;
  if (buffers.has(context)) return true;
  const existing = pending.get(context);
  if (existing) return existing;
  const targetContext = context;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const loading = Promise.all((['drop', 'raise'] as const).map(async (direction) => {
    const profile = reactionGateAirProfiles[direction];
    const response = await fetch(profile.url, { signal: controller.signal });
    if (!response.ok) throw new Error('Gate audio unavailable');
    const buffer = await targetContext.decodeAudioData(await response.arrayBuffer());
    if (buffer.numberOfChannels !== 1 || Math.abs(buffer.duration - profile.durationSeconds) > 0.005) {
      throw new Error('Unexpected gate audio format');
    }
    return buffer;
  })).then(([drop, raise]) => {
    if (targetContext.state === 'closed') return false;
    buffers.set(targetContext, { drop, raise });
    return true;
  }).catch(() => false).finally(() => {
    clearTimeout(timeout);
    pending.delete(targetContext);
  });
  pending.set(context, loading);
  return loading;
}

function gateAirBuffer(context: AudioContext, direction: ReactionGateAirDirection) {
  return buffers.get(context)?.[direction];
}

/**
 * Start beside the visual gate movement without changing the cadence clock.
 * Use the already-primed media fallback when Web Audio is unavailable. A late
 * media start expires rather than replaying a stale movement after an unlock.
 */
export function playReactionGateAirSound(direction: ReactionGateAirDirection): () => void {
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let disposed = false;

  const disconnect = () => {
    if (disposed) return;
    disposed = true;
    context?.removeEventListener('statechange', onContextStateChange);
    if (source) {
      source.onended = null;
      try {
        source.disconnect();
      } catch {
        // Some WebViews already release their graph when the context closes.
      }
    }
  };
  const cancel = () => {
    if (disposed) return;
    disconnect();
    try {
      source?.stop();
    } catch {
      // Starting may have failed or the one-shot may already have finished.
    }
  };
  const onContextStateChange = () => {
    if (context?.state !== 'running') cancel();
  };

  try {
    context = getTrackLabAudioContext();
    if (!context || context.state !== 'running') return playGateAirMedia(direction);
    const buffer = gateAirBuffer(context, direction);
    if (!buffer) return playGateAirMedia(direction);
    source = context.createBufferSource();
    source.buffer = buffer;
    source.onended = disconnect;
    source.connect(context.destination);
    context.addEventListener('statechange', onContextStateChange);
    if (context.state !== 'running') {
      cancel();
    } else {
      source.start(context.currentTime);
    }
  } catch {
    cancel();
    return playGateAirMedia(direction);
  }

  return cancel;
}
