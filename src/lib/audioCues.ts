import {
  uciGreenToneDurationSeconds,
  uciShortToneDurationSeconds,
} from './uciStartGate';

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let raceAudioKeepAliveOscillator: OscillatorNode | null = null;
let raceAudioKeepAliveGain: GainNode | null = null;
let activeStartGateAudio: HTMLAudioElement | null = null;
let startGateMediaContext: AudioContext | null = null;
let startGateMediaSource: MediaElementAudioSourceNode | null = null;
let startGateMediaGain: GainNode | null = null;
let startGateMediaNodes: AudioNode[] = [];
let startGateMediaPriming = false;
let activeStartGateBufferSource: AudioBufferSourceNode | null = null;
let activeStartGateBufferNodes: AudioNode[] = [];
let startGateAudioGeneration = 0;
let startGateToneGeneration = 0;
let startGateToneAudioPool: HTMLAudioElement[] = [];
let startGateToneAudioIndex = 0;
let startGateToneMediaPrimed = false;
let startGateToneMediaPrimePromise: Promise<void> | null = null;
let uciVoiceBufferPromise: Promise<AudioBuffer | null> | null = null;
let mediaElementPrimed = false;
let mediaElementPrimePromise: Promise<void> | null = null;
let raceAmbienceBedAudio: HTMLAudioElement | null = null;
let raceAmbienceCrowdAudio: HTMLAudioElement | null = null;
let raceAmbienceMediaContext: AudioContext | null = null;
let raceAmbienceBedSource: MediaElementAudioSourceNode | null = null;
let raceAmbienceCrowdSource: MediaElementAudioSourceNode | null = null;
let raceAmbienceBedGain: GainNode | null = null;
let raceAmbienceCrowdGain: GainNode | null = null;
let raceAmbiencePrimed = false;
let raceAmbiencePrimePromise: Promise<void> | null = null;
let raceAmbiencePlaybackRequested = false;
let raceAmbiencePlaybackGeneration = 0;
let activeRaceAmbienceProfile: BmxEventAmbienceProfile | null = null;
let lastRaceAmbienceProfileIndex = -1;
let raceAmbienceMasterVolume = 0.065;
let raceAmbienceCommentaryDucked = false;
let raceAmbienceGateDucked = false;
let raceAmbienceGateDuckReleaseTimer: number | null = null;

export const uciRandomStartVoiceUrl = '/assets/uci-random-start.mp3';
// 40 ms of mono 8 kHz 16-bit PCM containing only zero samples. This is safe
// at full element volume even on WKWebView versions that ignore `.volume`.
export const startGateMediaUnlockUrl = 'data:audio/wav;base64,UklGRqQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const bmxEventAmbienceUrl = '/assets/bmx-event-ambience.mp3';
export const bmxEventAmbienceSources = [
  {
    url: bmxEventAmbienceUrl,
    durationSeconds: 15.046,
    role: 'trackside-bed',
  },
  {
    url: '/assets/bmx-event-ambience-sports.mp3',
    durationSeconds: 76.826,
    role: 'race-crowd',
  },
] as const;
export const bmxEventAmbienceVariationCount = 128;
const tracksideBedSource = bmxEventAmbienceSources[0];
const raceCrowdSource = bmxEventAmbienceSources[1];
const raceCrowdLoopEndSeconds = 68;
/**
 * Fixed broadcast mix shared by phones, tablets, and desktop browsers.
 *
 * The source crowd recordings are mastered much hotter than the cadence voice.
 * Keeping these ratios here prevents small iPad speakers from making the crowd
 * sound louder than the safety-critical gate and natural announcer.
 */
export const raceAudioMixProfile = Object.freeze({
  ambienceBedMix: 0.42,
  ambienceCrowdMix: 0.12,
  ambienceGateDuckMix: 0.025,
  cadenceVoiceGain: 2.35,
  cadenceVoiceHighPassHz: 125,
  cadenceVoicePresenceHz: 2_250,
  cadenceVoicePresenceGainDb: 4.5,
  cadenceVoiceLimiterThresholdDb: -10,
  cadenceVoiceLimiterRatio: 8,
  cadenceToneVolume: 0.72,
  gateToneVolume: 0.58,
  tickToneVolume: 0.34,
});
export const uciVoiceWatchGateOffsetMs = 5300;

export function bmxEventAmbienceLayerVolumes(
  volume: number,
  priority: { commentary?: boolean; gate?: boolean } = {},
) {
  const masterVolume = Math.max(0, Math.min(0.2, volume));
  // Natural commentary is mixed over the listener's configured ambience.
  // Keep the commentary flag for playback lifecycle telemetry, but reserve
  // ambience attenuation for the safety-critical gate cadence and tones.
  const priorityMix = priority.gate ? raceAudioMixProfile.ambienceGateDuckMix : 1;
  return {
    bed: masterVolume * priorityMix * raceAudioMixProfile.ambienceBedMix,
    crowd: masterVolume * priorityMix * raceAudioMixProfile.ambienceCrowdMix,
  };
}

