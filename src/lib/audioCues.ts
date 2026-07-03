type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let activeStartGateAudio: HTMLAudioElement | null = null;

export const uciRandomStartVoiceUrl = '/assets/uci-random-start.mp3';
export const uciVoiceWatchGateOffsetMs = 5300;

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

function resumeAudioContext() {
  const context = getAudioContext();
  if (context?.state === 'suspended') {
    void context.resume();
  }

  return context;
}

export function primeAudioCues() {
  const context = resumeAudioContext();

  if (context && context.state !== 'closed') {
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
  }

  const audio = getStartGateAudio();
  audio.load();
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
  if (activeStartGateAudio) {
    activeStartGateAudio.pause();
    activeStartGateAudio.currentTime = 0;
  }

  window.speechSynthesis?.cancel();
}

export function playUciRandomStartVoice() {
  stopStartGateAudio();
  resumeAudioContext();

  const audio = getStartGateAudio();
  audio.preload = 'auto';
  audio.muted = false;
  audio.volume = 1;
  audio.currentTime = 0;

  void audio.play().catch(() => {
    playStartGateTone('tick');
    speakStartGatePhrase('OK riders, random start. Riders ready. Watch the gate.');
  });

  return audio;
}
