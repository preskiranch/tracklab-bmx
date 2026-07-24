import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createRaceCommentaryTracker,
  detectRaceCommentaryEvents,
  localCommentaryLine,
  localRaceStartLine,
  raceCommentaryEventIsFresh,
  selectLiveRaceCommentaryEvent,
  type RaceCommentaryEvent,
  type RaceCommentaryEventKind,
} from '../lib/raceCommentary';
import {
  browserSpeechWatchdogMs,
  commentaryLineRequestBudgetMs,
  commentaryNeedsImmediateLine,
  enqueueFinishCommentaryEvents,
  finishCommentaryReleaseTimeoutMs,
  raceStateStopsCommentary,
  shouldInterruptCommentaryForEvent,
  type RaceCommentaryPlaybackPhase,
} from '../lib/raceCommentaryPlayback';
import {
  getTrackLabAudioContext,
  primeAudioCues,
} from '../lib/audioCues';
import {
  buildPreRaceTrackContext,
  localPreRaceReportLine,
  preRaceVariableCount,
  type PreRaceReport,
} from '../lib/preRaceReport';
import type {
  GhostLap,
  PlayerSlot,
  RaceCommentaryPreferences,
  RaceCommentaryVoicePreset,
  RaceState,
  ReactionTimesByPlayer,
  RiderState,
  TrackRecord,
  TrackZone,
} from '../types';

type CommentaryServiceMode = 'checking' | 'ai' | 'unavailable';
export type CommentarySpeechStatus = 'checking' | 'ready' | 'quota-exhausted' | 'unavailable';
type CommentaryPlaybackPhase = RaceCommentaryPlaybackPhase;
type CommentarySpeechEventKind = RaceCommentaryEventKind | 'pre-race' | 'preview';
type CommentaryDeliveryStyle = 'straight' | 'wry' | 'pressure' | 'surge' | 'sprint';
type ActivePlaybackCancelRef = React.MutableRefObject<(() => void) | null>;
const commentaryUnlockAudioDataUrl = 'data:audio/wav;base64,UklGRqQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type PreparedStartSpeech = {
  key: string;
  line: string;
  audioBlob: Blob;
};

type StartSpeechPrefetchAttempt = {
  inFlight: boolean;
  retryAt: number;
};

type PreparedPreRaceSpeech = {
  key: string;
  report: PreRaceReport;
  audioBlob?: Blob;
  audioPromise?: Promise<Blob | null>;
};

type PreparedRaceSpeech = {
  eventId: string;
  controller: AbortController;
  promise: Promise<{
    line: string;
    deliveryStyle: CommentaryDeliveryStyle;
    audioBlob: Blob;
  } | null>;
};

type UseRaceCommentaryOptions = {
  preferences: RaceCommentaryPreferences;
  raceState: RaceState;
  startGateActive: boolean;
  startGatePhase: 'idle' | 'staging' | 'cadence' | 'false-start' | 'go';
  track: TrackRecord;
  raceLengthMeters: number;
  players: PlayerSlot[];
  riders: RiderState[];
  zones: TrackZone[];
  ghostLaps: GhostLap[];
  lapCount: number;
  reactionTimesByPlayer: ReactionTimesByPlayer;
  onRecentLinesChange: (lines: string[]) => void;
};

function deliveryStyleForEvent(event: RaceCommentaryEvent): CommentaryDeliveryStyle {
  if (event.kind === 'lead-change' || event.kind === 'position-change') {
    return 'surge';
  }
  if (
    event.kind === 'race-start'
    || event.kind === 'final-push'
    || event.kind === 'rider-finish'
    || event.kind === 'finish'
  ) {
    return 'sprint';
  }
  if (event.sequence % 5 === 0) {
    return 'wry';
  }
  if (
    event.battleState === 'side-by-side'
    || event.battleState === 'under-pressure'
    || event.closeBattles.length > 0
  ) {
    return 'pressure';
  }
  return 'straight';
}

function preparedStartSpeechKey(
  line: string,
  preferences: RaceCommentaryPreferences,
  players: PlayerSlot[],
) {
  return `${preferences.voicePreset}:${players.map((player) => `${player.id}:${player.name}`).join('|')}:${line}`;
}