export type BmxEventAmbienceProfile = {
  index: number;
  bedSourceUrl: string;
  bedStartOffsetSeconds: number;
  sourceUrl: string;
  startOffsetSeconds: number;
  loopStartOffsetSeconds: number;
  loopEndOffsetSeconds: number;
  playbackRate: number;
};

export function bmxEventAmbienceProfile(index: number): BmxEventAmbienceProfile {
  const normalizedIndex = (
    (Math.round(index) % bmxEventAmbienceVariationCount)
    + bmxEventAmbienceVariationCount
  ) % bmxEventAmbienceVariationCount;
  return {
    index: normalizedIndex,
    bedSourceUrl: tracksideBedSource.url,
    bedStartOffsetSeconds: Number((
      0.75 + (
        ((normalizedIndex * 29) % bmxEventAmbienceVariationCount)
        / bmxEventAmbienceVariationCount
      ) * 12
    ).toFixed(3)),
    sourceUrl: raceCrowdSource.url,
    startOffsetSeconds: Number((
      4 + (
        ((normalizedIndex * 47) % bmxEventAmbienceVariationCount)
        / bmxEventAmbienceVariationCount
      ) * 28
    ).toFixed(3)),
    loopStartOffsetSeconds: Number((
      4 + (
        ((normalizedIndex * 17) % bmxEventAmbienceVariationCount)
        / bmxEventAmbienceVariationCount
      ) * 8
    ).toFixed(3)),
    loopEndOffsetSeconds: raceCrowdLoopEndSeconds,
    playbackRate: Number((0.991 + (normalizedIndex % 7) * 0.003).toFixed(3)),
  };
}

type UciVoiceStartSource = 'audio' | 'fallback' | 'cancelled';
type StartGateToneKind = 'tick' | 'gate' | 'uci-red' | 'uci-green';

export type UciVoiceStartResult = {
  startedAt: number;
  /**
   * Same start event expressed on the browser's monotonic clock. Consumers
   * that measure an in-session response should use this rather than Date.now,
   * which can jump if the system clock is adjusted during a cadence.
   */
  startedAtMonotonic: number;
  source: UciVoiceStartSource;
};

function monotonicAudioNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(value);
    };
    const timeoutId = window.setTimeout(() => finish(fallback), timeoutMs);
    promise.then(finish).catch(() => finish(fallback));
  });
}

