import type { ExploreElevationSample } from '../types';

export type ExploreSlopeDirection = 'climb' | 'descent' | 'level';

function sortedElevationSamples(samples: ExploreElevationSample[] | null | undefined) {
  return [...(samples ?? [])]
    .filter((sample) => Number.isFinite(sample.distanceMeters) && Number.isFinite(sample.elevationMeters))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
}

export function exploreElevationAtMeter(
  samples: ExploreElevationSample[] | null | undefined,
  distanceMeters: number,
) {
  const sorted = sortedElevationSamples(samples);
  if (sorted.length === 0) {
    return null;
  }
  const distance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  if (distance <= sorted[0].distanceMeters) {
    return sorted[0].elevationMeters;
  }
  const last = sorted[sorted.length - 1];
  if (distance >= last.distanceMeters) {
    return last.elevationMeters;
  }
  const upperIndex = sorted.findIndex((sample) => sample.distanceMeters >= distance);
  const lower = sorted[Math.max(0, upperIndex - 1)];
  const upper = sorted[upperIndex];
  const span = Math.max(0.001, upper.distanceMeters - lower.distanceMeters);
  const progress = (distance - lower.distanceMeters) / span;
  return lower.elevationMeters + (upper.elevationMeters - lower.elevationMeters) * progress;
}

export function exploreGradeAtMeter(
  samples: ExploreElevationSample[] | null | undefined,
  distanceMeters: number,
  windowMeters = 40,
) {
  const sorted = sortedElevationSamples(samples);
  if (sorted.length < 2) {
    return 0;
  }
  const routeEnd = sorted[sorted.length - 1].distanceMeters;
  const halfWindow = Math.max(5, windowMeters / 2);
  const startMeter = Math.max(0, Math.min(routeEnd, distanceMeters - halfWindow));
  const endMeter = Math.max(0, Math.min(routeEnd, distanceMeters + halfWindow));
  if (endMeter - startMeter < 1) {
    return 0;
  }
  const startElevation = exploreElevationAtMeter(sorted, startMeter);
  const endElevation = exploreElevationAtMeter(sorted, endMeter);
  if (startElevation == null || endElevation == null) {
    return 0;
  }
  return Math.max(-30, Math.min(30, (endElevation - startElevation) / (endMeter - startMeter) * 100));
}

export function exploreSlopeDirection(gradePercent: number): ExploreSlopeDirection {
  if (gradePercent >= 0.75) {
    return 'climb';
  }
  if (gradePercent <= -0.75) {
    return 'descent';
  }
  return 'level';
}

export function formatExploreElevation(meters: number, unit: 'mi' | 'km') {
  if (!Number.isFinite(meters)) {
    return '—';
  }
  return unit === 'mi'
    ? `${Math.round(meters * 3.28084).toLocaleString()} ft`
    : `${Math.round(meters).toLocaleString()} m`;
}

export function formatExploreGrade(gradePercent: number) {
  const safeGrade = Number.isFinite(gradePercent) ? gradePercent : 0;
  return `${safeGrade > 0 ? '+' : ''}${safeGrade.toFixed(1)}%`;
}
