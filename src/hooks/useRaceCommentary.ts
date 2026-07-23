import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRaceCommentaryTracker,
  detectRaceCommentaryEvents,
  localCommentaryLine,
  raceCommentaryEventIsFresh,
  selectLiveRaceCommentaryEvent,
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
type CommentaryPlaybackPhase = CommentaryPlaybackStatus | 'preparing';
type ActivePlaybackCancelRef = React.MutableRefObject<(() => void) | null>;

type PreparedStartSpeech = {
  key: string;
  line: string;
  audioUrl: string;
};

type UseRaceCommentaryOptions = {
  preferences: RaceCommentaryPreferences;
  raceState: RaceState;
  startGateActive: boolean;
  trackName: string;
  raceLengthMeters: number;
  players: PlayerSlot[];
  riders: RiderState[];
  zones: TrackZone[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  onRecentLinesChange: (lines: string[]) => void;
};

function speechLanguage(voicePreset: RaceCommentaryVoicePreset) {
  if (voicePreset === 'american-man') {
    return 'en-US';
  }
  if (voicePreset === 'british-woman' || voicePreset === 'british-man') {
    return 'en-GB';
  }
  return 'en-AU';
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

function immediateRaceStartLine(trackName: string, players: PlayerSlot[]) {
  const names = players.map((player) => player.name).join(', ');
  return names
    ? `The gate is down at ${trackName}. ${names} are underway.`
    : `The gate is down at ${trackName}. We are racing.`;
}

function preparedStartSpeechKey(
  line: string,
  preferences: RaceCommentaryPreferences,
) {
  return `${preferences.voicePreset}:${line}`;
}

function speakWithBrowser(
  line: string,
  voicePreset: RaceCommentaryVoicePreset,
  volume: number,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
) {
  return new Promise<boolean>((resolve) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      resolve(false);
      return;
    }
    if (!shouldContinue()) {
      resolve(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    let settled = false;
    let timeout: number | null = null;
    const finish = (played: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout != null) {
        window.clearTimeout(timeout);
      }
      if (activePlaybackCancelRef.current === cancel) {
        activePlaybackCancelRef.current = null;
      }
      resolve(played);
    };
    const cancel = () => {
      window.speechSynthesis.cancel();
      finish(false);
    };
    timeout = window.setTimeout(
      () => finish(true),
      Math.min(6_500, Math.max(1_800, line.length * 55)),
    );
    utterance.lang = speechLanguage(voicePreset);
    utterance.voice = browserVoiceFor(voicePreset);
    utterance.volume = volume;
    utterance.rate = voicePreset === 'american-man'
      ? 1.08
      : voicePreset === 'british-woman' || voicePreset === 'british-man'
        ? 1.05
        : 1.04;
    utterance.pitch = voicePreset === 'australian-woman' || voicePreset === 'british-woman'
      ? 1.04
      : 0.9;
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    activePlaybackCancelRef.current = cancel;
    onStart();
    window.speechSynthesis.speak(utterance);
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  init.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', forwardAbort);
  }
}

async function requestAiSpeechUrl(
  line: string,
  preferences: RaceCommentaryPreferences,
  timeoutMs = 5_000,
  signal?: AbortSignal,
) {
  const response = await fetchWithTimeout('/api/commentary/speech', {
    method: 'POST',
    signal,
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      line,
      voicePreset: preferences.voicePreset,
    }),
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(`Speech service returned ${response.status}`);
  }

  return URL.createObjectURL(await response.blob());
}

async function playAudioUrl(
  audioUrl: string,
  volume: number,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
) {
  if (!shouldContinue()) {
    URL.revokeObjectURL(audioUrl);
    return false;
  }

  const audio = new Audio(audioUrl);
  activeAudioRef.current = audio;
  audio.volume = volume;
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const release = (played: boolean, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      URL.revokeObjectURL(audioUrl);
      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null;
      }
      if (activePlaybackCancelRef.current === cancel) {
        activePlaybackCancelRef.current = null;
      }
      if (error) {
        reject(error);
      } else {
        resolve(played);
      }
    };
    const cancel = () => {
      audio.pause();
      release(false);
    };
    audio.onended = () => {
      release(true);
    };
    audio.onerror = () => {
      release(false, new Error('AI speech audio could not be played.'));
    };
    activePlaybackCancelRef.current = cancel;
    onStart();
    void audio.play().catch((error) => {
      release(false, error);
    });
  });
}