function preparedPreRaceSpeechKey(
  trackId: string,
  players: PlayerSlot[],
  ghostLaps: GhostLap[],
  lapCount: number,
  preferences: RaceCommentaryPreferences,
) {
  const riderKey = players.map((player) => `${player.id}:${player.name}`).join('|');
  const ghostKey = ghostLaps
    .map((ghost) => `${ghost.id}:${ghost.finishTimeMs}:${ghost.savedAt}`)
    .sort()
    .join('|');
  return [
    trackId,
    lapCount,
    riderKey,
    ghostKey,
    preferences.voicePreset,
  ].join('::');
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

async function requestAiSpeechBlob(
  line: string,
  preferences: RaceCommentaryPreferences,
  eventKind: CommentarySpeechEventKind,
  riderNames: string[],
  deliveryStyle: CommentaryDeliveryStyle = 'straight',
  timeoutMs = 12_000,
  signal?: AbortSignal,
) {
  const response = await fetchWithTimeout('/api/commentary/speech', {
    method: 'POST',
    signal,
    headers: {
      Accept: 'audio/wav',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      line,
      voicePreset: preferences.voicePreset,
      eventKind,
      riderNames,
      deliveryStyle,
    }),
  }, timeoutMs);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: string;
      code?: string;
    } | null;
    const error = new Error(payload?.error || `Speech service returned ${response.status}`) as Error & {
      code?: string;
    };
    error.code = payload?.code || 'speech_unavailable';
    throw error;
  }

  return await response.blob();
}

function commentarySpeechStatusFromError(error: unknown): CommentarySpeechStatus | null {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return null;
  }
  return (error as { code?: string } | null)?.code === 'insufficient_quota'
    ? 'quota-exhausted'
    : 'unavailable';
}

function commentarySpeechTimeoutMs(eventKind: CommentarySpeechEventKind) {
  if (eventKind === 'preview') {
    return 32_000;
  }
  if (eventKind === 'pre-race') {
    return 10_000;
  }
  if (eventKind === 'race-start') {
    return 15_000;
  }
  if (eventKind === 'lead-change' || eventKind === 'position-change') {
    return 5_000;
  }
  if (eventKind === 'finish' || eventKind === 'rider-finish') {
    return 12_000;
  }
  return 9_000;
}

async function waitForPreparedSpeech(
  promise: Promise<Blob | null>,
  timeoutMs: number,
) {
  let timeout: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) {
      window.clearTimeout(timeout);
    }
  }
}

async function playAudioBlobWithWebAudio(
  audioBlob: Blob,
  volume: number,
  activeBufferSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
  watchdogMs: number,
) {
  const context = getTrackLabAudioContext();
  if (!context) {
    return null;
  }

  if (context.state !== 'running' && context.state !== 'closed') {
    try {
      await context.resume();
    } catch {
      return null;
    }
  }
  if (context.state !== 'running') {
    return null;
  }

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await audioBlob.arrayBuffer());
  } catch {
    return null;
  }
  if (!shouldContinue()) {
    return false;
  }

  return await new Promise<boolean>((resolve, reject) => {
    const source = context.createBufferSource();
    const gain = context.createGain();
    let settled = false;
    let watchdogId: number | null = null;
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(context.destination);
    activeBufferSourceRef.current = source;

    const release = (played: boolean, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdogId != null) {
        window.clearTimeout(watchdogId);
      }
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      if (activeBufferSourceRef.current === source) {
        activeBufferSourceRef.current = null;
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
      try {
        source.stop();
      } catch {
        // The source may not have started or may already have ended.
      }
      release(false);
    };
    source.onended = () => release(true);
    activePlaybackCancelRef.current = cancel;
    try {
      source.start();
      onStart();
      watchdogId = window.setTimeout(cancel, watchdogMs);
    } catch (error) {
      release(false, error);
    }
  });
}

function commentaryAudioElement(
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
) {
  if (!audioRef.current) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audioRef.current = audio;
  }
  return audioRef.current;
}

async function playAudioBlobWithMediaElement(
  audioBlob: Blob,
  volume: number,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
  watchdogMs: number,
) {
  if (!shouldContinue()) {
    return false;
  }

  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = commentaryAudioElement(activeAudioRef);
  audio.src = audioUrl;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.muted = false;
  audio.volume = volume;
  audio.load();
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let watchdogId: number | null = null;
    const release = (played: boolean, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdogId != null) {
        window.clearTimeout(watchdogId);
      }
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(audioUrl);
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
    watchdogId = window.setTimeout(cancel, watchdogMs);
    void audio.play().catch((error) => {
      release(false, error);
    });
  });
}

async function playAudioBlob(
  audioBlob: Blob,
  volume: number,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  activeBufferSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
  watchdogMs: number,
) {
  const webAudioResult = await playAudioBlobWithWebAudio(
    audioBlob,
    volume,
    activeBufferSourceRef,
    activePlaybackCancelRef,
    shouldContinue,
    onStart,
    watchdogMs,
  );
  if (webAudioResult != null) {
    return webAudioResult;
  }

  return await playAudioBlobWithMediaElement(
    audioBlob,
    volume,
    activeAudioRef,
    activePlaybackCancelRef,
    shouldContinue,
    onStart,
    watchdogMs,
  );
}

