import { liveBikeTimeoutMs } from '../data';
import { bmxSpeedKphFromCadence } from '../game/bmxRollout';
import {
  acceptedTrainingSpeedKph,
  cleanBikeCadenceRpm,
  cleanBikeWatts,
} from './bikeSampleSanity';
import type { BikeSample, PlayerSlot } from '../types';

export const getPulledPresetSeconds = [3, 6, 30] as const;
export const getPulledAirSettings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const getPulledCountdownSeconds = 6;
export const getPulledResultHoldMs = 15_000;
export const getPulledMinimumSeconds = 1;
export const getPulledMaximumSeconds = 300;

export type GetPulledPhase = 'setup' | 'countdown' | 'armed' | 'active' | 'results';

export type GetPulledMetrics = {
  live: boolean;
  watts: number;
  cadence: number;
  speedKph: number;
};

export type GetPulledAccumulator = {
  sampleCount: number;
  wattsTotal: number;
  cadenceTotal: number;
  speedKphTotal: number;
  peakWatts: number;
  peakCadence: number;
  peakSpeedKph: number;
  distanceMeters: number;
  lastAt: number | null;
};

export type GetPulledResult = {
  id: string;
  playerId: PlayerSlot['id'];
  riderId?: string;
  riderName: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  airSetting: number;
  distanceMeters: number;
  averageWatts: number;
  peakWatts: number;
  averageCadence: number;
  peakCadence: number;
  averageSpeedKph: number;
  peakSpeedKph: number;
};

export type GetPulledLiveState = {
  phase: GetPulledPhase;
  playerId: PlayerSlot['id'];
  riderId?: string;
  riderName: string;
  durationSeconds: number;
  airSetting: number;
  elapsedMs: number;
  distanceMeters: number;
  metrics: GetPulledMetrics;
  result: GetPulledResult | null;
};

export function normalizeGetPulledSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(getPulledMaximumSeconds, Math.max(getPulledMinimumSeconds, Math.round(parsed)));
}