async function playAiSpeech(
  line: string,
  preferences: RaceCommentaryPreferences,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
  signal?: AbortSignal,
) {
  const audioUrl = await requestAiSpeechUrl(line, preferences, 5_000, signal);
  return await playAudioUrl(
    audioUrl,
    preferences.volume,
    activeAudioRef,
    activePlaybackCancelRef,
    shouldContinue,
    onStart,
  );
}

export function useRaceCommentary({
  preferences,
  raceState,
  startGateActive,
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
  const trackerRef = useRef(createRaceCommentaryTracker());
  const preferencesRef = useRef(preferences);
  const recentLinesChangeRef = useRef(onRecentLinesChange);
  const queueRef = useRef<RaceCommentaryEvent[]>([]);
  const drainingRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const callSequenceRef = useRef(0);
  const playbackPhaseRef = useRef<CommentaryPlaybackPhase>('idle');
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activePlaybackCancelRef = useRef<(() => void) | null>(null);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const preparedStartSpeechRef = useRef<PreparedStartSpeech | null>(null);
  const startPrefetchRequestRef = useRef(0);

  preferencesRef.current = preferences;
  recentLinesChangeRef.current = onRecentLinesChange;
  const startLine = immediateRaceStartLine(trackName, players);

  const setPlaybackPhase = useCallback((phase: CommentaryPlaybackPhase) => {
    playbackPhaseRef.current = phase;
    setPlaybackStatus(phase === 'preparing' ? 'thinking' : phase);
  }, []);

  const disposePreparedStartSpeech = useCallback(() => {
    const prepared = preparedStartSpeechRef.current;
    preparedStartSpeechRef.current = null;
    if (prepared) {
      URL.revokeObjectURL(prepared.audioUrl);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    lifecycleGenerationRef.current += 1;
    callSequenceRef.current += 1;
    queueRef.current = [];
    activePlaybackCancelRef.current?.();
    activePlaybackCancelRef.current = null;
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setPlaybackPhase('idle');
  }, [setPlaybackPhase]);

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

  useEffect(() => {
    if (raceState === 'ready' && !startGateActive) {
      startPrefetchRequestRef.current += 1;
      disposePreparedStartSpeech();
      return;
    }
    if (
      raceState !== 'ready'
      || !startGateActive
      || !preferences.enabled
      || serviceMode !== 'ai'
    ) {
      return;
    }

    const key = preparedStartSpeechKey(startLine, preferences);
    if (preparedStartSpeechRef.current?.key === key) {
      return;
    }

    const requestId = startPrefetchRequestRef.current + 1;
    startPrefetchRequestRef.current = requestId;
    disposePreparedStartSpeech();
    void requestAiSpeechUrl(startLine, preferences)
      .then((audioUrl) => {
        if (startPrefetchRequestRef.current !== requestId) {
          URL.revokeObjectURL(audioUrl);
          return;
        }
        preparedStartSpeechRef.current = { key, line: startLine, audioUrl };
      })
      .catch(() => {
        // Gate calls use immediate browser speech when preloading is unavailable.
      });
  }, [
    disposePreparedStartSpeech,
    preferences,
    raceState,
    serviceMode,
    startGateActive,
    startLine,
  ]);

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
    const lifecycleGeneration = lifecycleGenerationRef.current;

    try {
      while (
        queueRef.current.length > 0
        && lifecycleGeneration === lifecycleGenerationRef.current
      ) {
        const event = queueRef.current.shift();
        if (!event || !preferencesRef.current.enabled || !raceCommentaryEventIsFresh(event)) {
          continue;
        }

        const callSequence = callSequenceRef.current;
        const activePreferences = preferencesRef.current;
        const shouldContinue = () => (
          lifecycleGeneration === lifecycleGenerationRef.current
          && callSequence === callSequenceRef.current
          && preferencesRef.current.enabled
          && raceCommentaryEventIsFresh(event)
        );
        let lineRemembered = false;
        const beginSpeaking = () => {
          if (!shouldContinue()) {
            return;
          }
          setPlaybackPhase('speaking');
          if (!lineRemembered) {
            rememberLine(line);
            lineRemembered = true;
          }
        };
        setPlaybackPhase('thinking');
        let line = '';
        let useAiSpeech = serviceMode === 'ai';

        if (event.kind === 'race-start') {
          line = startLine;
          const prepared = preparedStartSpeechRef.current;
          const preparedMatches = prepared?.key === preparedStartSpeechKey(line, activePreferences);
          if (preparedMatches && prepared) {
            preparedStartSpeechRef.current = null;
          }
          try {
            if (preparedMatches && prepared) {
              await playAudioUrl(
                prepared.audioUrl,
                activePreferences.volume,
                activeAudioRef,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
              );
            } else {
              await speakWithBrowser(
                line,
                activePreferences.voicePreset,
                activePreferences.volume,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
              );
            }
          } finally {
            setPlaybackPhase('idle');
          }
          continue;
        }

        if (event.kind === 'finish') {
          line = localCommentaryLine(
            event,
            activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
          );
          try {
            await speakWithBrowser(
              line,
              activePreferences.voicePreset,
              activePreferences.volume,
              activePlaybackCancelRef,
              shouldContinue,
              beginSpeaking,
            );
          } finally {
            queueRef.current = [];
            setPlaybackPhase('idle');
          }
          continue;
        }

        const requestController = new AbortController();
        activeRequestAbortRef.current = requestController;
        if (serviceMode === 'ai') {
          try {
            const response = await fetchWithTimeout('/api/commentary/line', {
              method: 'POST',
              signal: requestController.signal,
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
            if (!shouldContinue()) {
              continue;
            }
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
        if (!shouldContinue()) {
          continue;
        }

        setPlaybackPhase('preparing');
        try {
          if (useAiSpeech) {
            await playAiSpeech(
              line,
              activePreferences,
              activeAudioRef,
              activePlaybackCancelRef,
              shouldContinue,
              beginSpeaking,
              requestController.signal,
            );
          } else {
            await speakWithBrowser(
              line,
              activePreferences.voicePreset,
              activePreferences.volume,
              activePlaybackCancelRef,
              shouldContinue,
              beginSpeaking,
            );
          }
        } catch {
          if (shouldContinue()) {
            setServiceMode('browser');
            await speakWithBrowser(
              line,
              activePreferences.voicePreset,
              activePreferences.volume,
              activePlaybackCancelRef,
              shouldContinue,
              beginSpeaking,
            );
          }
        }
        if (activeRequestAbortRef.current === requestController) {
          activeRequestAbortRef.current = null;
        }
        setPlaybackPhase('idle');
      }
    } finally {
      drainingRef.current = false;
      if (lifecycleGeneration === lifecycleGenerationRef.current) {
        setPlaybackPhase('idle');
      }
    }
  }, [rememberLine, serviceMode, setPlaybackPhase, startLine]);

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
    if (raceState === 'finished') {
      stopPlayback();
      return;
    }
    if (events.length === 0) {
      return;
    }

    const nextEvent = selectLiveRaceCommentaryEvent(events);
    if (!nextEvent) {
      return;
    }

    callSequenceRef.current += 1;
    queueRef.current = [nextEvent];
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    if (nextEvent.kind === 'finish') {
      activePlaybackCancelRef.current?.();
      activePlaybackCancelRef.current = null;
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
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

  useEffect(() => () => {
    startPrefetchRequestRef.current += 1;
    disposePreparedStartSpeech();
    stopPlayback();
  }, [disposePreparedStartSpeech, stopPlayback]);

  const preview = useCallback(async () => {
    const activePreferences = preferencesRef.current;
    const line = activePreferences.voicePreset === 'american-man'
      ? 'TrackLab announcer ready. Riders, get set for the gate.'
      : 'TrackLab announcer ready. Riders, get set for the gate.';
    activeAudioRef.current?.pause();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    activePlaybackCancelRef.current?.();
    setPlaybackPhase('thinking');
    const beginSpeaking = () => setPlaybackPhase('speaking');
    try {
      if (serviceMode === 'ai') {
        await playAiSpeech(
          line,
          activePreferences,
          activeAudioRef,
          activePlaybackCancelRef,
          () => true,
          beginSpeaking,
        );
      } else {
        await speakWithBrowser(
          line,
          activePreferences.voicePreset,
          activePreferences.volume,
          activePlaybackCancelRef,
          () => true,
          beginSpeaking,
        );
      }
    } catch {
      setServiceMode('browser');
      await speakWithBrowser(
        line,
        activePreferences.voicePreset,
        activePreferences.volume,
        activePlaybackCancelRef,
        () => true,
        beginSpeaking,
      );
    } finally {
      setPlaybackPhase('idle');
    }
  }, [serviceMode, setPlaybackPhase]);

  return {
    playbackStatus,
    serviceMode,
    preview,
    stop: stopPlayback,
  };
}
