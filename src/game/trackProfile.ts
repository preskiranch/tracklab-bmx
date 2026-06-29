import { raceLengthMeters } from '../data';

export type TrackFeature = {
  id: 'tabletop' | 'roller' | 'stepUp' | 'finishKicker';
  kind: 'ramp' | 'roller';
  start: number;
  crest: number;
  end: number;
  heightPx: number;
  lift: number;
};

export const trackFeatures: TrackFeature[] = [
  { id: 'tabletop', kind: 'ramp', start: 0.13, crest: 0.19, end: 0.27, heightPx: 25, lift: 0.95 },
  { id: 'roller', kind: 'roller', start: 0.36, crest: 0.43, end: 0.51, heightPx: 18, lift: 0.72 },
  { id: 'stepUp', kind: 'ramp', start: 0.61, crest: 0.68, end: 0.77, heightPx: 22, lift: 1.05 },
  { id: 'finishKicker', kind: 'ramp', start: 0.82, crest: 0.88, end: 0.94, heightPx: 16, lift: 0.62 },
];

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function featureOffset(feature: TrackFeature, progress: number) {
  if (progress < feature.start || progress > feature.end) {
    return 0;
  }

  if (feature.kind === 'roller') {
    const t = (progress - feature.start) / (feature.end - feature.start);
    return -Math.sin(Math.PI * t) * feature.heightPx;
  }

  if (progress <= feature.crest) {
    return -smoothstep((progress - feature.start) / (feature.crest - feature.start)) * feature.heightPx;
  }

  return -(1 - smoothstep((progress - feature.crest) / (feature.end - feature.crest))) * feature.heightPx;
}

export function surfaceOffsetPx(distance: number) {
  const progress = Math.max(0, Math.min(1, distance / raceLengthMeters));
  return trackFeatures.reduce((total, feature) => total + featureOffset(feature, progress), 0);
}

export function surfaceAngleDeg(distance: number) {
  const sampleDistance = 1.25;
  const before = surfaceOffsetPx(Math.max(0, distance - sampleDistance));
  const after = surfaceOffsetPx(Math.min(raceLengthMeters, distance + sampleDistance));
  return Math.atan2(after - before, sampleDistance * 2) * (180 / Math.PI) * 0.45;
}

export function crossedTakeoff(previousDistance: number, distance: number) {
  const previousProgress = previousDistance / raceLengthMeters;
  const progress = distance / raceLengthMeters;

  return trackFeatures.find((feature) => (
    previousProgress < feature.crest && progress >= feature.crest
  ));
}
