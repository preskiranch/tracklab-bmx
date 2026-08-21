import type {
  HeartRateMeasurement,
  PrivateHeartRateSample,
  PrivateHeartRateSummary,
  PrivateHeartRateZoneSummary,
} from '../types';

export const minimumHeartRateBpm = 20;
export const maximumHeartRateBpm = 260;
export const defaultHeartRateFreshnessMs = 10_000;
export const defaultHeartRateCoverageGapMs = 10_000;

export type HeartRateActiveClockSegment = Readonly<{
  /** Unix time in milliseconds when this uninterrupted active segment began. */
  startedAt: number;
  /** Unix time in milliseconds when it paused or ended. Null means active now. */
  endedAt: number | null;
  /** Active-session elapsed time at startedAt. */
  activeElapsedAtStartMs: number;
}>;

export type HeartRateSummaryWindow = Readonly<{
  startElapsedMs: number;
  endElapsedMs: number;
  maximumGapMs?: number;
}>;

export type HeartRateZoneWindow = Readonly<{
  zoneId: string;
  zoneName?: string;
  startElapsedMs: number;
  endElapsedMs: number;
}>;

type RawHeartRateMeasurement = Partial<HeartRateMeasurement> & {
  measuredAt?: unknown;
  recordedAt?: unknown;
  receivedAt?: unknown;
};

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value: unknown) {
  const number = finiteNumber(value);
  if (number == null || number < 0 || !Number.isSafeInteger(number)) return null;
  return number;
}

function normalizedSessionId(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string') return undefined;
  const sessionId = value.trim();
  return sessionId && sessionId.length <= 160 ? sessionId : undefined;
}

/**
 * Accepts both the native `measuredAt` name and the cloud `recordedAt` name,
 * always preserving sensor time instead of substituting network-delivery time.
 */
export function normalizeHeartRateMeasurement(
  value: unknown,
  fallbackReceivedAt = Date.now(),
): HeartRateMeasurement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as RawHeartRateMeasurement;
  const bpm = finiteNumber(candidate.bpm);
  const sequence = nonNegativeInteger(candidate.sequence);
  const recordedAt = finiteNumber(candidate.recordedAt ?? candidate.measuredAt);
  const receivedAt = finiteNumber(candidate.receivedAt) ?? finiteNumber(fallbackReceivedAt);
  const sessionId = normalizedSessionId(candidate.sessionId);

  if (
    candidate.source !== 'apple-watch'
    || bpm == null
    || bpm < minimumHeartRateBpm
    || bpm > maximumHeartRateBpm
    || sequence == null
    || recordedAt == null
    || recordedAt < 0
    || receivedAt == null
    || receivedAt < 0
    || sessionId === undefined
  ) {
    return null;
  }

  return {
    source: 'apple-watch',
    sessionId,
    sequence,
    bpm: Math.round(bpm * 10) / 10,
    recordedAt: Math.round(recordedAt),
    receivedAt: Math.round(receivedAt),
  };
}

function heartRateSequenceKey(sample: HeartRateMeasurement) {
  return `${sample.source}:${sample.sessionId ?? 'unassigned'}:${sample.sequence}`;
}

function heartRateTimestampKey(sample: HeartRateMeasurement) {
  return `${sample.source}:${sample.sessionId ?? 'unassigned'}:${sample.recordedAt}`;
}

/**
 * The first valid payload for a session/sequence or sensor timestamp wins. A
 * retried native/network delivery cannot rewrite or recount the same health
 * sample even if a restarted outbox assigns it a different sequence.
 */
export function dedupeHeartRateMeasurements(
  samples: readonly HeartRateMeasurement[],
): HeartRateMeasurement[] {
  const bySequence = new Map<string, HeartRateMeasurement>();
  const recordedTimestamps = new Set<string>();
  for (const sample of samples) {
    const normalized = normalizeHeartRateMeasurement(sample, sample.receivedAt);
    if (!normalized) continue;
    const sequenceKey = heartRateSequenceKey(normalized);
    const timestampKey = heartRateTimestampKey(normalized);
    if (bySequence.has(sequenceKey) || recordedTimestamps.has(timestampKey)) continue;
    bySequence.set(sequenceKey, normalized);
    recordedTimestamps.add(timestampKey);
  }
  return [...bySequence.values()].sort((left, right) => (
    left.recordedAt - right.recordedAt || left.sequence - right.sequence
  ));
}

