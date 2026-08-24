import type { BikeSample } from '../types';

export type BikeMetricPatch = Partial<Pick<BikeSample, 'battery' | 'cadence' | 'speedKph' | 'watts'>>;

// TrackLab's practical rider/sanity ceiling is informed by Wattbike training
// guidance; it is not a published hardware maximum. Reject anything above it
// instead of clamping: a clamped packet would still invent speed and distance
// that the rider did not produce.
export const maximumAcceptedWattbikeCadenceRpm = 200;
// Raw Wattbike speed packets use the stricter 80 KPH sensor ceiling. Explore
// derives 82.8 KPH from an otherwise-valid 200 RPM cadence, so recorded/live
// app state needs a separate ceiling or it would reject its own valid output.
export const maxReasonableBikeSpeedKph = 80;
export const maximumAcceptedTrainingSpeedKph = 83;
export const maximumAcceptedTrainingSpeedMph = maximumAcceptedTrainingSpeedKph / 1.609344;
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

export function acceptedBikeCadenceRpm(value: unknown) {
  const numberValue = finiteNumber(value);
  if (
    numberValue == null
    || numberValue < 0
    || numberValue > maximumAcceptedWattbikeCadenceRpm
  ) {
    return null;
  }

  return numberValue;
}

export function cleanBikeCadenceRpm(value: unknown) {
  const cadence = acceptedBikeCadenceRpm(value);
  return cadence == null ? null : Math.round(cadence);
}

export function acceptedBikeSpeedKph(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0 || numberValue > maxReasonableBikeSpeedKph) {
    return null;
  }

  return numberValue;
}

export function acceptedTrainingSpeedKph(value: unknown) {
  const numberValue = finiteNumber(value);
  if (
    numberValue == null
    || numberValue < 0
    || numberValue > maximumAcceptedTrainingSpeedKph
  ) {
    return null;
  }

  return numberValue;
}

export function acceptedTrainingSpeedMph(value: unknown) {
  const numberValue = finiteNumber(value);
  if (
    numberValue == null
    || numberValue < 0
    || numberValue > maximumAcceptedTrainingSpeedMph
  ) {
    return null;
  }
  return numberValue;
}

export function cleanBikeSpeedKph(value: unknown) {
  const speedKph = acceptedBikeSpeedKph(value);
  return speedKph == null ? null : Number(speedKph.toFixed(2));
}

export function cleanTrainingSpeedKph(value: unknown) {
  const speedKph = acceptedTrainingSpeedKph(value);
  return speedKph == null ? null : Number(speedKph.toFixed(2));
}

const recordedCadenceMetricKeys = new Set([
  'averagecadence', 'cadence', 'cadencerpm', 'lastrawcadence', 'peakcadence',
  'peakcadencerpm', 'rawcadence', 'topcadence',
]);
const recordedSpeedKphMetricKeys = new Set([
  'averagespeedkph', 'peakspeedkph', 'rawspeedkph', 'speedkph', 'topspeedkph',
]);
const recordedSpeedMphMetricKeys = new Set([
  'averagespeedmph', 'peakspeedmph', 'rawspeedmph', 'speedmph', 'topspeedmph',
]);
const recordedSpeedMpsMetricKeys = new Set([
  'averagespeedmps', 'peakspeedmps', 'rawspeedmps', 'ridervelocitymps', 'speedmps',
  'topspeedmps', 'velocitymps',
]);

export function recordedBikeMetricKind(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (recordedCadenceMetricKeys.has(normalized)) return 'cadence' as const;
  if (recordedSpeedKphMetricKeys.has(normalized)) return 'speed-kph' as const;
  if (recordedSpeedMphMetricKeys.has(normalized)) return 'speed-mph' as const;
  if (recordedSpeedMpsMetricKeys.has(normalized)) return 'speed-mps' as const;
  return null;
}

export function recordedBikeMetricsAreAccepted(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(value)) {
    return value.every((entry) => recordedBikeMetricsAreAccepted(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return true;
  const entries = Object.entries(value);
  const metrics = new Map(entries.map(([key, nested]) => (
    [key.replace(/[^a-z0-9]/gi, '').toLowerCase(), nested]
  )));
  const pairAccepted = (averageKey: string, peakKeys: string[]) => peakKeys.every((peakKey) => {
    const average = metrics.get(averageKey);
    const peak = metrics.get(peakKey);
    return average == null || peak == null || Number(average) <= Number(peak);
  });
  if (
    !pairAccepted('averagecadence', ['topcadence', 'peakcadence'])
    || !pairAccepted('averagespeedkph', ['topspeedkph', 'peakspeedkph'])
    || !pairAccepted('averagespeedmph', ['topspeedmph', 'peakspeedmph'])
    || !pairAccepted('averagespeedmps', ['topspeedmps', 'peakspeedmps'])
  ) return false;
  return entries.every(([key, nested]) => {
    const kind = recordedBikeMetricKind(key);
    if (kind === 'cadence') return nested == null || acceptedBikeCadenceRpm(nested) != null;
    if (kind === 'speed-kph') return nested == null || acceptedTrainingSpeedKph(nested) != null;
    if (kind === 'speed-mph') return nested == null || acceptedTrainingSpeedMph(nested) != null;
    if (kind === 'speed-mps') {
      return nested == null || acceptedTrainingSpeedKph(Number(nested) * 3.6) != null;
    }
    return recordedBikeMetricsAreAccepted(nested, depth + 1);
  });
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
  const cadenceWasRejected = patch.cadence !== undefined
    && patch.cadence !== null
    && cleanBikeCadenceRpm(patch.cadence) == null;
  if (patch.battery !== undefined) {
    next.battery = cleanBikeBattery(patch.battery);
  }
  if (patch.cadence !== undefined) {
    const cadence = cleanBikeCadenceRpm(patch.cadence);
    if (cadence != null) {
      next.cadence = cadence;
    }
  }
  if (patch.speedKph !== undefined && !cadenceWasRejected) {
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
  const cadenceWasRejected = sample.cadence != null && cadence == null;
  const speedKph = cadenceWasRejected || sample.speedKph == null
    ? null
    : cleanBikeSpeedKph(sample.speedKph);

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
