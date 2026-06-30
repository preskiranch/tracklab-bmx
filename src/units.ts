import type { DistanceUnit, SpeedUnit } from './types';

export function formatSpeedFromMps(speedMps: number, unit: SpeedUnit) {
  const value = unit === 'mph' ? speedMps * 2.236936 : speedMps * 3.6;
  return value.toFixed(1);
}

export function formatSpeedFromKph(speedKph: number | null | undefined, unit: SpeedUnit) {
  if (speedKph == null) {
    return '--';
  }

  const value = unit === 'mph' ? speedKph * 0.621371 : speedKph;
  return value.toFixed(1);
}

export function speedUnitLabel(unit: SpeedUnit) {
  return unit === 'mph' ? 'MPH' : 'KPH';
}

export function formatDistanceMeters(meters: number | null | undefined, unit: DistanceUnit) {
  if (meters == null || !Number.isFinite(meters)) {
    return unit === 'm' ? '-- m' : '-- ft';
  }

  if (unit === 'm') {
    return `${Math.round(meters).toLocaleString()} m`;
  }

  return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
}

export function formatDistanceRangeMeters(startMeters: number, endMeters: number, unit: DistanceUnit) {
  const start = Math.max(0, startMeters);
  const end = Math.max(start, endMeters);

  if (unit === 'm') {
    return `${Math.round(start).toLocaleString()}-${Math.round(end).toLocaleString()} m`;
  }

  return `${Math.round(start * 3.28084).toLocaleString()}-${Math.round(end * 3.28084).toLocaleString()} ft`;
}
