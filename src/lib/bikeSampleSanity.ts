import type { BikeSample } from '../types';

export type BikeMetricPatch = Partial<Pick<BikeSample, 'battery' | 'cadence' | 'speedKph' | 'watts'>>;

export const maxReasonableBikeCadenceRpm = 260;
export const maxReasonableBikeSpeedKph = 80;
export const maxReasonableBikeWatts = 4000;

function finiteNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function cleanBikeWatts(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0 || numberValue > maxReasonableBikeWatts) {
    return null;
  }

  return Math.round(numberValue);
}

export function cleanBikeCadenceRpm(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0 || numberValue > maxReasonableBikeCadenceRpm) {
    return null;
  }

  return Math.round(numberValue);
}

export function cleanBikeSpeedKph(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0 || numberValue > maxReasonableBikeSpeedKph) {
    return null;
  }

  return Number(numberValue.toFixed(2));
}

export function cleanBikeBattery(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0 || numberValue > 100) {
    return undefined;
  }

  return Math.round(numberValue);
}

export function sanitizeBikeMetricPatch(patch: BikeMetricPatch) {
  const next: BikeMetricPatch = {};
  if (patch.battery !== undefined) {
    next.battery = cleanBikeBattery(patch.battery);
  }
  if (patch.cadence !== undefined) {
    const cadence = cleanBikeCadenceRpm(patch.cadence);
    if (cadence != null) {
      next.cadence = cadence;
    }
  }
  if (patch.speedKph !== undefined) {
    const speedKph = cleanBikeSpeedKph(patch.speedKph);
    if (speedKph != null) {
      next.speedKph = speedKph;
    }
  }
  if (patch.watts !== undefined) {
    const watts = cleanBikeWatts(patch.watts);
    if (watts != null) {
      next.watts = watts;
    }
  }
  return next;
}

export function sanitizeBikeSample(sample: BikeSample) {
  const deviceId = Math.round(Number(sample.deviceId));
  if (!Number.isFinite(deviceId) || deviceId <= 0) {
    return null;
  }

  const at = finiteNumber(sample.at) ?? Date.now();
  const watts = cleanBikeWatts(sample.watts) ?? 0;
  const cadence = sample.cadence == null ? null : cleanBikeCadenceRpm(sample.cadence);
  const speedKph = sample.speedKph == null ? null : cleanBikeSpeedKph(sample.speedKph);

  return {
    ...sample,
    at,
    battery: cleanBikeBattery(sample.battery),
    cadence,
    cadenceAt: cadence == null ? undefined : finiteNumber(sample.cadenceAt) ?? at,
    deviceId,
    label: String(sample.label || `Wattbike ${deviceId}`),
    signal: finiteNumber(sample.signal) ?? 1,
    speedKph,
    speedAt: speedKph == null ? undefined : finiteNumber(sample.speedAt) ?? at,
    watts,
    wattsAt: finiteNumber(sample.wattsAt) ?? at,
  } satisfies BikeSample;
}
