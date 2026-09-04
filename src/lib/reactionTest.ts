import {
  uciRandomDelayMaxMs,
  uciRandomDelayMinMs,
  uciStartToneIntervalMs,
} from './uciStartGate';
import { uciVoiceWatchGateOffsetMs } from './audioCues';

/** The semantic stages shown to a rider on the four-light Reaction Test tree. */
export type ReactionTestStage = 'idle' | 'red' | 'yellow-1' | 'yellow-2' | 'green';
export type ReactionTestRating = 'excellent' | 'great' | 'okay' | 'late' | 'false-start';
export type ReactionTestTone = 'uci-red' | 'uci-green';

export type ReactionTestCadenceCue = Readonly<{
  stage: Exclude<ReactionTestStage, 'idle'>;
  /** Target timestamp on the monotonic clock that began the UCI voice file. */
  at: number;
  tone: ReactionTestTone;
  startsTimer: boolean;
  releasesGate: boolean;
}>;

export type ReactionTestCadencePlan = Readonly<{
  /** The random UCI hold between the existing voice cue and first light. */
  cadenceDelayMs: number;
  voiceStartedAt: number;
  firstRedAt: number;
  greenAt: number;
  cues: readonly ReactionTestCadenceCue[];
}>;

export type ReactionTestCueEvent = ReactionTestCadenceCue & Readonly<{
  /** One logical timestamp shared by the light, tone, timer, and gate action. */
  firedAt: number;
}>;

export type ReactionTestResult = Readonly<{
  id: string;
  /** Monotonic timestamps power scoring; epoch timestamps are only for history. */
  startedAt: number | null;
  startedAtEpoch: number | null;
  recordedAt: number;
  recordedAtEpoch: number;
  reactionTimeMs: number | null;
  rating: ReactionTestRating;
  stage: ReactionTestStage | 'too-early';
  cadenceDelayMs: number | null;
  valid: boolean;
  late: boolean;
  falseStart: boolean;
}>;

/**
 * Uses the same random-hold range as TrackLab's existing UCI start gate.
 * The value is generated only once per attempt and becomes the authority for
 * every visual and audio cue in that attempt.
 */
export function createReactionTestCadenceDelay(random = Math.random) {
  const range = uciRandomDelayMaxMs - uciRandomDelayMinMs + 1;
  return uciRandomDelayMinMs + Math.floor(Math.max(0, Math.min(0.999999999, random())) * range);
}

/**
 * Builds the four visible reaction cues from existing UCI constants. The
 * voice offset and random hold are authoritative; rendering does not supply
 * any timing data to this plan.
 */
export function createReactionTestCadencePlan(
  voiceStartedAt: number,
  cadenceDelayMs: number,
): ReactionTestCadencePlan {
  if (!Number.isFinite(voiceStartedAt)) {
    throw new TypeError('voiceStartedAt must be a finite monotonic timestamp.');
  }
  if (!Number.isFinite(cadenceDelayMs)) {
    throw new TypeError('cadenceDelayMs must be finite.');
  }

  const normalizedDelay = Math.max(
    uciRandomDelayMinMs,
    Math.min(uciRandomDelayMaxMs, Math.round(cadenceDelayMs)),
  );
  const firstRedAt = voiceStartedAt + uciVoiceWatchGateOffsetMs + normalizedDelay;
  const cues = Object.freeze([
    Object.freeze({
      stage: 'red' as const,
      at: firstRedAt,
      tone: 'uci-red' as const,
      startsTimer: true,
      releasesGate: false,
    }),
    Object.freeze({
      stage: 'yellow-1' as const,
      at: firstRedAt + uciStartToneIntervalMs,
      tone: 'uci-red' as const,
      startsTimer: false,
      releasesGate: false,
    }),
    Object.freeze({
      stage: 'yellow-2' as const,
      at: firstRedAt + (uciStartToneIntervalMs * 2),
      tone: 'uci-red' as const,
      startsTimer: false,
      releasesGate: false,
    }),
    Object.freeze({
      stage: 'green' as const,
      at: firstRedAt + (uciStartToneIntervalMs * 3),
      tone: 'uci-green' as const,
      startsTimer: false,
      releasesGate: true,
    }),
  ]);

  return Object.freeze({
    cadenceDelayMs: normalizedDelay,
    voiceStartedAt,
    firstRedAt,
    greenAt: cues[3].at,
    cues,
  });
}

/**
 * Captures one logical event timestamp before any visual updates or audio
 * calls. The React view consumes this same object for every synchronous action
 * in a cue, keeping the authoritative clock separate from CSS animation.
 */
export function fireReactionTestCue(
  cue: ReactionTestCadenceCue,
  now: () => number,
): ReactionTestCueEvent {
  return Object.freeze({ ...cue, firedAt: now() });
}

export function reactionRatingForStage(stage: ReactionTestStage): ReactionTestRating | null {
  if (stage === 'red') return 'excellent';
  if (stage === 'yellow-1') return 'great';
  if (stage === 'yellow-2') return 'okay';
  if (stage === 'green') return 'late';
  return null;
}

/** Round milliseconds to the hundredths-of-a-second value displayed to riders. */
export function formatReactionTime(reactionTimeMs: number | null) {
  if (reactionTimeMs == null || !Number.isFinite(reactionTimeMs)) return '--.--';
  return (Math.max(0, reactionTimeMs) / 1_000).toFixed(2);
}

export function createReactionTestResult(input: {
  id: string;
  timerStartedAt: number | null;
  timerStartedAtEpoch: number | null;
  recordedAt: number;
  recordedAtEpoch: number;
  stage: ReactionTestStage | 'too-early';
  cadenceDelayMs: number | null;
}) : ReactionTestResult {
  const {
    id,
    timerStartedAt,
    timerStartedAtEpoch,
    recordedAt,
    recordedAtEpoch,
    stage,
    cadenceDelayMs,
  } = input;
  const rating = stage === 'too-early'
    ? 'false-start'
    : reactionRatingForStage(stage) ?? 'false-start';
  const valid = timerStartedAt != null && stage !== 'idle' && stage !== 'too-early';

  return Object.freeze({
    id,
    startedAt: timerStartedAt,
    startedAtEpoch: timerStartedAtEpoch,
    recordedAt,
    recordedAtEpoch,
    reactionTimeMs: valid ? Math.max(0, recordedAt - timerStartedAt) : null,
    rating,
    stage,
    cadenceDelayMs,
    valid,
    late: valid && stage === 'green',
    falseStart: !valid,
  });
}
