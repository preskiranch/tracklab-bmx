import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRaceCommentaryTracker,
  detectRaceCommentaryEvents,
  localCommentaryLine,
  type RaceCommentaryEvent,
} from '../lib/raceCommentary';
import type {
  PlayerSlot,
  RaceCommentaryPreferences,
  RaceCommentaryVoicePreset,
  RaceState,
  ReactionTimesByPlayer,
  RiderState,
  TrackZone,
} from '../types';

type CommentaryServiceMode = 'checking' | 'ai' | 'browser';
type CommentaryPlaybackStatus = 'idle' | 'thinking' | 'speaking';

type UseRaceCommentaryOptions = {
  preferences: RaceCommentaryPreferences;
  raceState: RaceState;
  trackName: string;
  raceLengthMeters: number;
  players: PlayerSlot[];
  riders: RiderState[];
  zones: TrackZone[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  onRecentLinesChange: (lines: string[]) => void;
};

function speechLanguage(voicePreset: RaceCommentaryVoicePreset) {
  return voicePreset === 'american-man' ? 'en-US' : 'en-AU';
}

function browserVoiceFor(voicePreset: RaceCommentaryVoicePreset) {
  if (!('speechSynthesis' in window)) {
    return null;
  }

  const language = speechLanguage(voicePreset).toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang.toLowerCase() === language)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(language.slice(0, 2)))
    ?? null;
}

function speakWithBrowser(
  line: string,
  voicePreset: RaceCommentaryVoicePreset,
  volume: number,
) {
  return new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(
      finish,
      Math.min(6_500, Math.max(1_800, line.length * 55)),
    );
    utterance.lang = speechLanguage(voicePreset);
    utterance.voice = browserVoiceFor(voicePreset);
    utterance.volume = volume;
    utterance.rate = voicePreset === 'american-man' ? 1.08 : 1.04;
    utterance.pitch = voicePreset === 'australian-woman' ? 1.04 : 0.9;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function playAiSpeech(
  line: string,
  preferences: RaceCommentaryPreferences,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
) {
  const response = await fetchWithTimeout('/api/commentary/speech', {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      line,
      voicePreset: preferences.voicePreset,
    }),
  }, 5_000);
  if (!response.ok) {
    throw new Error(`Speech service returned ${response.status}`);
  }

  const audioUrl = URL.createObjectURL(await response.blob());
  const audio = new Audio(audioUrl);
  activeAudioRef.current = audio;
  audio.volume = preferences.volume;
  await new Promise<void>((resolve, reject) => {
    const release = () => {
      URL.revokeObjectURL(audioUrl);
      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null;
      }
    };
    audio.onended = () => {
      release();
      resolve();
    };
    audio.onerror = () => {
      release();
      reject(new Error('AI speech audio could not be played.'));
    };
    void audio.play().catch((error) => {
      release();
      reject(error);
    });
  });
}

