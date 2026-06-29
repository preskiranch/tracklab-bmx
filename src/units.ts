import type { SpeedUnit } from './types';

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
