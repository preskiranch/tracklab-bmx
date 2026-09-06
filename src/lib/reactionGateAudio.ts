import { getTrackLabAudioContext } from './audioCues';

export type ReactionGateAirDirection = 'drop' | 'raise';

/** Final mix levels are baked into the WAVs; the return is reversed and faint. */
export const reactionGateAirProfiles = Object.freeze({
  drop: { durationSeconds: 1, url: '/assets/reaction-gate-rb26-drop-1s.wav' },
  raise: { durationSeconds: 2, url: '/assets/reaction-gate-rb26-raise-2s.wav' },
});

type GateAirBuffers = Record<ReactionGateAirDirection, AudioBuffer>;
const buffers = new WeakMap<AudioContext, GateAirBuffers>();
const pending = new WeakMap<AudioContext, Promise<boolean>>();

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
 * Start beside the visual gate movement without awaiting unlock, downloading,
 * or changing the cadence clock. A suspended/unsupported context stays silent;
 * it must never replay a stale movement when the device later resumes audio.
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
    if (!context || context.state !== 'running') return cancel;
    const buffer = gateAirBuffer(context, direction);
    if (!buffer) return cancel;
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
  }

  return cancel;
}