export function mergeHeartRateMeasurement(
  samples: readonly HeartRateMeasurement[],
  next: HeartRateMeasurement,
  maximumSamples = 12_000,
) {
  const boundedMaximum = Number.isFinite(maximumSamples)
    ? Math.max(1, Math.round(maximumSamples))
    : 12_000;
  const merged = dedupeHeartRateMeasurements([...samples, next]);
  return merged.length <= boundedMaximum ? merged : merged.slice(-boundedMaximum);
}

function validClockSegments(segments: readonly HeartRateActiveClockSegment[]) {
  return segments
    .flatMap((segment) => {
      const startedAt = finiteNumber(segment.startedAt);
      const endedAt = segment.endedAt == null ? null : finiteNumber(segment.endedAt);
      const activeElapsedAtStartMs = finiteNumber(segment.activeElapsedAtStartMs);
      if (
        startedAt == null
        || startedAt < 0
        || activeElapsedAtStartMs == null
        || activeElapsedAtStartMs < 0
        || (endedAt != null && endedAt < startedAt)
      ) {
        return [];
      }
      return [{ startedAt, endedAt, activeElapsedAtStartMs }];
    })
    .sort((left, right) => left.startedAt - right.startedAt);
}

/** Maps a sensor timestamp onto a pause-aware active-session clock. */
export function activeElapsedMsAt(
  recordedAt: number,
  segments: readonly HeartRateActiveClockSegment[],
): number | null {
  if (!Number.isFinite(recordedAt)) return null;
  const candidates = validClockSegments(segments);
  let segment: (typeof candidates)[number] | undefined;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (
      recordedAt >= candidate.startedAt
      && (candidate.endedAt == null || recordedAt < candidate.endedAt)
    ) {
      segment = candidate;
      break;
    }
  }
  if (!segment) return null;
  return Math.max(0, Math.round(
    segment.activeElapsedAtStartMs + recordedAt - segment.startedAt,
  ));
}

export function mapHeartRateMeasurementsToActiveClock(
  measurements: readonly HeartRateMeasurement[],
  segments: readonly HeartRateActiveClockSegment[],
): PrivateHeartRateSample[] {
  return dedupeHeartRateMeasurements(measurements).flatMap((measurement) => {
    const activeElapsedMs = activeElapsedMsAt(measurement.recordedAt, segments);
    return activeElapsedMs == null ? [] : [{ ...measurement, activeElapsedMs }];
  });
}

export function isHeartRateMeasurementFresh(
  sample: HeartRateMeasurement | null | undefined,
  now = Date.now(),
  freshnessMs = defaultHeartRateFreshnessMs,
) {
  if (!sample || !Number.isFinite(now)) return false;
  const safeFreshnessMs = Math.max(0, Number(freshnessMs) || 0);
  const ageMs = now - sample.recordedAt;
  // Permit a small cross-device clock lead while rejecting implausible future
  // values that could otherwise appear live indefinitely.
  return ageMs >= -2_000 && ageMs <= safeFreshnessMs;
}

function emptyHeartRateSummary(): PrivateHeartRateSummary {
  return {
    sampleCount: 0,
    coverageMs: 0,
    coveragePercent: 0,
    firstSampleElapsedMs: null,
    lastSampleElapsedMs: null,
    minimumBpm: null,
    averageBpm: null,
    peakBpm: null,
  };
}

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueSamplesForSummary(samples: readonly PrivateHeartRateSample[]) {
  const raw = dedupeHeartRateMeasurements(samples);
  const activeElapsedByKey = new Map<string, number>();
  for (const sample of samples) {
    const key = heartRateSequenceKey(sample);
    if (!activeElapsedByKey.has(key)) activeElapsedByKey.set(key, sample.activeElapsedMs);
  }
  return raw.flatMap((sample) => {
    const activeElapsedMs = activeElapsedByKey.get(heartRateSequenceKey(sample));
    return Number.isFinite(activeElapsedMs)
      ? [{ ...sample, activeElapsedMs: Math.max(0, Number(activeElapsedMs)) }]
      : [];
  }).sort((left, right) => (
    left.activeElapsedMs - right.activeElapsedMs || left.sequence - right.sequence
  ));
}