export function useRaceCommentary({
  preferences,
  raceState,
  trackName,
  raceLengthMeters,
  players,
  riders,
  zones,
  reactionTimesByPlayer,
  onRecentLinesChange,
}: UseRaceCommentaryOptions) {
  const [serviceMode, setServiceMode] = useState<CommentaryServiceMode>('checking');
  const [playbackStatus, setPlaybackStatus] = useState<CommentaryPlaybackStatus>('idle');
  const [currentLine, setCurrentLine] = useState<string | null>(null);
  const trackerRef = useRef(createRaceCommentaryTracker());
  const preferencesRef = useRef(preferences);
  const recentLinesChangeRef = useRef(onRecentLinesChange);
  const queueRef = useRef<RaceCommentaryEvent[]>([]);
  const drainingRef = useRef(false);
  const generationRef = useRef(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const captionTimeoutRef = useRef<number | null>(null);

  preferencesRef.current = preferences;
  recentLinesChangeRef.current = onRecentLinesChange;

  const stopPlayback = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (captionTimeoutRef.current != null) {
      window.clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = null;
    }
    setPlaybackStatus('idle');
    setCurrentLine(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/commentary/config', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => response.ok
        ? await response.json() as { aiAvailable?: boolean }
        : { aiAvailable: false })
      .then((config) => {
        if (!cancelled) {
          setServiceMode(config.aiAvailable ? 'ai' : 'browser');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceMode('browser');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberLine = useCallback((line: string) => {
    const currentPreferences = preferencesRef.current;
    if (!currentPreferences.adaptiveMemory) {
      return;
    }
    const lines = [...currentPreferences.recentLines.filter((item) => item !== line), line].slice(-12);
    preferencesRef.current = { ...currentPreferences, recentLines: lines };
    recentLinesChangeRef.current(lines);
  }, []);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) {
      return;
    }
    drainingRef.current = true;
    const generation = generationRef.current;

    try {
      while (queueRef.current.length > 0 && generation === generationRef.current) {
        const event = queueRef.current.shift();
        if (!event || !preferencesRef.current.enabled) {
          continue;
        }

        const activePreferences = preferencesRef.current;
        setPlaybackStatus('thinking');
        let line = '';
        let useAiSpeech = serviceMode === 'ai';

        if (serviceMode === 'ai') {
          try {
            const response = await fetchWithTimeout('/api/commentary/line', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                event,
                model: activePreferences.model,
                voicePreset: activePreferences.voicePreset,
                recentLines: activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
              }),
            }, 4_000);
            if (!response.ok) {
              throw new Error(`Commentary service returned ${response.status}`);
            }
            const payload = await response.json() as { line?: string };
            line = typeof payload.line === 'string' ? payload.line.trim() : '';
            if (!line) {
              throw new Error('Commentary service returned an empty call.');
            }
          } catch {
            setServiceMode('browser');
            useAiSpeech = false;
          }
        }

        if (!line) {
          line = localCommentaryLine(
            event,
            activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
          );
        }
        if (generation !== generationRef.current) {
          break;
        }

        if (captionTimeoutRef.current != null) {
          window.clearTimeout(captionTimeoutRef.current);
          captionTimeoutRef.current = null;
        }
        setCurrentLine(line);
        rememberLine(line);
        setPlaybackStatus('speaking');
        try {
          if (useAiSpeech) {
            await playAiSpeech(line, activePreferences, activeAudioRef);
          } else {
            await speakWithBrowser(line, activePreferences.voicePreset, activePreferences.volume);
          }
        } catch {
          setServiceMode('browser');
          await speakWithBrowser(line, activePreferences.voicePreset, activePreferences.volume);
        }
        setPlaybackStatus('idle');

        if (captionTimeoutRef.current != null) {
          window.clearTimeout(captionTimeoutRef.current);
        }
        captionTimeoutRef.current = window.setTimeout(() => {
          setCurrentLine(null);
          captionTimeoutRef.current = null;
        }, 2_500);
      }
    } finally {
      drainingRef.current = false;
      setPlaybackStatus('idle');
    }
  }, [rememberLine, serviceMode]);

  useEffect(() => {
    if (!preferences.enabled) {
      stopPlayback();
      trackerRef.current = createRaceCommentaryTracker();
      return;
    }

    const events = detectRaceCommentaryEvents(trackerRef.current, {
      raceState,
      trackName,
      raceLengthMeters,
      players,
      riders,
      zones,
      reactionTimesByPlayer,
    });
    if (raceState === 'ready') {
      stopPlayback();
      return;
    }
    if (events.length === 0) {
      return;
    }

    const highPriority = events.find((event) => event.kind === 'finish');
    queueRef.current = highPriority
      ? [highPriority]
      : [...queueRef.current, ...events].slice(-2);
    void drainQueue();
  }, [
    drainQueue,
    players,
    preferences.enabled,
    raceLengthMeters,
    raceState,
    reactionTimesByPlayer,
    riders,
    stopPlayback,
    trackName,
    zones,
  ]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const preview = useCallback(async () => {
    const activePreferences = preferencesRef.current;
    const line = activePreferences.voicePreset === 'american-man'
      ? 'TrackLab announcer ready. Riders, get set for the gate.'
      : 'TrackLab announcer ready. Riders, get set for the gate.';
    activeAudioRef.current?.pause();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setCurrentLine(line);
    setPlaybackStatus('speaking');
    try {
      if (serviceMode === 'ai') {
        await playAiSpeech(line, activePreferences, activeAudioRef);
      } else {
        await speakWithBrowser(line, activePreferences.voicePreset, activePreferences.volume);
      }
    } catch {
      setServiceMode('browser');
      await speakWithBrowser(line, activePreferences.voicePreset, activePreferences.volume);
    } finally {
      setPlaybackStatus('idle');
    }
  }, [serviceMode]);

  return {
    currentLine,
    playbackStatus,
    serviceMode,
    preview,
    stop: stopPlayback,
  };
}
