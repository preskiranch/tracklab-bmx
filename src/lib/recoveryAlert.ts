import {
  maximumAcceptedTrainingSpeedKph,
  maximumAcceptedWattbikeCadenceRpm,
} from './bikeSampleSanity';

export type RecoveryMode = 'off' | 'timer' | 'heart-rate' | 'smart';

export type RecoveryActivityType = 'bmx-race' | 'straight-sprint' | 'get-pulled';

export type RecoveryConfidence = 'fixed' | 'provisional' | 'personalized';

export type RecoveryEpisodeState = 'recovering' | 'ready' | 'fallback-timer' | 'cancelled';

export type RecoveryAlertPreference = Readonly<{
  mode: RecoveryMode;
  timerSeconds: number;
  targetBpm: number;
  minimumSeconds: number;
  maximumSeconds: number;
  updatedAt: number;
}>;

/** Aggregate effort facts only. Recovery learning never needs pedal or heart-rate samples. */
export type RecoveryEffortSummary = Readonly<{
  workDurationMs?: number;
  finishTimeMs?: number;
  averagePowerWatts?: number;
  peakPowerWatts?: number;
  peakCadenceRpm?: number;
  peakSpeedMps?: number;
}>;

/** One clean, summary-only target-recovery result used by the personal model. */
export type RecoveryLearningSummary = Readonly<{
  recoverySeconds: number;
  sampleCount: number;
  effortSummary: RecoveryEffortSummary;
}>;

export type RecoveryEpisode = Readonly<{
  id: string;
  activityType: RecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  mode: Exclude<RecoveryMode, 'off'>;
  state: RecoveryEpisodeState;
  startedAt: number;
  notBeforeAt: number;
  plannedReadyAt: number | null;
  fallbackAt: number;
  readyAt: number | null;
  targetBpm: number | null;
  reason: string;
  explanation: string;
  confidence: RecoveryConfidence;
  learningEpisodeCount: number;
  alertedAt: number | null;
  alertTrigger: 'target' | 'planned' | 'fallback' | 'manual' | null;
  updatedAt: number;
}>;

export type RecoveryAlertDirective = Readonly<{
  version: 1;
  accountId: string;
  /** Stable server revision used to reject delayed Watch relay directives. */
  issuedAt: number;
}> & RecoveryEpisode;

export const defaultRecoveryAlertPreference: RecoveryAlertPreference = Object.freeze({
  mode: 'off',
  timerSeconds: 300,
  targetBpm: 120,
  minimumSeconds: 60,
  maximumSeconds: 600,
  updatedAt: 0,
});

export const recoveryHeartRateSustainedSeconds = 12;
export const recoverySmartProvisionalEpisodeCount = 2;
export const recoverySmartPersonalizedEpisodeCount = 6;

const recoveryModes = new Set<RecoveryMode>(['off', 'timer', 'heart-rate', 'smart']);
const recoveryActivities = new Set<RecoveryActivityType>([
  'bmx-race',
  'straight-sprint',
  'get-pulled',
]);
const recoveryStates = new Set<RecoveryEpisodeState>([
  'recovering',
  'ready',
  'fallback-timer',
  'cancelled',
]);
const recoveryConfidences = new Set<RecoveryConfidence>(['fixed', 'provisional', 'personalized']);
const alertTriggers = new Set<NonNullable<RecoveryEpisode['alertTrigger']>>([
  'target',
  'planned',
  'fallback',
  'manual',
]);

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}

function timestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function identifier(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

export function normalizeRecoveryAlertPreference(
  value: unknown,
  fallback: RecoveryAlertPreference = defaultRecoveryAlertPreference,
): RecoveryAlertPreference {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = recoveryModes.has(item.mode as RecoveryMode) ? item.mode as RecoveryMode : fallback.mode;
  const timerSeconds = boundedInteger(item.timerSeconds, 30, 1_800, fallback.timerSeconds);
  const minimumSeconds = boundedInteger(item.minimumSeconds, 15, 600, fallback.minimumSeconds);
  const boundedMaximumSeconds = boundedInteger(
    item.maximumSeconds,
    Math.max(30, minimumSeconds),
    1_800,
    Math.max(fallback.maximumSeconds, minimumSeconds),
  );
  // Smart's visible fixed starting estimate must always fit inside its backup
  // deadline. Raise the backup instead of silently clamping the chosen start.
  const maximumSeconds = mode === 'smart'
    ? Math.max(boundedMaximumSeconds, timerSeconds)
    : boundedMaximumSeconds;
  return {
    mode,
    timerSeconds,
    targetBpm: boundedInteger(item.targetBpm, 40, 220, fallback.targetBpm),
    minimumSeconds,
    maximumSeconds,
    updatedAt: timestamp(item.updatedAt) ?? fallback.updatedAt,
  };
}

const effortBounds = Object.freeze({
  workDurationMs: [100, 30 * 60 * 1_000],
  finishTimeMs: [100, 30 * 60 * 1_000],
  averagePowerWatts: [0, 3_000],
  peakPowerWatts: [0, 5_000],
  peakCadenceRpm: [0, maximumAcceptedWattbikeCadenceRpm],
  peakSpeedMps: [0, maximumAcceptedTrainingSpeedKph / 3.6],
} as const);

/** Returns null when a supplied aggregate is malformed or outside strict physical bounds. */
export function normalizeRecoveryEffortSummary(value: unknown): RecoveryEffortSummary | null {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const supported = new Set(Object.keys(effortBounds));
  if (Object.keys(item).some((key) => !supported.has(key))) return null;
  const result: Record<string, number> = {};
  for (const [key, bounds] of Object.entries(effortBounds)) {
    const candidate = item[key];
    if (candidate == null) continue;
    const number = Number(candidate);
    if (!Number.isFinite(number) || number < bounds[0] || number > bounds[1]) return null;
    result[key] = Math.round(number * 100) / 100;
  }
  return result;
}

export function recoveryEffortScore(summary: RecoveryEffortSummary = {}) {
  const factors = [
    summary.averagePowerWatts == null ? null : summary.averagePowerWatts / 600,
    summary.peakPowerWatts == null ? null : summary.peakPowerWatts / 1_500,
    summary.peakCadenceRpm == null ? null : summary.peakCadenceRpm / 180,
    summary.peakSpeedMps == null ? null : summary.peakSpeedMps / 15,
    summary.workDurationMs == null ? null : summary.workDurationMs / 60_000,
    // Within one activity a faster finish is a modest proxy for greater load.
    // The final Smart adjustment remains capped to +/-20%.
    summary.finishTimeMs == null ? null : 15_000 / summary.finishTimeMs,
  ].filter((factor): factor is number => factor != null);
  if (factors.length === 0) return 1;
  return Math.max(0.5, Math.min(2, factors.reduce((sum, factor) => sum + factor, 0) / factors.length));
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type SmartRecoveryPlan = Readonly<{
  plannedSeconds: number;
  confidence: RecoveryConfidence;
  learningEpisodeCount: number;
  reason: 'smart-learning-fixed-fallback' | 'smart-personalized-estimate';
  explanation: string;
}>;

export function planSmartRecovery(
  preference: RecoveryAlertPreference,
  history: readonly RecoveryLearningSummary[],
  effortSummary: RecoveryEffortSummary = {},
): SmartRecoveryPlan {
  const maximumSeconds = Math.max(preference.maximumSeconds, preference.timerSeconds);
  const clean = history
    .filter((item) => (
      Number.isFinite(item.recoverySeconds)
      && item.recoverySeconds >= preference.minimumSeconds
      && item.recoverySeconds <= maximumSeconds
      && Number.isInteger(item.sampleCount)
      && item.sampleCount >= 3
    ))
    .slice(-12);
  if (clean.length < recoverySmartProvisionalEpisodeCount) {
    return {
      plannedSeconds: Math.max(
        preference.minimumSeconds,
        Math.min(maximumSeconds, preference.timerSeconds),
      ),
      confidence: 'fixed',
      learningEpisodeCount: clean.length,
      reason: 'smart-learning-fixed-fallback',
      explanation: clean.length === 0
        ? 'Learning your recovery pattern. Using your fixed recovery time for now.'
        : 'One clean recovery recorded. Using your fixed recovery time until there is enough history.',
    };
  }

  const base = median(clean.map((item) => item.recoverySeconds));
  const historicalEffort = median(clean.map((item) => recoveryEffortScore(item.effortSummary)));
  const currentEffort = recoveryEffortScore(effortSummary);
  const effortAdjustment = historicalEffort > 0
    ? Math.max(0.8, Math.min(1.2, currentEffort / historicalEffort))
    : 1;
  const plannedSeconds = Math.max(
    preference.minimumSeconds,
    Math.min(maximumSeconds, Math.round(base * effortAdjustment)),
  );
  const confidence: RecoveryConfidence = clean.length >= recoverySmartPersonalizedEpisodeCount
    ? 'personalized'
    : 'provisional';
  return {
    plannedSeconds,
    confidence,
    learningEpisodeCount: clean.length,
    reason: 'smart-personalized-estimate',
    explanation: confidence === 'personalized'
      ? `Based on ${clean.length} recent clean recoveries and this repetition’s effort.`
      : `Early estimate based on ${clean.length} clean recoveries; TrackLab is still learning.`,
  };
}

export function normalizeRecoveryEpisode(value: unknown): RecoveryEpisode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const sessionId = identifier(item.sessionId);
  const repetitionId = identifier(item.repetitionId);
  const activityType = recoveryActivities.has(item.activityType as RecoveryActivityType)
    ? item.activityType as RecoveryActivityType
    : null;
  const mode = item.mode !== 'off' && recoveryModes.has(item.mode as RecoveryMode)
    ? item.mode as Exclude<RecoveryMode, 'off'>
    : null;
  const state = recoveryStates.has(item.state as RecoveryEpisodeState)
    ? item.state as RecoveryEpisodeState
    : null;
  const confidence = recoveryConfidences.has(item.confidence as RecoveryConfidence)
    ? item.confidence as RecoveryConfidence
    : null;
  const startedAt = timestamp(item.startedAt);
  const notBeforeAt = timestamp(item.notBeforeAt);
  const plannedReadyAt = item.plannedReadyAt == null ? null : timestamp(item.plannedReadyAt);
  const fallbackAt = timestamp(item.fallbackAt);
  const readyAt = item.readyAt == null ? null : timestamp(item.readyAt);
  const targetBpm = item.targetBpm == null ? null : boundedInteger(item.targetBpm, 40, 220, -1);
  const updatedAt = timestamp(item.updatedAt);
  const alertedAt = item.alertedAt == null ? null : timestamp(item.alertedAt);
  const alertTrigger = item.alertTrigger == null
    ? null
    : alertTriggers.has(item.alertTrigger as NonNullable<RecoveryEpisode['alertTrigger']>)
      ? item.alertTrigger as NonNullable<RecoveryEpisode['alertTrigger']>
      : undefined;
  if (
    !id || !sessionId || !repetitionId || !activityType || !mode || !state || !confidence
    || startedAt == null || notBeforeAt == null || fallbackAt == null || updatedAt == null
    || notBeforeAt < startedAt || fallbackAt < notBeforeAt
    || (plannedReadyAt != null && (plannedReadyAt < notBeforeAt || plannedReadyAt > fallbackAt))
    || (readyAt != null && (readyAt < startedAt || readyAt > fallbackAt))
    || targetBpm === -1 || alertTrigger === undefined
  ) return null;
  return {
    id,
    activityType,
    sessionId,
    repetitionId,
    mode,
    state,
    startedAt,
    notBeforeAt,
    plannedReadyAt,
    fallbackAt,
    readyAt,
    targetBpm,
    reason: identifier(item.reason, 120) || 'recovery-in-progress',
    explanation: identifier(item.explanation, 500) || 'Recover, then start when you feel ready.',
    confidence,
    learningEpisodeCount: boundedInteger(item.learningEpisodeCount, 0, 10_000, 0),
    alertedAt,
    alertTrigger: alertTrigger ?? null,
    updatedAt,
  };
}

export function normalizeRecoveryAlertDirective(value: unknown): RecoveryAlertDirective | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const episode = normalizeRecoveryEpisode(item);
  const accountId = identifier(item.accountId, 96);
  const issuedAt = timestamp(item.issuedAt);
  return item.version === 1
    && /^recacct_[a-f0-9]{32}$/u.test(accountId)
    && issuedAt != null
    && episode
    ? { version: 1, accountId, issuedAt, ...episode }
    : null;
}