function getAudioContext() {
  if (audioContext && audioContext.state !== 'closed') {
    return audioContext;
  }
  if (audioContext?.state === 'closed') {
    stopRaceAudioKeepAlive();
    startGateMediaSource = null;
    startGateMediaGain = null;
    startGateMediaNodes = [];
    startGateMediaContext = null;
    activeStartGateAudio = null;
    mediaElementPrimed = false;
    raceAmbienceMediaContext = null;
    raceAmbienceBedSource = null;
    raceAmbienceCrowdSource = null;
    raceAmbienceBedGain = null;
    raceAmbienceCrowdGain = null;
    raceAmbienceBedAudio = null;
    raceAmbienceCrowdAudio = null;
    raceAmbiencePrimed = false;
    audioContext = null;
  }

  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

export function getTrackLabAudioContext() {
  return getAudioContext();
}

function getStartGateAudio() {
  if (!activeStartGateAudio) {
    activeStartGateAudio = new Audio(uciRandomStartVoiceUrl);
    activeStartGateAudio.preload = 'auto';
    activeStartGateAudio.setAttribute('playsinline', '');
  }

  return activeStartGateAudio;
}

function createStartGateVoiceMix(context: AudioContext) {
  const highPass = context.createBiquadFilter();
  const presence = context.createBiquadFilter();
  const gain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const now = context.currentTime;

  highPass.type = 'highpass';
  highPass.frequency.setValueAtTime(raceAudioMixProfile.cadenceVoiceHighPassHz, now);
  highPass.Q.setValueAtTime(0.7, now);
  presence.type = 'peaking';
  presence.frequency.setValueAtTime(raceAudioMixProfile.cadenceVoicePresenceHz, now);
  presence.Q.setValueAtTime(0.9, now);
  presence.gain.setValueAtTime(raceAudioMixProfile.cadenceVoicePresenceGainDb, now);
  gain.gain.setValueAtTime(raceAudioMixProfile.cadenceVoiceGain, now);
  limiter.threshold.setValueAtTime(raceAudioMixProfile.cadenceVoiceLimiterThresholdDb, now);
  limiter.knee.setValueAtTime(8, now);
  limiter.ratio.setValueAtTime(raceAudioMixProfile.cadenceVoiceLimiterRatio, now);
  limiter.attack.setValueAtTime(0.003, now);
  limiter.release.setValueAtTime(0.18, now);

  highPass.connect(presence);
  presence.connect(gain);
  gain.connect(limiter);
  limiter.connect(context.destination);
  return {
    input: highPass as AudioNode,
    gain,
    nodes: [highPass, presence, gain, limiter] as AudioNode[],
  };
}

function setStartGateMediaOutputGain(value: number) {
  if (!startGateMediaGain || !startGateMediaContext || startGateMediaContext.state === 'closed') return;
  const now = startGateMediaContext.currentTime;
  if (typeof startGateMediaGain.gain.cancelScheduledValues === 'function') {
    startGateMediaGain.gain.cancelScheduledValues(now);
  }
  startGateMediaGain.gain.setValueAtTime(value, now);
}

/**
 * Routes the cadence recording through an intelligibility EQ and limiter when
 * Web Audio is available. The HTMLAudioElement remains the playback clock, so
 * the same user-primed path still works in WKWebView; the gain may exceed 1
 * without clipping the tablet speaker.
 */
function connectStartGateMediaMix(audio: HTMLAudioElement, context: AudioContext | null) {
  if (!context || context.state === 'closed' || typeof context.createMediaElementSource !== 'function') {
    return false;
  }
  if (startGateMediaSource && startGateMediaContext === context) {
    return true;
  }
  if (startGateMediaSource || startGateMediaContext) {
    // A media element can only belong to one AudioContext. The closed-context
    // path recreates the element before reaching this point.
    return false;
  }

  try {
    const mix = createStartGateVoiceMix(context);
    const source = context.createMediaElementSource(audio);
    source.connect(mix.input);
    startGateMediaContext = context;
    startGateMediaSource = source;
    startGateMediaGain = mix.gain;
    startGateMediaNodes = mix.nodes;
    return true;
  } catch {
    return false;
  }
}

function startGateToneProfile(kind: StartGateToneKind) {
  const isGateTone = kind === 'gate' || kind === 'uci-green';
  return {
    frequency: kind.startsWith('uci') ? 632 : isGateTone ? 880 : 660,
    durationSeconds: kind === 'uci-green'
      ? uciGreenToneDurationSeconds
      : kind === 'uci-red'
        ? uciShortToneDurationSeconds
        : isGateTone
          ? 0.76
          : 0.17,
    volume: kind.startsWith('uci')
      ? raceAudioMixProfile.cadenceToneVolume
      : isGateTone
        ? raceAudioMixProfile.gateToneVolume
        : raceAudioMixProfile.tickToneVolume,
  };
}

function wavToneDataUrl(kind: StartGateToneKind) {
  const { frequency, durationSeconds, volume } = startGateToneProfile(kind);
  const sampleRate = 8_000;
  const sampleCount = Math.ceil(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const elapsedSeconds = index / sampleRate;
    const attack = Math.min(1, elapsedSeconds / 0.012);
    const release = Math.min(1, (durationSeconds - elapsedSeconds) / 0.045);
    const envelope = Math.max(0, Math.min(attack, release));
    const sample = Math.sin(elapsedSeconds * frequency * Math.PI * 2)
      * volume
      * envelope;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const startGateToneDataUrls = new Map<StartGateToneKind, string>();

function startGateToneUrl(kind: StartGateToneKind) {
  const existing = startGateToneDataUrls.get(kind);
  if (existing) {
    return existing;
  }
  const dataUrl = wavToneDataUrl(kind);
  startGateToneDataUrls.set(kind, dataUrl);
  return dataUrl;
}

function getStartGateToneAudio(index = 0) {
  while (startGateToneAudioPool.length <= index) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    startGateToneAudioPool.push(audio);
  }
  return startGateToneAudioPool[index];
}

function keepRaceCrowdInsideActiveAudio() {
  if (!raceAmbienceCrowdAudio || !activeRaceAmbienceProfile) {
    return;
  }
  if (raceAmbienceCrowdAudio.currentTime >= activeRaceAmbienceProfile.loopEndOffsetSeconds) {
    raceAmbienceCrowdAudio.currentTime = activeRaceAmbienceProfile.loopStartOffsetSeconds;
  }
}

function getRaceAmbienceAudioLayers() {
  if (!raceAmbienceBedAudio) {
    raceAmbienceBedAudio = new Audio(tracksideBedSource.url);
    raceAmbienceBedAudio.preload = 'auto';
    raceAmbienceBedAudio.loop = true;
    raceAmbienceBedAudio.setAttribute('playsinline', '');
  }
  if (!raceAmbienceCrowdAudio) {
    raceAmbienceCrowdAudio = new Audio(raceCrowdSource.url);
    raceAmbienceCrowdAudio.preload = 'auto';
    raceAmbienceCrowdAudio.loop = true;
    raceAmbienceCrowdAudio.setAttribute('playsinline', '');
    raceAmbienceCrowdAudio.addEventListener('timeupdate', keepRaceCrowdInsideActiveAudio);
  }

  return {
    bed: raceAmbienceBedAudio,
    crowd: raceAmbienceCrowdAudio,
  };
}

function connectRaceAmbienceLayer(
  audio: HTMLAudioElement,
  context: AudioContext,
): { source: MediaElementAudioSourceNode; gain: GainNode } | null {
  try {
    const gain = context.createGain();
    gain.connect(context.destination);
    const source = context.createMediaElementSource(audio);
    source.connect(gain);
    return { source, gain };
  } catch {
    // The element-volume fallback below remains available in browsers that do
    // not expose MediaElementAudioSourceNode or reject graph construction.
    return null;
  }
}

/**
 * iOS can ignore HTMLMediaElement.volume. Move both crowd recordings behind
 * real GainNodes whenever an AudioContext is available, including while it is
 * suspended. This makes media priming silent before iOS finishes resume(),
 * while retaining direct-media fallback only for browsers without Web Audio.
 */
function connectRaceAmbienceMediaMix(
  layers: { bed: HTMLAudioElement; crowd: HTMLAudioElement },
  context: AudioContext | null,
) {
  if (!context || context.state === 'closed' || typeof context.createMediaElementSource !== 'function') {
    return false;
  }
  if (raceAmbienceMediaContext && raceAmbienceMediaContext !== context) {
    return false;
  }
  raceAmbienceMediaContext = context;

  if (!raceAmbienceBedSource) {
    const connected = connectRaceAmbienceLayer(layers.bed, context);
    if (connected) {
      raceAmbienceBedSource = connected.source;
      raceAmbienceBedGain = connected.gain;
    }
  }
  if (!raceAmbienceCrowdSource) {
    const connected = connectRaceAmbienceLayer(layers.crowd, context);
    if (connected) {
      raceAmbienceCrowdSource = connected.source;
      raceAmbienceCrowdGain = connected.gain;
    }
  }
  applyRaceAmbienceVolume();
  return Boolean(raceAmbienceBedGain && raceAmbienceCrowdGain);
}

function nextRaceAmbienceProfile() {
  const values = new Uint32Array(1);
  let index = Date.now() % bmxEventAmbienceVariationCount;
  try {
    window.crypto?.getRandomValues(values);
    index = values[0] % bmxEventAmbienceVariationCount;
  } catch {
    // Time-based selection still rotates the profile when secure randomness is unavailable.
  }
  if (index === lastRaceAmbienceProfileIndex) {
    index = (index + 37) % bmxEventAmbienceVariationCount;
  }
  lastRaceAmbienceProfileIndex = index;
  return bmxEventAmbienceProfile(index);
}

function prepareRaceAmbience() {
  const { bed, crowd } = getRaceAmbienceAudioLayers();
  const profile = activeRaceAmbienceProfile ?? nextRaceAmbienceProfile();
  activeRaceAmbienceProfile = profile;
  if (!bed.src.endsWith(profile.bedSourceUrl)) {
    bed.src = profile.bedSourceUrl;
    raceAmbiencePrimed = false;
  }
  if (!crowd.src.endsWith(profile.sourceUrl)) {
    crowd.src = profile.sourceUrl;
    raceAmbiencePrimed = false;
  }
  bed.loop = true;
  bed.playbackRate = 1;
  crowd.loop = true;
  crowd.playbackRate = profile.playbackRate;
  if (bed.paused) {
    try {
      bed.currentTime = profile.bedStartOffsetSeconds;
    } catch {
      // The bed will start at its earliest seekable point if metadata is not ready.
    }
  }
  if (crowd.paused) {
    try {
      crowd.currentTime = profile.startOffsetSeconds;
    } catch {
      // The crowd layer will start at its earliest seekable point if metadata is not ready.
    }
  }
  return { bed, crowd, profile };
}

function applyRaceAmbienceVolume() {
  if (!raceAmbienceBedAudio && !raceAmbienceCrowdAudio) {
    // Record the priority state without allocating media elements. Gate tones
    // and cancellation tests must not create or autoplay ambience when the
    // ambient option is disabled.
    return;
  }
  const layerVolumes = bmxEventAmbienceLayerVolumes(raceAmbienceMasterVolume, {
    commentary: raceAmbienceCommentaryDucked,
    gate: raceAmbienceGateDucked,
  });
  const { bed, crowd } = getRaceAmbienceAudioLayers();
  const context = raceAmbienceMediaContext;
  const applyLayerVolume = (
    audio: HTMLAudioElement,
    gain: GainNode | null,
    volume: number,
  ) => {
    if (gain && context && context.state !== 'closed') {
      // The graph is authoritative on iOS; leave the media element at unity so
      // devices that honor both controls do not attenuate the signal twice.
      audio.volume = 1;
      if (typeof gain.gain.cancelScheduledValues === 'function') {
        gain.gain.cancelScheduledValues(context.currentTime);
      }
      gain.gain.setValueAtTime(volume, context.currentTime);
      return;
    }
    audio.volume = volume;
  };
  applyLayerVolume(bed, raceAmbienceBedGain, layerVolumes.bed);
  applyLayerVolume(crowd, raceAmbienceCrowdGain, layerVolumes.crowd);
  if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tracklab-race-audio-mix', {
      detail: {
        bed: layerVolumes.bed,
        crowd: layerVolumes.crowd,
        commentaryDucked: raceAmbienceCommentaryDucked,
        gateDucked: raceAmbienceGateDucked,
        webAudio: Boolean(raceAmbienceBedGain && raceAmbienceCrowdGain),
      },
    }));
  }
}

