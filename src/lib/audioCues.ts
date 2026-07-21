type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let activeStartGateAudio: HTMLAudioElement | null = null;
let activeStartGateBufferSource: AudioBufferSourceNode | null = null;
let uciVoiceBufferPromise: Promise<AudioBuffer | null> | null = null;
let mediaElementPrimed = false;
let mediaElementPrimePromise: Promise<void> | null = null;

export const uciRandomStartVoiceUrl = '/assets/uci-random-start.mp3';
export const uciVoiceWatchGateOffsetMs = 5300;

type UciVoiceStartSource = 'audio' | 'fallback';

export type UciVoiceStartResult = {
  startedAt: number;
  source: UciVoiceStartSource;
};

function getAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

function getStartGateAudio() {
  if (!activeStartGateAudio) {
    activeStartGateAudio = new Audio(uciRandomStartVoiceUrl);
    activeStartGateAudio.preload = 'auto';
  }

  return activeStartGateAudio;
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
  if (context?.state === 'suspended') {
    void context.resume();
  }

  return context;
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

  if (context?.state === 'suspended') {
    preloadTasks.push(context.resume());
  }

  const audio = getStartGateAudio();
  audio.load();
  if (!mediaElementPrimed && !mediaElementPrimePromise) {
    audio.muted = true;
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
        audio.muted = false;
        mediaElementPrimePromise = null;
      });
  }
  if (mediaElementPrimePromise) {
    preloadTasks.push(mediaElementPrimePromise);
  }

  await Promise.allSettled(preloadTasks);

  if (context && context.state === 'running') {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(40, now);
    gain.gain.setValueAtTime(0.00001, now);
    gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.025);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.03);
    await loadUciVoiceBuffer(context);
  }
}

export function playZoneCue(kind: 'start' | 'stop') {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  if (context.state === 'suspended') {
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

export async function playUciRandomStartVoice(timeoutMs = 8000): Promise<UciVoiceStartResult> {
  stopStartGateAudio();
  const context = getAudioContext();

  if (context?.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      // Fall back to the primed media element and speech synthesis below.
    }
  }

  if (context?.state === 'running') {
    const voiceBuffer = await loadUciVoiceBuffer(context);
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
