import type { BikeSample, PlayerId } from '../types';

export const bmxCStartBackoffMeters = 0.0762;
export const bmxCStartReleaseMs = 180;
export type CStartOffsetsByPlayer = Partial<Record<PlayerId, number>>;

function metricArrivedAt(sample: BikeSample, metricAt: number | undefined) {
  return metricAt ?? sample.at;
}

export function latestBikeDriveSignalAt(sample: BikeSample | undefined) {
  if (!sample) return 0;
  return Math.max(
    (sample.cadence ?? 0) > 0 ? metricArrivedAt(sample, sample.cadenceAt) : 0,
    (sample.speedKph ?? 0) > 0 ? metricArrivedAt(sample, sample.speedAt) : 0,
    sample.watts > 0 ? metricArrivedAt(sample, sample.wattsAt) : 0,
  );
}

export function bikeSampleHasDriveSignalSince(sample: BikeSample | undefined, since: number) {
  return since > 0 && latestBikeDriveSignalAt(sample) >= since;
}

export function cStartVisualDistance(distanceMeters: number, backoffMeters = 0) {
  return distanceMeters - Math.max(0, Math.min(bmxCStartBackoffMeters, backoffMeters));
}