function setRaceAmbienceVolume(volume: number) {
  raceAmbienceMasterVolume = Math.max(0, Math.min(0.2, volume));
  applyRaceAmbienceVolume();
}

/** Records commentary playback while preserving the configured ambience mix. */
export function setBmxEventAmbienceCommentaryDucked(ducked: boolean) {
  if (raceAmbienceCommentaryDucked === ducked) return;
  raceAmbienceCommentaryDucked = ducked;
  applyRaceAmbienceVolume();
}

function setBmxEventAmbienceGateDucked(ducked: boolean) {
  if (raceAmbienceGateDucked === ducked) return;
  raceAmbienceGateDucked = ducked;
  applyRaceAmbienceVolume();
}

function scheduleRaceAmbienceGateDuckRelease(delayMs: number) {
  if (raceAmbienceGateDuckReleaseTimer != null) {
    window.clearTimeout(raceAmbienceGateDuckReleaseTimer);
  }
  raceAmbienceGateDuckReleaseTimer = window.setTimeout(() => {
    raceAmbienceGateDuckReleaseTimer = null;
    setBmxEventAmbienceGateDucked(false);
  }, Math.max(0, delayMs));
}

/**
 * Ends cadence ducking when a synchronized gate timeline catches up directly
 * to green without playing the now-stale green tone.
 */