async function playAiSpeech(
  line: string,
  preferences: RaceCommentaryPreferences,
  eventKind: CommentarySpeechEventKind,
  riderNames: string[],
  deliveryStyle: CommentaryDeliveryStyle,
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  activeBufferSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  activePlaybackCancelRef: ActivePlaybackCancelRef,
  shouldContinue: () => boolean,
  onStart: () => void,
  signal?: AbortSignal,
) {
  const audioBlob = await requestAiSpeechBlob(
    line,
    preferences,
    eventKind,
    riderNames,
    deliveryStyle,
    commentarySpeechTimeoutMs(eventKind),
    signal,
  );
  const played = await playAudioBlob(
    audioBlob,
    preferences.volume,
    activeAudioRef,
    activeBufferSourceRef,
    activePlaybackCancelRef,
    shouldContinue,
    onStart,
    browserSpeechWatchdogMs(line),
  );
  if (!played) {
    throw new Error('AI speech audio did not start.');
  }
  return true;
}

export function useRaceCommentary({
  preferences,
  raceState,
  startGateActive,
  startGatePhase,
  track,
  raceLengthMeters,
  players,
  riders,
  zones,
  ghostLaps,
  lapCount,
  reactionTimesByPlayer,
  onRecentLinesChange,
}: UseRaceCommentaryOptions) {
  const [serviceMode, setServiceMode] = useState<CommentaryServiceMode>('checking');
  const [speechStatus, setSpeechStatus] = useState<CommentarySpeechStatus>('checking');
  const [finishAnnouncementsComplete, setFinishAnnouncementsComplete] = useState(true);
  const trackerRef = useRef(createRaceCommentaryTracker());
  const preferencesRef = useRef(preferences);
  const recentLinesChangeRef = useRef(onRecentLinesChange);
  const raceLinesRef = useRef<string[]>([]);
  const queueRef = useRef<RaceCommentaryEvent[]>([]);
  const drainingRef = useRef(false);
  const activeFinishCallRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const callSequenceRef = useRef(0);
  const playbackPhaseRef = useRef<CommentaryPlaybackPhase>('idle');
  const previousRaceStateRef = useRef<RaceState>(raceState);
  const raceStateRef = useRef<RaceState>(raceState);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeBufferSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activePlaybackCancelRef = useRef<(() => void) | null>(null);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const preRacePlaybackAbortRef = useRef<AbortController | null>(null);
  const preparedStartSpeechRef = useRef<PreparedStartSpeech | null>(null);
  const preparedPreRaceSpeechRef = useRef<PreparedPreRaceSpeech | null>(null);
  const preparedRaceSpeechRef = useRef<PreparedRaceSpeech | null>(null);
  const playedPreRaceKeyRef = useRef('');
  const startPrefetchRequestRef = useRef(0);
  const startPrefetchAttemptRef = useRef<StartSpeechPrefetchAttempt>({
    inFlight: false,
    retryAt: 0,
  });
  const preRacePrefetchRequestRef = useRef(0);
  const [preRaceReport, setPreRaceReport] = useState<PreRaceReport | null>(null);

  preferencesRef.current = preferences;
  recentLinesChangeRef.current = onRecentLinesChange;
  raceStateRef.current = raceState;
  const trackName = track.name;
  const startLine = localRaceStartLine(
    trackName,
    players.map((player) => player.name),
    preferences.adaptiveMemory ? preferences.recentLines : [],
  );
  const preRaceContext = useMemo(
    () => buildPreRaceTrackContext(track, players, ghostLaps, lapCount),
    [ghostLaps, lapCount, players, track],
  );
  const preRaceKey = preparedPreRaceSpeechKey(
    track.id,
    players,
    ghostLaps,
    lapCount,
    preferences,
  );
  const startSpeechKey = preparedStartSpeechKey(startLine, preferences, players);

  const setPlaybackPhase = useCallback((phase: CommentaryPlaybackPhase) => {
    playbackPhaseRef.current = phase;
  }, []);

  const recordSpeechFailure = useCallback((error: unknown) => {
    const nextStatus = commentarySpeechStatusFromError(error);
    if (nextStatus) {
      setSpeechStatus(nextStatus);
    }
  }, []);

  const playNaturalSpeech = useCallback(async (
    ...args: Parameters<typeof playAiSpeech>
  ) => {
    try {
      const played = await playAiSpeech(...args);
      setSpeechStatus('ready');
      return played;
    } catch (error) {
      recordSpeechFailure(error);
      throw error;
    }
  }, [recordSpeechFailure]);

  const disposePreparedStartSpeech = useCallback(() => {
    preparedStartSpeechRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    lifecycleGenerationRef.current += 1;
    callSequenceRef.current += 1;
    queueRef.current = [];
    activeFinishCallRef.current = false;
    activePlaybackCancelRef.current?.();
    activePlaybackCancelRef.current = null;
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    preRacePlaybackAbortRef.current?.abort();
    preRacePlaybackAbortRef.current = null;
    preparedRaceSpeechRef.current?.controller.abort();
    preparedRaceSpeechRef.current = null;
    activeAudioRef.current?.pause();
    activeBufferSourceRef.current = null;
    setPlaybackPhase('idle');
  }, [setPlaybackPhase]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/commentary/config', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => response.ok
        ? await response.json() as { aiAvailable?: boolean; speechStatus?: string }
        : { aiAvailable: false, speechStatus: 'unavailable' })
      .then((config) => {
        if (!cancelled) {
          setServiceMode(config.aiAvailable ? 'ai' : 'unavailable');
          setSpeechStatus(
            config.speechStatus === 'ready'
              ? 'ready'
              : config.speechStatus === 'quota-exhausted'
                ? 'quota-exhausted'
                : config.aiAvailable
                  ? 'checking'
                  : 'unavailable',
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceMode('unavailable');
          setSpeechStatus('unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      raceState !== 'ready'
      || !preferences.enabled
      || serviceMode !== 'ai'
      || players.length === 0
    ) {
      return;
    }

    if (preparedStartSpeechRef.current?.key === startSpeechKey) {
      return;
    }
    const now = Date.now();
    if (
      startPrefetchAttemptRef.current.inFlight
      || startPrefetchAttemptRef.current.retryAt > now
    ) {
      return;
    }

    const requestId = startPrefetchRequestRef.current + 1;
    startPrefetchRequestRef.current = requestId;
    startPrefetchAttemptRef.current = {
      inFlight: true,
      retryAt: now + 15_000,
    };
    disposePreparedStartSpeech();
    void requestAiSpeechBlob(
      startLine,
      preferences,
      'race-start',
      players.map((player) => player.name),
      'sprint',
    )
      .then((audioBlob) => {
        setSpeechStatus('ready');
        if (startPrefetchRequestRef.current !== requestId) {
          return;
        }
        preparedStartSpeechRef.current = {
          key: startSpeechKey,
          line: startLine,
          audioBlob,
        };
        startPrefetchAttemptRef.current = {
          inFlight: false,
          retryAt: 0,
        };
      })
      .catch((error) => {
        recordSpeechFailure(error);
        if (startPrefetchRequestRef.current === requestId) {
          startPrefetchAttemptRef.current = {
            inFlight: false,
            retryAt: Date.now() + 60_000,
          };
        }
      });
  }, [
    disposePreparedStartSpeech,
    preferences.enabled,
    raceState,
    recordSpeechFailure,
    serviceMode,
    startSpeechKey,
  ]);

  useEffect(() => {
    if (raceState !== 'ready' || !preferences.enabled || players.length === 0) {
      preRacePrefetchRequestRef.current += 1;
      preparedPreRaceSpeechRef.current = null;
      setPreRaceReport(null);
      return;
    }
    if (preparedPreRaceSpeechRef.current?.key === preRaceKey) {
      setPreRaceReport(preparedPreRaceSpeechRef.current.report);
      return;
    }

    const requestId = preRacePrefetchRequestRef.current + 1;
    preRacePrefetchRequestRef.current = requestId;
    const controller = new AbortController();
    const localReport: PreRaceReport = {
      line: localPreRaceReportLine(
        preRaceContext,
        undefined,
        preferences.adaptiveMemory ? preferences.recentLines : [],
      ),
      source: 'local',
      generatedAt: new Date().toISOString(),
      variableCount: preRaceVariableCount(preRaceContext),
      supportedVariableCount: 73,
      sources: [
        ...(preRaceContext.sourceUrl ? [{
          title: preRaceContext.source || 'Track catalog source',
          url: preRaceContext.sourceUrl,
          kind: 'track' as const,
        }] : []),
        ...(preRaceContext.websiteUrl ? [{
          title: 'Official track website',
          url: preRaceContext.websiteUrl,
          kind: 'track' as const,
        }] : []),
      ],
      weather: { available: false },
    };

    void fetchWithTimeout('/api/commentary/pre-race', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        track: preRaceContext,
        voicePreset: preferences.voicePreset,
        recentLines: preferences.adaptiveMemory ? preferences.recentLines : [],
      }),
    }, 20_000)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Pre-race briefing returned ${response.status}`);
        }
        const payload = await response.json() as Partial<PreRaceReport>;
        const report: PreRaceReport = {
          line: typeof payload.line === 'string' && payload.line.trim()
            ? payload.line.trim()
            : localReport.line,
          source: payload.source === 'ai' ? 'ai' : 'local',
          generatedAt: typeof payload.generatedAt === 'string'
            ? payload.generatedAt
            : new Date().toISOString(),
          variableCount: Number.isFinite(Number(payload.variableCount))
            ? Number(payload.variableCount)
            : localReport.variableCount,
          supportedVariableCount: Number.isFinite(Number(payload.supportedVariableCount))
            ? Number(payload.supportedVariableCount)
            : localReport.supportedVariableCount,
          sources: Array.isArray(payload.sources)
            ? payload.sources
              .filter((source) => source?.title && source?.url)
              .slice(0, 12) as PreRaceReport['sources']
            : localReport.sources,
          weather: payload.weather?.available
            ? payload.weather
            : { available: false },
        };
        if (preRacePrefetchRequestRef.current !== requestId) {
          return;
        }
        setPreRaceReport(report);

        if (serviceMode !== 'ai') {
          preparedPreRaceSpeechRef.current = { key: preRaceKey, report };
          return;
        }
        const audioPromise = requestAiSpeechBlob(
          report.line,
          preferences,
          'pre-race',
          players.map((player) => player.name),
          'straight',
          commentarySpeechTimeoutMs('pre-race'),
          controller.signal,
        )
          .then((audioBlob) => {
            setSpeechStatus('ready');
            return audioBlob;
          })
          .catch((error) => {
            recordSpeechFailure(error);
            return null;
          });
        preparedPreRaceSpeechRef.current = {
          key: preRaceKey,
          report,
          audioPromise,
        };
        const audioBlob = await audioPromise;
        if (preRacePrefetchRequestRef.current === requestId && audioBlob) {
          preparedPreRaceSpeechRef.current = { key: preRaceKey, report, audioBlob };
        }
      })
      .catch(() => {
        if (preRacePrefetchRequestRef.current !== requestId) {
          return;
        }
        preparedPreRaceSpeechRef.current = { key: preRaceKey, report: localReport };
        setPreRaceReport(localReport);
      });
    return () => {
      controller.abort();
    };
  }, [
    preRaceKey,
    preferences.enabled,
    raceState,
    recordSpeechFailure,
    serviceMode,
  ]);

  const rememberLine = useCallback((line: string) => {
    raceLinesRef.current = [
      ...raceLinesRef.current.filter((item) => item !== line),
      line,
    ].slice(-24);
    const currentPreferences = preferencesRef.current;
    if (!currentPreferences.adaptiveMemory) {
      return;
    }
    const lines = [...currentPreferences.recentLines.filter((item) => item !== line), line].slice(-96);
    preferencesRef.current = { ...currentPreferences, recentLines: lines };
    recentLinesChangeRef.current(lines);
  }, []);

  const prepareRaceSpeech = useCallback((event: RaceCommentaryEvent) => {
    if (
      serviceMode !== 'ai'
      || event.kind === 'race-start'
      || event.kind === 'finish'
      || event.kind === 'rider-finish'
    ) {
      return null;
    }
    const existing = preparedRaceSpeechRef.current;
    if (existing?.eventId === event.id) {
      return existing;
    }
    existing?.controller.abort();

    const controller = new AbortController();
    const activePreferences = preferencesRef.current;
    const recentLines = activePreferences.adaptiveMemory
      ? activePreferences.recentLines
      : [];
    const raceLines = [...raceLinesRef.current];
    const initialDeliveryStyle = deliveryStyleForEvent(event);
    const promise = (async () => {
      let line = '';
      let deliveryStyle = initialDeliveryStyle;
      const lineRequestBudgetMs = commentaryLineRequestBudgetMs(event.kind);
      if (!commentaryNeedsImmediateLine(event.kind) && lineRequestBudgetMs > 0) {
        try {
          const response = await fetchWithTimeout('/api/commentary/line', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              event,
              voicePreset: activePreferences.voicePreset,
              recentLines,
              raceLines,
            }),
          }, lineRequestBudgetMs);
          if (!response.ok) {
            throw new Error(`Commentary service returned ${response.status}`);
          }
          const payload = await response.json() as {
            line?: string;
            deliveryStyle?: CommentaryDeliveryStyle;
          };
          line = typeof payload.line === 'string' ? payload.line.trim() : '';
          deliveryStyle = ['straight', 'wry', 'pressure', 'surge', 'sprint']
            .includes(payload.deliveryStyle ?? '')
            ? payload.deliveryStyle as CommentaryDeliveryStyle
            : initialDeliveryStyle;
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
        }
      }
      if (!line) {
        line = localCommentaryLine(event, recentLines, raceLines);
      }
      const audioBlob = await requestAiSpeechBlob(
        line,
        activePreferences,
        event.kind,
        event.riders.map((rider) => rider.name),
        deliveryStyle,
        commentarySpeechTimeoutMs(event.kind),
        controller.signal,
      );
      setSpeechStatus('ready');
      return { line, deliveryStyle, audioBlob };
    })()
      .catch((error) => {
        recordSpeechFailure(error);
        return null;
      });
    const prepared = { eventId: event.id, controller, promise };
    preparedRaceSpeechRef.current = prepared;
    return prepared;
  }, [recordSpeechFailure, serviceMode]);

  useEffect(() => {
    if (
      !preferences.enabled
      || !startGateActive
      || startGatePhase !== 'staging'
      || playedPreRaceKeyRef.current === preRaceKey
    ) {
      return;
    }
    playedPreRaceKeyRef.current = preRaceKey;
    const prepared = preparedPreRaceSpeechRef.current?.key === preRaceKey
      ? preparedPreRaceSpeechRef.current
      : null;
    const report = prepared?.report ?? {
      line: localPreRaceReportLine(
        preRaceContext,
        undefined,
        preferences.adaptiveMemory ? preferences.recentLines : [],
      ),
      source: 'local' as const,
      generatedAt: new Date().toISOString(),
      variableCount: preRaceVariableCount(preRaceContext),
      supportedVariableCount: 73,
      sources: [],
      weather: { available: false },
    };
    const controller = new AbortController();
    preRacePlaybackAbortRef.current = controller;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    const shouldContinue = () => (
      !controller.signal.aborted
      && lifecycleGeneration === lifecycleGenerationRef.current
      && preferencesRef.current.enabled
    );
    const beginSpeaking = () => {
      if (shouldContinue()) {
        rememberLine(report.line);
        setPlaybackPhase('speaking');
      }
    };
    const activePreferences = preferencesRef.current;
    const riderNames = preRaceContext.riders.map((rider) => rider.name);
    setPlaybackPhase(prepared?.audioBlob || prepared?.audioPromise ? 'preparing' : 'thinking');
    void (async () => {
      try {
        const audioBlob = prepared?.audioBlob
          ?? (prepared?.audioPromise
            ? await waitForPreparedSpeech(prepared.audioPromise, 4_500)
            : null);
        if (audioBlob) {
          const played = await playAudioBlob(
            audioBlob,
            activePreferences.volume,
            activeAudioRef,
            activeBufferSourceRef,
            activePlaybackCancelRef,
            shouldContinue,
            beginSpeaking,
            browserSpeechWatchdogMs(report.line),
          );
          if (!played) {
            throw new Error('Prepared pre-race speech did not start.');
          }
          return;
        }
        if (serviceMode === 'ai') {
          await playNaturalSpeech(
            report.line,
            activePreferences,
            'pre-race',
            riderNames,
            'straight',
            activeAudioRef,
            activeBufferSourceRef,
            activePlaybackCancelRef,
            shouldContinue,
            beginSpeaking,
            controller.signal,
          );
          return;
        }
      } catch (error) {
        if (serviceMode === 'ai') {
          console.warn('Natural commentary pre-race audio could not play.', error);
        }
      }
    })()
      .finally(() => {
        if (preRacePlaybackAbortRef.current === controller) {
          preRacePlaybackAbortRef.current = null;
        }
        if (shouldContinue()) {
          setPlaybackPhase('idle');
        }
      });
    return () => {
      controller.abort();
      activePlaybackCancelRef.current?.();
      activePlaybackCancelRef.current = null;
      activeAudioRef.current?.pause();
      activeBufferSourceRef.current = null;
      setPlaybackPhase('idle');
    };
  }, [
    preRaceContext,
    preRaceKey,
    preferences.enabled,
    preferences.voicePreset,
    preferences.volume,
    playNaturalSpeech,
    rememberLine,
    serviceMode,
    setPlaybackPhase,
    startGateActive,
    startGatePhase,
  ]);

  useEffect(() => {
    if (!startGateActive && startGatePhase === 'idle') {
      playedPreRaceKeyRef.current = '';
    }
  }, [startGateActive, startGatePhase]);

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

        callSequenceRef.current += 1;
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
        const useAiSpeech = serviceMode === 'ai';
        let deliveryStyle: CommentaryDeliveryStyle = deliveryStyleForEvent(event);

        if (event.kind === 'race-start') {
          line = startLine;
          const prepared = preparedStartSpeechRef.current;
          const preparedMatches = prepared?.key === preparedStartSpeechKey(line, activePreferences, players);
          if (preparedMatches && prepared) {
            preparedStartSpeechRef.current = null;
          }
          const requestController = new AbortController();
          activeRequestAbortRef.current = requestController;
          try {
            if (preparedMatches && prepared) {
              const played = await playAudioBlob(
                prepared.audioBlob,
                activePreferences.volume,
                activeAudioRef,
                activeBufferSourceRef,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
                browserSpeechWatchdogMs(line),
              );
              if (!played) {
                throw new Error('Prepared race-start speech did not start.');
              }
            } else if (serviceMode === 'ai') {
              await playNaturalSpeech(
                line,
                activePreferences,
                event.kind,
                event.riders.map((rider) => rider.name),
                'sprint',
                activeAudioRef,
                activeBufferSourceRef,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
                requestController.signal,
              );
            }
          } catch (error) {
            if (serviceMode === 'ai') {
              console.warn('Natural commentary race-start audio could not play.', error);
            }
          } finally {
            if (activeRequestAbortRef.current === requestController) {
              activeRequestAbortRef.current = null;
            }
            setPlaybackPhase('idle');
          }
          continue;
        }

        if (event.kind === 'finish' || event.kind === 'rider-finish') {
          activeFinishCallRef.current = true;
          line = localCommentaryLine(
            event,
            activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
            raceLinesRef.current,
          );
          const requestController = new AbortController();
          activeRequestAbortRef.current = requestController;
          try {
            if (serviceMode === 'ai') {
              await playNaturalSpeech(
                line,
                activePreferences,
                event.kind,
                event.riders.map((rider) => rider.name),
                'sprint',
                activeAudioRef,
                activeBufferSourceRef,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
                requestController.signal,
              );
            }
          } catch (error) {
            if (serviceMode === 'ai') {
              console.warn('Natural commentary finish audio could not play.', error);
            }
          } finally {
            activeFinishCallRef.current = false;
            if (activeRequestAbortRef.current === requestController) {
              activeRequestAbortRef.current = null;
            }
            setPlaybackPhase('idle');
          }
          continue;
        }

        const preparedRaceSpeech = preparedRaceSpeechRef.current?.eventId === event.id
          ? preparedRaceSpeechRef.current
          : prepareRaceSpeech(event);
        if (preparedRaceSpeechRef.current?.eventId === event.id) {
          preparedRaceSpeechRef.current = null;
        }
        if (preparedRaceSpeech && useAiSpeech) {
          activeRequestAbortRef.current = preparedRaceSpeech.controller;
          setPlaybackPhase('preparing');
          try {
            const prepared = await preparedRaceSpeech.promise;
            if (prepared && shouldContinue()) {
              line = prepared.line;
              deliveryStyle = prepared.deliveryStyle;
              const played = await playAudioBlob(
                prepared.audioBlob,
                activePreferences.volume,
                activeAudioRef,
                activeBufferSourceRef,
                activePlaybackCancelRef,
                shouldContinue,
                beginSpeaking,
                browserSpeechWatchdogMs(line),
              );
              if (!played && shouldContinue()) {
                throw new Error('Buffered race commentary audio did not start.');
              }
            }
          } catch (error) {
            if (shouldContinue()) {
              console.warn('Buffered natural commentary audio could not play.', error);
            }
          } finally {
            if (activeRequestAbortRef.current === preparedRaceSpeech.controller) {
              activeRequestAbortRef.current = null;
            }
            setPlaybackPhase('idle');
          }
          continue;
        }

        const requestController = new AbortController();
        activeRequestAbortRef.current = requestController;
        const lineRequestBudgetMs = commentaryLineRequestBudgetMs(event.kind);
        if (
          serviceMode === 'ai'
          && !commentaryNeedsImmediateLine(event.kind)
          && lineRequestBudgetMs > 0
        ) {
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
                voicePreset: activePreferences.voicePreset,
                recentLines: activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
                raceLines: raceLinesRef.current,
              }),
            }, lineRequestBudgetMs);
            if (!response.ok) {
              throw new Error(`Commentary service returned ${response.status}`);
            }
            const payload = await response.json() as {
              line?: string;
              deliveryStyle?: CommentaryDeliveryStyle;
            };
            line = typeof payload.line === 'string' ? payload.line.trim() : '';
            deliveryStyle = ['straight', 'wry', 'pressure', 'surge', 'sprint']
              .includes(payload.deliveryStyle ?? '')
              ? payload.deliveryStyle as CommentaryDeliveryStyle
              : deliveryStyleForEvent(event);
            if (!line) {
              throw new Error('Commentary service returned an empty call.');
            }
          } catch {
            if (!shouldContinue()) {
              continue;
            }
          }
        }

        if (!line) {
          line = localCommentaryLine(
            event,
            activePreferences.adaptiveMemory ? activePreferences.recentLines : [],
            raceLinesRef.current,
          );
        }
        if (!shouldContinue()) {
          continue;
        }

        setPlaybackPhase('preparing');
        try {
          if (useAiSpeech) {
            await playNaturalSpeech(
              line,
              activePreferences,
              event.kind,
              event.riders.map((rider) => rider.name),
              deliveryStyle,
              activeAudioRef,
              activeBufferSourceRef,
              activePlaybackCancelRef,
              shouldContinue,
              beginSpeaking,
              requestController.signal,
            );
          }
        } catch (error) {
          if (useAiSpeech) {
            console.warn('Natural commentary race audio could not play.', error);
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
        const hasQueuedFinishCall = queueRef.current.some((event) => (
          event.kind === 'finish' || event.kind === 'rider-finish'
        ));
        if (
          raceStateRef.current === 'finished'
          && !activeFinishCallRef.current
          && !hasQueuedFinishCall
        ) {
          setFinishAnnouncementsComplete(true);
        }
      }
    }
  }, [
    playNaturalSpeech,
    players,
    prepareRaceSpeech,
    rememberLine,
    serviceMode,
    setPlaybackPhase,
    startLine,
  ]);

  useEffect(() => {
    const previousRaceState = previousRaceStateRef.current;
    previousRaceStateRef.current = raceState;
    if (raceState === 'racing' && previousRaceState !== 'racing') {
      raceLinesRef.current = [];
      setFinishAnnouncementsComplete(true);
    }
    if (!preferences.enabled) {
      raceLinesRef.current = [];
      setFinishAnnouncementsComplete(true);
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
    if (raceStateStopsCommentary(raceState)) {
      raceLinesRef.current = [];
      queueRef.current = [];
      setFinishAnnouncementsComplete(true);
      trackerRef.current = createRaceCommentaryTracker();
      if (previousRaceState !== 'ready' && !startGateActive) {
        stopPlayback();
      }
      return;
    }
    if (events.length === 0) {
      const hasQueuedFinishCall = queueRef.current.some((event) => (
        event.kind === 'finish' || event.kind === 'rider-finish'
      ));
      if (
        raceState === 'finished'
        && !activeFinishCallRef.current
        && !hasQueuedFinishCall
      ) {
        setFinishAnnouncementsComplete(true);
      }
      return;
    }

    const finishEvents = events.filter((event) => (
      event.kind === 'finish' || event.kind === 'rider-finish'
    ));
    const nextEvent = finishEvents[0] ?? selectLiveRaceCommentaryEvent(events);
    if (!nextEvent) {
      return;
    }

    if (finishEvents.length > 0) {
      setFinishAnnouncementsComplete(false);
      preparedRaceSpeechRef.current?.controller.abort();
      preparedRaceSpeechRef.current = null;
      queueRef.current = enqueueFinishCommentaryEvents(queueRef.current, finishEvents);
    } else if (
      !activeFinishCallRef.current
      && !queueRef.current.some((event) => (
        event.kind === 'finish' || event.kind === 'rider-finish'
      ))
    ) {
      queueRef.current = [nextEvent];
      prepareRaceSpeech(nextEvent);
    }
    if (
      !activeFinishCallRef.current
      && shouldInterruptCommentaryForEvent(playbackPhaseRef.current, nextEvent.kind)
    ) {
      callSequenceRef.current += 1;
      activeRequestAbortRef.current?.abort();
      activeRequestAbortRef.current = null;
      activePlaybackCancelRef.current?.();
      activePlaybackCancelRef.current = null;
      activeAudioRef.current?.pause();
      activeBufferSourceRef.current = null;
    }
    void drainQueue();
  }, [
    drainQueue,
    players,
    prepareRaceSpeech,
    preferences.enabled,
    raceLengthMeters,
    raceState,
    reactionTimesByPlayer,
    riders,
    startGateActive,
    stopPlayback,
    trackName,
    zones,
  ]);

  useEffect(() => {
    if (raceState !== 'finished' || finishAnnouncementsComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      stopPlayback();
      setFinishAnnouncementsComplete(true);
    }, finishCommentaryReleaseTimeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [finishAnnouncementsComplete, raceState, stopPlayback]);

  useEffect(() => () => {
    startPrefetchRequestRef.current += 1;
    preRacePrefetchRequestRef.current += 1;
    disposePreparedStartSpeech();
    preparedPreRaceSpeechRef.current = null;
    stopPlayback();
  }, [disposePreparedStartSpeech, stopPlayback]);

  const primeCommentaryPlayback = useCallback(() => {
    const context = getTrackLabAudioContext();
    const contextPrime = context && context.state !== 'closed'
      ? context.resume().catch(() => undefined)
      : Promise.resolve();
    const audio = commentaryAudioElement(activeAudioRef);
    audio.pause();
    audio.src = commentaryUnlockAudioDataUrl;
    audio.preload = 'auto';
    audio.muted = false;
    audio.volume = 0.01;
    audio.load();
    const mediaPrime = audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => undefined);
    return Promise.race([
      Promise.allSettled([contextPrime, mediaPrime]).then(() => undefined),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 800);
      }),
    ]);
  }, []);

  const prime = useCallback(() => Promise.race([
    Promise.allSettled([primeAudioCues(), primeCommentaryPlayback()]).then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1_500);
    }),
  ]), [primeCommentaryPlayback]);

  return {
    finishAnnouncementsComplete,
    speechStatus,
    prime,
    stop: stopPlayback,
  };
}
