import { HeartPulse } from 'lucide-react';
import {
  defaultHeartRateFreshnessMs,
  maximumHeartRateBpm,
  minimumHeartRateBpm,
} from '../lib/heartRate';
import './HeartRateMetric.css';

export const liveHeartRateFreshnessMs = defaultHeartRateFreshnessMs;

type HeartRateMetricProps = {
  bpm: number | null | undefined;
  recordedAt: number | null | undefined;
  now?: number;
  label?: string;
  compact?: boolean;
  className?: string;
};

function validBpm(value: number | null | undefined) {
  return value != null
    && Number.isFinite(value)
    && value >= minimumHeartRateBpm
    && value <= maximumHeartRateBpm
    ? Math.round(value)
    : null;
}

export function heartRateReadingState(
  bpm: number | null | undefined,
  recordedAt: number | null | undefined,
  now = Date.now(),
) {
  const normalizedBpm = validBpm(bpm);
  if (normalizedBpm == null || recordedAt == null || !Number.isFinite(recordedAt)) {
    return { state: 'missing' as const, bpm: null, detail: 'No recent reading' };
  }

  const ageMs = Math.max(0, now - recordedAt);
  if (ageMs > liveHeartRateFreshnessMs) {
    return {
      state: 'stale' as const,
      bpm: null,
      detail: `Last reading ${Math.max(1, Math.round(ageMs / 1_000))} seconds ago`,
    };
  }

  return {
    state: 'live' as const,
    bpm: normalizedBpm,
    detail: ageMs < 1_500 ? 'Live now' : `${Math.max(1, Math.round(ageMs / 1_000))} seconds ago`,
  };
}

export function HeartRateMetric({
  bpm,
  recordedAt,
  now = Date.now(),
  label = 'Heart rate',
  compact = false,
  className = '',
}: HeartRateMetricProps) {
  const reading = heartRateReadingState(bpm, recordedAt, now);

  return (
    <div
      className={`heart-rate-metric ${reading.state}${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}
      data-heart-rate-state={reading.state}
      role="status"
      aria-live="polite"
      aria-label={reading.bpm == null
        ? `${label}: ${reading.detail}`
        : `${label}: ${reading.bpm} beats per minute, ${reading.detail}`}
    >
      <HeartPulse aria-hidden="true" size={compact ? 17 : 21} />
      <span>
        <strong>{reading.bpm ?? '—'}</strong>
        <small>{reading.bpm == null ? reading.detail : 'BPM'}</small>
      </span>
    </div>
  );
}

export default HeartRateMetric;