export function releaseBmxEventAmbienceGateDuck() {
  if (raceAmbienceGateDuckReleaseTimer != null) {
    window.clearTimeout(raceAmbienceGateDuckReleaseTimer);
    raceAmbienceGateDuckReleaseTimer = null;
  }
  setBmxEventAmbienceGateDucked(false);
}

function loadUciVoiceBuffer(context: AudioContext) {
  if (!uciVoiceBufferPromise) {
    uciVoiceBufferPromise = fetch(uciRandomStartVoiceUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`UCI cadence audio returned ${response.status}`);
        }

        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .catch(() => null);
  }

  return uciVoiceBufferPromise;
}

function resumeAudioContext() {
  const context = getAudioContext();
  if (context && context.state !== 'running' && context.state !== 'closed') {
    void context.resume();
  }

  return context;
}

function startSilentUnlockPulse(context: AudioContext) {
  if (context.state === 'closed') {
    return;
  }
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(40, now);
    gain.gain.setValueAtTime(0.00001, now);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.03);
  } catch {
    // The media-element path remains available when Web Audio cannot start.
  }
}

function startRaceAudioKeepAlive(context: AudioContext) {
  if (context.state === 'closed' || raceAudioKeepAliveOscillator) {
    return;
  }

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(18, context.currentTime);
    gain.gain.setValueAtTime(0.00001, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    raceAudioKeepAliveOscillator = oscillator;
    raceAudioKeepAliveGain = gain;
  } catch {
    // Primed media elements remain available when Web Audio is unsupported.
  }
}

export function stopRaceAudioKeepAlive() {
  if (raceAudioKeepAliveOscillator) {
    try {
      raceAudioKeepAliveOscillator.stop();
    } catch {
      // The oscillator may already have stopped with its audio context.
    }
    raceAudioKeepAliveOscillator.disconnect();
    raceAudioKeepAliveOscillator = null;
  }
  if (raceAudioKeepAliveGain) {
    raceAudioKeepAliveGain.disconnect();
    raceAudioKeepAliveGain = null;
  }
}

function cancelPendingStartGateAudio(audio: HTMLAudioElement) {
  audio.muted = true;
  audio.pause();

  try {
    audio.currentTime = 0;
  } catch {
    // The audio may not have metadata yet.
  }

  try {
    audio.removeAttribute('src');
    audio.load();
  } catch {
    // Ignore browsers that refuse to unload a pending media request.
  }

  if (activeStartGateAudio === audio) {
    // Keep reusing the graph-bound element. MediaElementAudioSourceNode may
    // only be created once for a given element, so replacing it after one
    // failed play() would silently bypass the cadence EQ on the next race.
    if (!startGateMediaSource || !startGateMediaContext) {
      activeStartGateAudio = null;
    }
    mediaElementPrimed = false;
  }
}

