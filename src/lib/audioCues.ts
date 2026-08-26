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
let activeStartGateBufferSource: AudioBufferSourceNode | null = null;
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
let raceAmbiencePrimed = false;
let raceAmbiencePrimePromise: Promise<void> | null = null;
let activeRaceAmbienceProfile: BmxEventAmbienceProfile | null = null;
let lastRaceAmbienceProfileIndex = -1;
let raceAmbienceMasterVolume = 0.065;
let raceAmbienceCommentaryDucked = false;

export const uciRandomStartVoiceUrl = '/assets/uci-random-start.mp3';
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
const raceAmbienceBedMix = 0.74;
const raceAmbienceCrowdMix = 0.34;
const raceAmbienceCommentaryDuckMix = 0.2;
export const uciVoiceWatchGateOffsetMs = 5300;

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
  source: UciVoiceStartSource;
};

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
    volume: kind.startsWith('uci') ? 0.42 : isGateTone ? 0.28 : 0.17,
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
  const masterVolume = raceAmbienceMasterVolume
    * (raceAmbienceCommentaryDucked ? raceAmbienceCommentaryDuckMix : 1);
  const { bed, crowd } = getRaceAmbienceAudioLayers();
  bed.volume = masterVolume * raceAmbienceBedMix;
  crowd.volume = masterVolume * raceAmbienceCrowdMix;
}

function setRaceAmbienceVolume(volume: number) {
  raceAmbienceMasterVolume = Math.max(0, Math.min(0.2, volume));
  applyRaceAmbienceVolume();
}

/** Keeps the announcer intelligible without stopping or reloading ambience. */
export function setBmxEventAmbienceCommentaryDucked(ducked: boolean) {
  if (raceAmbienceCommentaryDucked === ducked) return;
  raceAmbienceCommentaryDucked = ducked;
  applyRaceAmbienceVolume();
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
    activeStartGateAudio = null;
    mediaElementPrimed = false;
  }
}

export async function primeAudioCues() {
  const context = getAudioContext();
  const preloadTasks: Promise<unknown>[] = [];

  if (context && context.state !== 'running' && context.state !== 'closed') {
    preloadTasks.push(context.resume());
  }
  if (context) {
    startSilentUnlockPulse(context);
    // Mobile browsers can suspend an otherwise idle AudioContext during the
    // staging countdown. Keep it active so the delayed UCI cadence and natural
    // commentary can still start after the full pre-race window.
    startRaceAudioKeepAlive(context);
  }

  const audio = getStartGateAudio();
  audio.load();
  if (!mediaElementPrimed && !mediaElementPrimePromise) {
    audio.muted = false;
    audio.volume = 0.0001;
    mediaElementPrimePromise = audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        mediaElementPrimed = true;
      })
      .catch(() => {
        // AudioContext remains the primary path when media-element priming is blocked.
      })
      .finally(() => {
        audio.volume = 1;
        audio.muted = false;
        mediaElementPrimePromise = null;
      });
  }
  if (mediaElementPrimePromise) {
    preloadTasks.push(mediaElementPrimePromise);
  }

  const toneAudios = Array.from({ length: 4 }, (_, index) => getStartGateToneAudio(index));
  if (!startGateToneMediaPrimed && !startGateToneMediaPrimePromise) {
    toneAudios.forEach((toneAudio) => {
      toneAudio.src = startGateToneUrl('tick');
      toneAudio.setAttribute('data-tracklab-start-gate-tone', 'prime');
      toneAudio.muted = false;
      toneAudio.volume = 0.0001;
      toneAudio.load();
    });
    startGateToneMediaPrimePromise = Promise.allSettled(
      toneAudios.map((toneAudio) => toneAudio.play()),
    )
      .then((results) => {
        startGateToneMediaPrimed = results.every((result) => result.status === 'fulfilled');
      })
      .finally(() => {
        toneAudios.forEach((toneAudio) => {
          toneAudio.pause();
          toneAudio.currentTime = 0;
          toneAudio.volume = 1;
          toneAudio.muted = false;
          toneAudio.removeAttribute('data-tracklab-start-gate-tone');
        });
        startGateToneMediaPrimePromise = null;
      });
  }
  if (startGateToneMediaPrimePromise) {
    preloadTasks.push(startGateToneMediaPrimePromise);
  }

  const { bed, crowd, profile } = prepareRaceAmbience();
  if (!raceAmbiencePrimed && !raceAmbiencePrimePromise) {
    bed.load();
    crowd.load();
    for (const layer of [bed, crowd]) {
      layer.muted = false;
      layer.volume = 0.0001;
    }
    raceAmbiencePrimePromise = Promise.allSettled([
      bed.play(),
      crowd.play(),
    ])
      .then((results) => {
        bed.pause();
        crowd.pause();
        bed.currentTime = profile.bedStartOffsetSeconds;
        crowd.currentTime = profile.startOffsetSeconds;
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
  const { bed, crowd, profile } = prepareRaceAmbience();
  const pendingPrime = raceAmbiencePrimePromise;
  if (pendingPrime) {
    await settleWithin(pendingPrime, 1_200, undefined);
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
  return bedStarted || crowdStarted;
}

export function stopBmxEventAmbience() {
  activeRaceAmbienceProfile = null;
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
  const playbackGeneration = startGateAudioGeneration;
  const playbackWasCancelled = () => playbackGeneration !== startGateAudioGeneration;
  const cancelledResult = (): UciVoiceStartResult => ({
    startedAt: Date.now(),
    source: 'cancelled',
  });
  const audio = getStartGateAudio();
  if (!audio.src.endsWith(uciRandomStartVoiceUrl)) {
    audio.src = uciRandomStartVoiceUrl;
  }
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.muted = false;
  audio.volume = 1;
  audio.currentTime = 0;

  const mediaResult = await new Promise<UciVoiceStartResult | null>((resolve) => {
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
      finish({ startedAt: Date.now(), source: 'audio' });
    }

    audio.addEventListener('playing', handleAudioStarted, { once: true });
    timeoutId = window.setTimeout(() => finish(null), timeoutMs);

    void audio.play()
      .then(() => {
        finish({ startedAt: Date.now(), source: 'audio' });
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
  const context = getAudioContext();
  if (context && context.state !== 'running' && context.state !== 'closed') {
    await settleWithin(context.resume(), 1_200, undefined);
    if (playbackWasCancelled()) {
      return cancelledResult();
    }
  }

  if (context?.state === 'running') {
    const voiceBuffer = await settleWithin(loadUciVoiceBuffer(context), 2_500, null);
    if (playbackWasCancelled()) {
      return cancelledResult();
    }
    if (voiceBuffer) {
      if (playbackWasCancelled()) {
        return cancelledResult();
      }
      const source = context.createBufferSource();
      source.buffer = voiceBuffer;
      source.connect(context.destination);
      source.addEventListener('ended', () => {
        if (activeStartGateBufferSource === source) {
          activeStartGateBufferSource = null;
        }
        source.disconnect();
      }, { once: true });
      activeStartGateBufferSource = source;
      const startedAt = Date.now();
      if (playbackWasCancelled()) {
        activeStartGateBufferSource = null;
        source.disconnect();
        return cancelledResult();
      }
      source.start();
      return { startedAt, source: 'audio' };
    }
  }

  if (playbackWasCancelled()) {
    return cancelledResult();
  }
  playStartGateTone('tick');
  return { startedAt: Date.now(), source: 'fallback' };
}