export function normalizeGetPulledAirSetting(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

function metricFresh(sample: BikeSample | undefined, at: number | undefined, now: number) {
  return Boolean(sample && now - (at ?? sample.at) <= liveBikeTimeoutMs);
}

export function getPulledMetrics(sample: BikeSample | undefined, now = Date.now()): GetPulledMetrics {
  const watts = metricFresh(sample, sample?.wattsAt, now) ? Math.max(0, sample?.watts ?? 0) : 0;
  const cadence = metricFresh(sample, sample?.cadenceAt, now)
    ? cleanBikeCadenceRpm(sample?.cadence) ?? 0
    : 0;
  const idleNoise = watts < 1 && cadence <= 15;
  const cleanWatts = idleNoise ? 0 : Math.round(watts);
  const cleanCadence = idleNoise ? 0 : Math.round(cadence);
  return {
    live: metricFresh(sample, sample?.at, now),
    watts: cleanWatts,
    cadence: cleanCadence,
    speedKph: idleNoise ? 0 : bmxSpeedKphFromCadence(cleanCadence),
  };
}

export type GetPulledTakeoffSignal = {
  at: number;
  metrics: GetPulledMetrics;
};

export function getPulledTakeoffSignal(
  sample: BikeSample | undefined,
  armedAt: number,
  now = Date.now(),
): GetPulledTakeoffSignal | null {
  if (!sample || !Number.isFinite(armedAt)) return null;
  const metrics = getPulledMetrics(sample, now);
  if (!metrics.live) return null;

  const wattsAt = sample.wattsAt ?? sample.at;
  const freshPowerStarted = metricFresh(sample, sample.wattsAt, now)
    && sample.watts >= 1
    && wattsAt >= armedAt;
  if (!freshPowerStarted) return null;

  const cadenceAt = sample.cadenceAt ?? sample.at;
  const cadence = metricFresh(sample, sample.cadenceAt, now) && cadenceAt >= armedAt
    ? cleanBikeCadenceRpm(sample.cadence) ?? 0
    : 0;
  return {
    at: Math.min(now, Math.max(armedAt, wattsAt)),
    metrics: {
      live: true,
      watts: Math.max(1, Math.round(sample.watts)),
      cadence,
      speedKph: bmxSpeedKphFromCadence(cadence),
    },
  };
}

export function getPulledDemoMetrics(elapsedMs: number, airSetting: number): GetPulledMetrics {
  const elapsedSeconds = Math.max(0, elapsedMs) / 1_000;
  const launch = Math.min(1, elapsedSeconds / 1.15);
  const cadence = Math.round((58 + Math.sin(elapsedSeconds * 5.1) * 4 + airSetting * 1.4) * launch);
  const watts = Math.round((285 + airSetting * 38 + Math.sin(elapsedSeconds * 4.3) * 34) * launch);
  return {
    live: true,
    watts,
    cadence,
    speedKph: bmxSpeedKphFromCadence(cadence),
  };
}

export function createGetPulledAccumulator(): GetPulledAccumulator {
  return {
    sampleCount: 0,
    wattsTotal: 0,
    cadenceTotal: 0,
    speedKphTotal: 0,
    peakWatts: 0,
    peakCadence: 0,
    peakSpeedKph: 0,
    distanceMeters: 0,
    lastAt: null,
  };
}

export function addGetPulledSample(
  accumulator: GetPulledAccumulator,
  metrics: GetPulledMetrics,
  at: number,
): GetPulledAccumulator {
  const watts = cleanBikeWatts(metrics.watts);
  const cadence = cleanBikeCadenceRpm(metrics.cadence);
  const speedKph = acceptedTrainingSpeedKph(metrics.speedKph);
  if (watts == null || cadence == null || speedKph == null) return accumulator;
  const previousAt = accumulator.lastAt;
  const deltaSeconds = previousAt == null ? 0 : Math.min(0.5, Math.max(0, at - previousAt) / 1_000);
  return {
    sampleCount: accumulator.sampleCount + 1,
    wattsTotal: accumulator.wattsTotal + watts,
    cadenceTotal: accumulator.cadenceTotal + cadence,
    speedKphTotal: accumulator.speedKphTotal + speedKph,
    peakWatts: Math.max(accumulator.peakWatts, watts),
    peakCadence: Math.max(accumulator.peakCadence, cadence),
    peakSpeedKph: Math.max(accumulator.peakSpeedKph, speedKph),
    distanceMeters: accumulator.distanceMeters + (speedKph / 3.6) * deltaSeconds,
    lastAt: at,
  };
}

/** Includes the boundary sample without allowing timer jitter past the official finish clock. */
export function addGetPulledSampleThroughEnd(
  accumulator: GetPulledAccumulator,
  metrics: GetPulledMetrics,
  sampleAt: number,
  endedAt: number,
): GetPulledAccumulator {
  return addGetPulledSample(accumulator, metrics, Math.min(sampleAt, endedAt));
}

export function getPulledResultFromAccumulator(
  accumulator: GetPulledAccumulator,
  player: PlayerSlot,
  startedAt: number,
  endedAt: number,
  durationSeconds: number,
  airSetting: number,
): GetPulledResult {
  const count = Math.max(1, accumulator.sampleCount);
  return {
    id: `get-pulled:${player.riderId ?? player.id}:${startedAt}`,
    playerId: player.id,
    ...(player.riderId ? { riderId: player.riderId } : {}),
    riderName: player.name,
    startedAt,
    endedAt,
    durationSeconds,
    airSetting: normalizeGetPulledAirSetting(airSetting),
    distanceMeters: accumulator.distanceMeters,
    averageWatts: Math.round(accumulator.wattsTotal / count),
    peakWatts: accumulator.peakWatts,
    averageCadence: Math.round(accumulator.cadenceTotal / count),
    peakCadence: accumulator.peakCadence,
    averageSpeedKph: accumulator.speedKphTotal / count,
    peakSpeedKph: accumulator.peakSpeedKph,
  };
}