export async function primeAudioCues() {
  const context = getAudioContext();
  const preloadTasks: Promise<unknown>[] = [];
  let contextResume: Promise<unknown> | null = null;

  if (context && context.state !== 'running' && context.state !== 'closed') {
    contextResume = context.resume();
    preloadTasks.push(contextResume);
  }
  if (context) {
    startSilentUnlockPulse(context);
    // Mobile browsers can suspend an otherwise idle AudioContext during the
    // staging countdown. Keep it active so the delayed UCI cadence and natural
    // commentary can still start after the full pre-race window.
    startRaceAudioKeepAlive(context);
  }

  const audio = getStartGateAudio();
  const cadenceGraphRouted = connectStartGateMediaMix(audio, context);
  audio.load();
  if (
    !mediaElementPrimed
    && !mediaElementPrimePromise
    && (!context || cadenceGraphRouted)
  ) {
    const primeGeneration = startGateAudioGeneration;
    startGateMediaPriming = true;
    audio.muted = false;
    audio.volume = cadenceGraphRouted ? 1 : 0.0001;
    if (cadenceGraphRouted) setStartGateMediaOutputGain(0.00001);
    mediaElementPrimePromise = audio.play()
      .then(() => {
        if (primeGeneration !== startGateAudioGeneration || activeStartGateAudio !== audio) {
          return;
        }
        audio.pause();
        audio.currentTime = 0;
        mediaElementPrimed = true;
      })
      .catch(() => {
        // AudioContext remains the primary path when media-element priming is blocked.
      })
      .finally(() => {
        startGateMediaPriming = false;
        if (startGateMediaSource && startGateMediaContext === context) {
          setStartGateMediaOutputGain(raceAudioMixProfile.cadenceVoiceGain);
        }
        audio.volume = 1;
        audio.muted = false;
        mediaElementPrimePromise = null;
      });
  }
  if (mediaElementPrimePromise) {
    preloadTasks.push(mediaElementPrimePromise);
  }

  // Prime the exact four fallback elements that later carry red/green tones.
  // Web Audio permission does not transfer to separate HTMLMediaElements, and
  // iOS can suspend the context before a remote coach start. The unlock WAV is
  // zero PCM, so it remains silent even if WKWebView ignores element.volume.
  const toneAudios = Array.from({ length: 4 }, (_, index) => getStartGateToneAudio(index));
  if (!startGateToneMediaPrimed && !startGateToneMediaPrimePromise) {
    const tonePrimeGeneration = startGateToneGeneration;
    toneAudios.forEach((toneAudio) => {
      toneAudio.src = startGateMediaUnlockUrl;
      toneAudio.setAttribute('data-tracklab-start-gate-tone', 'prime');
      toneAudio.muted = false;
      toneAudio.volume = 1;
      toneAudio.load();
    });
    startGateToneMediaPrimePromise = Promise.allSettled(
      toneAudios.map((toneAudio) => toneAudio.play()),
    )
      .then((results) => {
        if (tonePrimeGeneration === startGateToneGeneration) {
          startGateToneMediaPrimed = results.every((result) => result.status === 'fulfilled');
        }
      })
      .finally(() => {
        toneAudios.forEach((toneAudio) => {
          if (tonePrimeGeneration === startGateToneGeneration) {
            toneAudio.pause();
            toneAudio.currentTime = 0;
            toneAudio.volume = 1;
            toneAudio.muted = false;
            toneAudio.removeAttribute('data-tracklab-start-gate-tone');
          }
        });
        startGateToneMediaPrimePromise = null;
      });
  }
  if (startGateToneMediaPrimePromise) {
    preloadTasks.push(startGateToneMediaPrimePromise);
  }

  const { bed, crowd, profile } = prepareRaceAmbience();
  const ambienceGraphRouted = connectRaceAmbienceMediaMix({ bed, crowd }, context);
  if (
    !raceAmbiencePrimed
    && !raceAmbiencePrimePromise
    && (!context || ambienceGraphRouted)
  ) {
    bed.load();
    crowd.load();
    for (const layer of [bed, crowd]) {
      layer.muted = false;
      layer.volume = ambienceGraphRouted ? 1 : 0.0001;
    }
    const ambienceContext = raceAmbienceMediaContext;
    for (const gain of [raceAmbienceBedGain, raceAmbienceCrowdGain]) {
      if (gain && ambienceContext && ambienceContext.state !== 'closed') {
        if (typeof gain.gain.cancelScheduledValues === 'function') {
          gain.gain.cancelScheduledValues(ambienceContext.currentTime);
        }
        gain.gain.setValueAtTime(0.00001, ambienceContext.currentTime);
      }
    }
    raceAmbiencePrimePromise = Promise.allSettled([
      bed.play(),
      crowd.play(),
    ])
      .then((results) => {
        if (!raceAmbiencePlaybackRequested) {
          bed.pause();
          crowd.pause();
          bed.currentTime = profile.bedStartOffsetSeconds;
          crowd.currentTime = profile.startOffsetSeconds;
        }
        raceAmbiencePrimed = results.every((result) => result.status === 'fulfilled');
      })
      .finally(() => {
        applyRaceAmbienceVolume();
        bed.muted = false;
        crowd.muted = false;
        raceAmbiencePrimePromise = null;
      });
  }
  if (raceAmbiencePrimePromise) {
    preloadTasks.push(raceAmbiencePrimePromise);
  }

  await Promise.allSettled(
    preloadTasks.map((task) => settleWithin(Promise.resolve(task), 1_200, undefined)),
  );

  if (context && context.state === 'running') {
    await settleWithin(loadUciVoiceBuffer(context), 2_500, null);
  }
}