/**
 * Computes a time-weighted average and reports how much of the requested
 * window has real sensor coverage. A sample is carried forward only until the
 * next sample or maximumGapMs, whichever comes first; gaps are never invented.
 */
export function summarizeHeartRate(
  samples: readonly PrivateHeartRateSample[],
  window: HeartRateSummaryWindow,
): PrivateHeartRateSummary {
  const startElapsedMs = Math.max(0, finiteNumber(window.startElapsedMs) ?? 0);
  const endElapsedMs = Math.max(startElapsedMs, finiteNumber(window.endElapsedMs) ?? startElapsedMs);
  const maximumGapMs = Math.max(
    0,
    finiteNumber(window.maximumGapMs) ?? defaultHeartRateCoverageGapMs,
  );
  const durationMs = endElapsedMs - startElapsedMs;
  const inWindow = uniqueSamplesForSummary(samples).filter((sample) => (
    sample.activeElapsedMs >= startElapsedMs && sample.activeElapsedMs < endElapsedMs
  ));
  if (inWindow.length === 0) return emptyHeartRateSummary();

  let coverageMs = 0;
  let weightedBpmMs = 0;
  for (let index = 0; index < inWindow.length; index += 1) {
    const sample = inWindow[index];
    const next = inWindow[index + 1];
    const coveredUntil = Math.min(
      endElapsedMs,
      sample.activeElapsedMs + maximumGapMs,
      next?.activeElapsedMs ?? endElapsedMs,
    );
    const intervalMs = Math.max(0, coveredUntil - Math.max(startElapsedMs, sample.activeElapsedMs));
    coverageMs += intervalMs;
    weightedBpmMs += sample.bpm * intervalMs;
  }

  const bpms = inWindow.map((sample) => sample.bpm);
  const arithmeticAverage = bpms.reduce((total, bpm) => total + bpm, 0) / bpms.length;
  return {
    sampleCount: inWindow.length,
    coverageMs: Math.round(coverageMs),
    coveragePercent: durationMs > 0
      ? roundMetric(Math.min(100, coverageMs / durationMs * 100), 1)
      : 0,
    firstSampleElapsedMs: Math.round(inWindow[0].activeElapsedMs),
    lastSampleElapsedMs: Math.round(inWindow.at(-1)!.activeElapsedMs),
    minimumBpm: Math.min(...bpms),
    averageBpm: roundMetric(coverageMs > 0 ? weightedBpmMs / coverageMs : arithmeticAverage, 1),
    peakBpm: Math.max(...bpms),
  };
}

export function summarizeHeartRateZones(
  samples: readonly PrivateHeartRateSample[],
  zones: readonly HeartRateZoneWindow[],
  maximumGapMs = defaultHeartRateCoverageGapMs,
): PrivateHeartRateZoneSummary[] {
  return zones.flatMap((zone) => {
    const zoneId = typeof zone.zoneId === 'string' ? zone.zoneId.trim() : '';
    const startElapsedMs = finiteNumber(zone.startElapsedMs);
    const endElapsedMs = finiteNumber(zone.endElapsedMs);
    if (!zoneId || startElapsedMs == null || endElapsedMs == null || endElapsedMs < startElapsedMs) {
      return [];
    }
    const zoneName = typeof zone.zoneName === 'string' ? zone.zoneName.trim() : '';
    return [{
      zoneId,
      ...(zoneName ? { zoneName } : {}),
      startElapsedMs: Math.max(0, Math.round(startElapsedMs)),
      endElapsedMs: Math.max(0, Math.round(endElapsedMs)),
      summary: summarizeHeartRate(samples, {
        startElapsedMs,
        endElapsedMs,
        maximumGapMs,
      }),
    }];
  });
}
