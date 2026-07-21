import type { BikeSample, PlayerId } from '../types';

export const bmxCStartBackoffMeters = 0.0762;
export const bmxCStartReleaseMs = 180;
export type CStartOffsetsByPlayer = Partial<Record<PlayerId, number>>;

function metricArrivedSince(sample: BikeSample, metricAt: number | undefined, since: number) {
  return (metricAt ?? sample.at) >= since;
}

export function bikeSampleHasDriveSignalSince(sample: BikeSample | undefined, since: number) {
  if (!sample || since <= 0) {
    return false;
  }

  return (
    (sample.cadence ?? 0) > 0 && metricArrivedSince(sample, sample.cadenceAt, since)
  ) || (
    (sample.speedKph ?? 0) > 0 && metricArrivedSince(sample, sample.speedAt, since)
  ) || (
    sample.watts > 0 && metricArrivedSince(sample, sample.wattsAt, since)
  );
}

export function cStartVisualDistance(distanceMeters: number, backoffMeters = 0) {
  return distanceMeters - Math.max(0, Math.min(bmxCStartBackoffMeters, backoffMeters));
}