export async function startBmxEventAmbience(volume = 0.065) {
  const playbackGeneration = ++raceAmbiencePlaybackGeneration;
  raceAmbiencePlaybackRequested = true;
  const { bed, crowd, profile } = prepareRaceAmbience();
  const context = resumeAudioContext();
  if (context && context.state !== 'running' && context.state !== 'closed') {
    await settleWithin(context.resume(), 800, undefined);
  }
  if (
    !raceAmbiencePlaybackRequested
    || playbackGeneration !== raceAmbiencePlaybackGeneration
  ) {
    return false;
  }
  const ambienceGraphRouted = connectRaceAmbienceMediaMix({ bed, crowd }, context);
  if (context && !ambienceGraphRouted) {
    // A direct media fallback is unsafe on iOS because WKWebView may ignore
    // element.volume. Prefer no ambience over an uncontrolled full-volume
    // crowd whenever Web Audio exists but cannot own both media elements.
    if (playbackGeneration === raceAmbiencePlaybackGeneration) {
      raceAmbiencePlaybackRequested = false;
    }
    bed.pause();
    crowd.pause();
    return false;
  }
  const pendingPrime = raceAmbiencePrimePromise;
  if (pendingPrime) {
    await settleWithin(pendingPrime, 1_200, undefined);
  }
  if (
    !raceAmbiencePlaybackRequested
    || playbackGeneration !== raceAmbiencePlaybackGeneration
  ) {
    return false;
  }

  bed.loop = true;
  bed.muted = false;
  bed.playbackRate = 1;
  crowd.loop = true;
  crowd.muted = false;
  crowd.playbackRate = profile.playbackRate;
  setRaceAmbienceVolume(volume);
  const [bedStarted, crowdStarted] = await Promise.all([
    settleWithin(bed.play().then(() => true).catch(() => false), 1_200, false),
    settleWithin(crowd.play().then(() => true).catch(() => false), 1_200, false),
  ]);
  if (
    !raceAmbiencePlaybackRequested
    || playbackGeneration !== raceAmbiencePlaybackGeneration
  ) {
    return false;
  }
  return bedStarted || crowdStarted;
}

export function stopBmxEventAmbience() {
  raceAmbiencePlaybackGeneration += 1;
  raceAmbiencePlaybackRequested = false;
  activeRaceAmbienceProfile = null;
  if (raceAmbienceGateDuckReleaseTimer != null) {
    window.clearTimeout(raceAmbienceGateDuckReleaseTimer);
    raceAmbienceGateDuckReleaseTimer = null;
  }
  raceAmbienceGateDucked = false;
  for (const layer of [raceAmbienceBedAudio, raceAmbienceCrowdAudio]) {
    if (!layer) {
      continue;
    }
    layer.pause();
    try {
      layer.currentTime = 0;
    } catch {
      // The media element may not have loaded enough metadata yet.
    }
  }
}

export function playZoneCue(kind: 'start' | 'stop') {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  if (context.state !== 'running' && context.state !== 'closed') {
    void context.resume();
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(kind === 'start' ? 960 : 420, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(kind === 'start' ? 0.18 : 0.14, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'start' ? 0.16 : 0.24));

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (kind === 'start' ? 0.18 : 0.26));
}

function playStartGateToneWithWebAudio(kind: StartGateToneKind) {
  const context = getAudioContext();
  if (!context || context.state !== 'running') {
    return false;
  }

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const { frequency, durationSeconds, volume } = startGateToneProfile(kind);
    const attackSeconds = Math.min(0.012, durationSeconds * 0.2);
    const releaseSeconds = Math.min(0.045, durationSeconds * 0.25);
    const releaseAt = now + Math.max(
      attackSeconds + 0.001,
      durationSeconds - releaseSeconds,
    );

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackSeconds);
    gain.gain.setValueAtTime(volume, releaseAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.002);
    return true;
  } catch {
    return false;
  }
}

export function playStartGateTone(kind: StartGateToneKind) {
  const toneGeneration = ++startGateToneGeneration;
  const toneWasCancelled = () => toneGeneration !== startGateToneGeneration;
  if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tracklab-start-gate-tone', {
      detail: { kind, at: Date.now() },
    }));
  }
  if (kind === 'uci-red') {
    setBmxEventAmbienceGateDucked(true);
  } else if (kind === 'uci-green') {
    scheduleRaceAmbienceGateDuckRelease((uciGreenToneDurationSeconds * 1_000) + 80);
  }
  const context = resumeAudioContext();
  if (playStartGateToneWithWebAudio(kind)) {
    return;
  }

  const audioIndex = startGateToneAudioIndex % 4;
  startGateToneAudioIndex += 1;
  const audio = getStartGateToneAudio(audioIndex);
  audio.pause();
  audio.src = startGateToneUrl(kind);
  audio.preload = 'auto';
  audio.muted = false;
  audio.volume = 1;
  audio.currentTime = 0;
  audio.setAttribute('data-tracklab-start-gate-tone', kind);
  audio.load();
  void settleWithin(
    audio.play().then(() => true).catch(() => false),
    500,
    false,
  ).then((started) => {
    if (toneWasCancelled()) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    if (started || !context || context.state === 'closed') {
      return;
    }
    void context.resume()
      .then(() => {
        if (!toneWasCancelled()) {
          playStartGateToneWithWebAudio(kind);
        }
      })
      .catch(() => undefined);
  });
}

