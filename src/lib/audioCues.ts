type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let activeStartGateAudio: HTMLAudioElement | null = null;
let activeStartGateBufferSource: AudioBufferSourceNode | null = null;
let uciVoiceBufferPromise: Promise<AudioBuffer | null> | null = null;
let mediaElementPrimed = false;
let mediaElementPrimePromise: Promise<void> | null = null;
let raceAmbienceAudio: HTMLAudioElement | null = null;
let raceAmbiencePrimed = false;
let raceAmbiencePrimePromise: Promise<void> | null = null;

export const uciRandomStartVoiceUrl = '/assets/uci-random-start.mp3';
export const bmxEventAmbienceUrl = '/assets/bmx-event-ambience.mp3';
export const uciVoiceWatchGateOffsetMs = 5300;

type UciVoiceStartSource = 'audio' | 'fallback';

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
  }

  return activeStartGateAudio;
}

function getRaceAmbienceAudio() {
  if (!raceAmbienceAudio) {
    raceAmbienceAudio = new Audio(bmxEventAmbienceUrl);
    raceAmbienceAudio.preload = 'auto';
    raceAmbienceAudio.loop = true;
    raceAmbienceAudio.setAttribute('playsinline', '');
  }

  return raceAmbienceAudio;
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

  const ambience = getRaceAmbienceAudio();
  if (!raceAmbiencePrimed && !raceAmbiencePrimePromise) {
    ambience.load();
    ambience.muted = false;
    ambience.volume = 0.0001;
    raceAmbiencePrimePromise = ambience.play()
      .then(() => {
        ambience.pause();
        ambience.currentTime = 0;
        raceAmbiencePrimed = true;
      })
      .catch(() => {
        // A later race-start gesture can retry playback when priming is blocked.
      })
      .finally(() => {
        ambience.volume = 0.065;
        ambience.muted = false;
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
  const ambience = getRaceAmbienceAudio();
  const pendingPrime = raceAmbiencePrimePromise;
  if (pendingPrime) {
    await settleWithin(pendingPrime, 1_200, undefined);
  }

  ambience.loop = true;
  ambience.muted = false;
  ambience.volume = Math.max(0, Math.min(0.2, volume));
  try {
    await ambience.play();
    return true;
  } catch {
    return false;
  }
}

export function stopBmxEventAmbience() {
  if (!raceAmbienceAudio) {
    return;
  }
  raceAmbienceAudio.pause();
  try {
    raceAmbienceAudio.currentTime = 0;
  } catch {
    // The media element may not have loaded enough metadata yet.
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

export function playStartGateTone(kind: 'tick' | 'gate' | 'uci-red' | 'uci-green') {
  const context = resumeAudioContext();
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const isGateTone = kind === 'gate' || kind === 'uci-green';

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(kind.startsWith('uci') ? 632 : isGateTone ? 880 : 660, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isGateTone ? 0.24 : 0.17, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'uci-green' ? 2.25 : isGateTone ? 0.72 : 0.14));

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (kind === 'uci-green' ? 2.28 : isGateTone ? 0.76 : 0.17));
}

export function speakStartGatePhrase(text: string) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.03;
  utterance.pitch = 0.82;
  utterance.volume = 0.9;
  window.speechSynthesis.speak(utterance);
}

export function stopStartGateAudio() {
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

  window.speechSynthesis?.cancel();
}

export async function playUciRandomStartVoice(timeoutMs = 2_500): Promise<UciVoiceStartResult> {
  stopStartGateAudio();
  const context = getAudioContext();

  if (context && context.state !== 'running' && context.state !== 'closed') {
    await settleWithin(context.resume(), 1_200, undefined);
  }

  if (context?.state === 'running') {
    const voiceBuffer = await settleWithin(loadUciVoiceBuffer(context), 2_500, null);
    if (voiceBuffer) {
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
      source.start();
      return { startedAt, source: 'audio' };
    }
  }

  const audio = getStartGateAudio();
  audio.preload = 'auto';
  audio.muted = false;
  audio.volume = 1;
  audio.currentTime = 0;

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      audio.removeEventListener('playing', handleAudioStarted);
    };

    const finish = (source: UciVoiceStartSource) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({ startedAt: Date.now(), source });
    };

    const startFallback = () => {
      cancelPendingStartGateAudio(audio);
      playStartGateTone('tick');
      speakStartGatePhrase('OK riders, random start. Riders ready. Watch the gate.');
      finish('fallback');
    };

    function handleAudioStarted() {
      finish('audio');
    }

    audio.addEventListener('playing', handleAudioStarted, { once: true });
    timeoutId = window.setTimeout(startFallback, timeoutMs);

    void audio.play()
      .then(() => {
        finish('audio');
      })
      .catch(startFallback);
  });
}
