import type { BikeSample } from '../types';

export const minimumDemoHeartRateBpm = 54;
export const maximumDemoHeartRateBpm = 198;

export type DemoHeartRatePhase = 'rest' | 'active' | 'recovery';

export type DemoHeartRateReading = Readonly<{
  source: 'demo-simulated';
  bpm: number;
  recordedAt: number;
}>;

export type DemoHeartRateInput = Readonly<{
  deviceId: number;
  phase: DemoHeartRatePhase;
  elapsedMs: number;
  effort: number;
  recordedAt: number;
  activeDurationMs?: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function riderProfile(deviceId: number) {
  const id = Number.isFinite(deviceId) ? Math.abs(Math.trunc(deviceId)) : 0;
  return {
    restingBpm: 57 + (id * 7 % 15),
    maximumBpm: 184 + (id * 11 % 15),
    riseSeconds: 7 + (id * 5 % 6),
    recoverySeconds: 16 + (id * 3 % 9),
    phaseOffset: (id % 17) / 17 * Math.PI * 2,
  };
}

function activeBpm(deviceId: number, elapsedMs: number, effort: number) {
  const profile = riderProfile(deviceId);
  const elapsedSeconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1_000;
  const normalizedEffort = clamp(Number.isFinite(effort) ? effort : 0, 0, 1);
  const rise = 1 - Math.exp(-elapsedSeconds / profile.riseSeconds);
  const workload = 0.2 + normalizedEffort * 0.72;
  const longEffortDrift = Math.min(0.07, elapsedSeconds / 240 * 0.07);
  const breathingWave = Math.sin(elapsedSeconds * 0.54 + profile.phaseOffset) * 1.25 * rise;
  return profile.restingBpm
    + (profile.maximumBpm - profile.restingBpm) * Math.min(0.95, workload * rise + longEffortDrift)
    + breathingWave;
}

export function demoHeartRateEffort(watts: number, cadence: number | null | undefined) {
  const powerEffort = Math.max(0, Number.isFinite(watts) ? watts : 0) / 1_350;
  const cadenceEffort = Math.max(0, Number.isFinite(cadence) ? cadence ?? 0 : 0) / 175;
  return clamp(powerEffort * 0.68 + cadenceEffort * 0.32, 0, 1);
}

export function demoHeartRateBpm(input: DemoHeartRateInput) {
  const profile = riderProfile(input.deviceId);
  let bpm = profile.restingBpm;

  if (input.phase === 'active') {
    bpm = activeBpm(input.deviceId, input.elapsedMs, input.effort);
  } else if (input.phase === 'recovery') {
    const recoveryStart = activeBpm(
      input.deviceId,
      Math.max(0, Number.isFinite(input.activeDurationMs) ? input.activeDurationMs ?? 0 : 0),
      input.effort,
    );
    bpm = profile.restingBpm
      + (recoveryStart - profile.restingBpm)
        * Math.exp(
          -Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0)
            / 1_000
            / profile.recoverySeconds,
        );
  }

  return Math.round(clamp(bpm, minimumDemoHeartRateBpm, maximumDemoHeartRateBpm));
}

export function demoHeartRateReading(input: DemoHeartRateInput): DemoHeartRateReading {
  return {
    source: 'demo-simulated',
    bpm: demoHeartRateBpm(input),
    recordedAt: Number.isFinite(input.recordedAt) ? Math.max(0, input.recordedAt) : 0,
  };
}

export function demoHeartRateReadingForBikeSample(
  sample: BikeSample | null | undefined,
): DemoHeartRateReading | null {
  if (!sample || sample.source !== 'demo') return null;
  const elapsedMs = Math.max(0, sample.demoActiveMs ?? 0);
  return demoHeartRateReading({
    deviceId: sample.deviceId,
    phase: elapsedMs > 0 ? 'active' : 'rest',
    elapsedMs,
    effort: demoHeartRateEffort(sample.watts, sample.cadence),
    recordedAt: sample.at,
  });
}