export function stopStartGateAudio() {
  // Invalidate async voice startup work as well as stopping sources that have
  // already started. A slow media element, AudioContext resume, or buffer load
  // must not revive the cadence after a red/green phase or explicit cancel.
  startGateAudioGeneration += 1;
  startGateToneGeneration += 1;

  if (activeStartGateBufferSource) {
    try {
      activeStartGateBufferSource.stop();
    } catch {
      // The source may already have ended.
    }
    activeStartGateBufferSource.disconnect();
    activeStartGateBufferSource = null;
  }
  activeStartGateBufferNodes.forEach((node) => node.disconnect());
  activeStartGateBufferNodes = [];

  if (activeStartGateAudio) {
    activeStartGateAudio.pause();
    activeStartGateAudio.currentTime = 0;
  }

  startGateToneAudioPool.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });

  window.speechSynthesis?.cancel();
}

export async function playUciRandomStartVoice(timeoutMs = 2_500): Promise<UciVoiceStartResult> {
  stopStartGateAudio();
  startGateMediaPriming = false;
  setBmxEventAmbienceGateDucked(true);
  const playbackGeneration = startGateAudioGeneration;
  const playbackWasCancelled = () => playbackGeneration !== startGateAudioGeneration;
  const cancelledResult = (): UciVoiceStartResult => ({
    startedAt: Date.now(),
    startedAtMonotonic: monotonicAudioNow(),
    source: 'cancelled',
  });
  const audio = getStartGateAudio();
  const context = getAudioContext();
  if (context && context.state !== 'running' && context.state !== 'closed') {
    await settleWithin(context.resume(), 1_200, undefined);
    if (playbackWasCancelled()) return cancelledResult();
  }
  connectStartGateMediaMix(audio, context);
  setStartGateMediaOutputGain(raceAudioMixProfile.cadenceVoiceGain);
  if (!audio.src.endsWith(uciRandomStartVoiceUrl)) {
    audio.src = uciRandomStartVoiceUrl;
  }
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.muted = false;
  audio.volume = 1;
  audio.currentTime = 0;

  // A graph-bound element is inaudible while its context is suspended even if
  // HTMLMediaElement.play() resolves. Do not report that as a real cadence;
  // move directly to the independent tone fallback instead.
  const mediaGraphBlocked = Boolean(
    startGateMediaSource
    && startGateMediaContext
    && startGateMediaContext.state !== 'running',
  );
  const mediaResult = mediaGraphBlocked ? null : await new Promise<UciVoiceStartResult | null>((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      audio.removeEventListener('playing', handleAudioStarted);
    };

    const finish = (result: UciVoiceStartResult | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    };

    function handleAudioStarted() {
      finish({
        startedAt: Date.now(),
        startedAtMonotonic: monotonicAudioNow(),
        source: 'audio',
      });
    }

    audio.addEventListener('playing', handleAudioStarted, { once: true });
    timeoutId = window.setTimeout(() => finish(null), timeoutMs);

    void audio.play()
      .then(() => {
        finish({
          startedAt: Date.now(),
          startedAtMonotonic: monotonicAudioNow(),
          source: 'audio',
        });
      })
      .catch(() => finish(null));
  });
  if (playbackWasCancelled()) {
    return cancelledResult();
  }

  if (mediaResult) {
    return mediaResult;
  }

  cancelPendingStartGateAudio(audio);
  const fallbackContext = getAudioContext();
  if (fallbackContext && fallbackContext.state !== 'running' && fallbackContext.state !== 'closed') {
    await settleWithin(fallbackContext.resume(), 1_200, undefined);
    if (playbackWasCancelled()) {
      return cancelledResult();
    }
  }

  if (fallbackContext?.state === 'running') {
    const voiceBuffer = await settleWithin(loadUciVoiceBuffer(fallbackContext), 2_500, null);
    if (playbackWasCancelled()) {
      return cancelledResult();
    }
    if (voiceBuffer) {
      if (playbackWasCancelled()) {
        return cancelledResult();
      }
      const source = fallbackContext.createBufferSource();
      const mix = createStartGateVoiceMix(fallbackContext);
      source.buffer = voiceBuffer;
      source.connect(mix.input);
      source.addEventListener('ended', () => {
        if (activeStartGateBufferSource === source) {
          activeStartGateBufferSource = null;
          activeStartGateBufferNodes = [];
        }
        source.disconnect();
        mix.nodes.forEach((node) => node.disconnect());
      }, { once: true });
      activeStartGateBufferSource = source;
      activeStartGateBufferNodes = mix.nodes;
      const startedAt = Date.now();
      const startedAtMonotonic = monotonicAudioNow();
      if (playbackWasCancelled()) {
        activeStartGateBufferSource = null;
        activeStartGateBufferNodes = [];
        source.disconnect();
        mix.nodes.forEach((node) => node.disconnect());
        return cancelledResult();
      }
      source.start();
      return { startedAt, startedAtMonotonic, source: 'audio' };
    }
  }

  if (playbackWasCancelled()) {
    return cancelledResult();
  }
  playStartGateTone('tick');
  return {
    startedAt: Date.now(),
    startedAtMonotonic: monotonicAudioNow(),
    source: 'fallback',
  };
}
