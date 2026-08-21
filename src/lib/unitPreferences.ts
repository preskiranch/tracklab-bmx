import {
  distanceUnitStorageKey,
  speedUnitStorageKey,
  unitPreferencesLegacyOwnerStorageKey,
  unitPreferencesStorageKey,
} from '../data';
import type { DistanceUnit, SpeedUnit, UnitPreferences } from '../types';
import { safeSetLocalStorage } from './browserStorage';

const mphRegions = new Set([
  'AI', 'BS', 'BZ', 'FK', 'GB', 'GG', 'IM', 'JE', 'KY', 'LR', 'MM', 'MS', 'SH', 'TC', 'US', 'VG',
]);
const feetRegions = new Set(['LR', 'MM', 'US']);
const unitPreferenceClockSkewMs = 5 * 60 * 1000;

function validSpeedUnit(value: unknown): value is SpeedUnit {
  return value === 'mph' || value === 'kph';
}

function validDistanceUnit(value: unknown): value is DistanceUnit {
  return value === 'ft' || value === 'm';
}

function normalizedUpdatedAt(value: unknown, now = Date.now()) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(numeric)));
  return rounded > now + unitPreferenceClockSkewMs ? now : rounded;
}

export function normalizeUnitPreferences(value: unknown): UnitPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<UnitPreferences>;
  if (!validSpeedUnit(candidate.speedUnit) || !validDistanceUnit(candidate.distanceUnit)) return null;
  return {
    speedUnit: candidate.speedUnit,
    distanceUnit: candidate.distanceUnit,
    updatedAt: normalizedUpdatedAt(candidate.updatedAt),
  };
}

export function localeRegionCode(languages?: readonly string[]) {
  const candidates = languages?.length
    ? languages
    : typeof navigator !== 'undefined'
      ? navigator.languages?.length ? navigator.languages : [navigator.language]
      : [];

  for (const language of candidates) {
    if (!language) continue;
    try {
      const region = new Intl.Locale(language).region;
      if (region) return region.toUpperCase();
    } catch {
      const match = language.match(/[-_]([a-z]{2}|\d{3})(?:$|[-_])/i);
      if (match) return match[1].toUpperCase();
    }
  }
  return null;
}

export function regionalUnitPreferences(
  languages?: readonly string[],
  updatedAt = 0,
): UnitPreferences {
  const region = localeRegionCode(languages);
  return {
    speedUnit: region && mphRegions.has(region) ? 'mph' : 'kph',
    distanceUnit: region && feetRegions.has(region) ? 'ft' : 'm',
    updatedAt: normalizedUpdatedAt(updatedAt),
  };
}

export function mergeUnitPreferences(
  currentValue: unknown,
  incomingValue: unknown,
): UnitPreferences | null {
  const current = normalizeUnitPreferences(currentValue);
  const incoming = normalizeUnitPreferences(incomingValue);
  if (!current) return incoming;
  if (!incoming) return current;
  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

function profileStorageKey(profileKey: string) {
  const normalized = profileKey.trim();
  return normalized ? `${unitPreferencesStorageKey}:${encodeURIComponent(normalized)}` : '';
}

export function readStoredUnitPreferences(profileKey: string) {
  const key = profileStorageKey(profileKey);
  if (!key || typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(key);
    return normalizeUnitPreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return null;
  }
}

export function writeStoredUnitPreferences(profileKey: string, preferences: UnitPreferences) {
  const key = profileStorageKey(profileKey);
  const normalized = normalizeUnitPreferences(preferences);
  if (!key || !normalized) return false;
  return safeSetLocalStorage(key, JSON.stringify(normalized));
}

/**
 * Migrates the original device-wide toggles once, into only the first profile
 * that opens after this release. A shared studio browser must never copy the
 * owner's units into every athlete account.
 */
export function migrateLegacyUnitPreferences(profileKey: string) {
  const key = profileStorageKey(profileKey);
  if (!key || typeof window === 'undefined') return null;
  const stored = readStoredUnitPreferences(profileKey);
  if (stored) return stored;

  try {
    const migrationOwner = window.localStorage.getItem(unitPreferencesLegacyOwnerStorageKey);
    if (migrationOwner && migrationOwner !== profileKey) return null;

    const legacySpeed = window.localStorage.getItem(speedUnitStorageKey);
    const legacyDistance = window.localStorage.getItem(distanceUnitStorageKey);
    if (!validSpeedUnit(legacySpeed) && legacyDistance !== 'ft' && legacyDistance !== 'm' && legacyDistance !== 'km') {
      return null;
    }

    const regional = regionalUnitPreferences();
    const migrated: UnitPreferences = {
      speedUnit: validSpeedUnit(legacySpeed) ? legacySpeed : regional.speedUnit,
      distanceUnit: legacyDistance === 'm' || legacyDistance === 'km'
        ? 'm'
        : legacyDistance === 'ft' ? 'ft' : regional.distanceUnit,
      updatedAt: Date.now(),
    };
    if (!writeStoredUnitPreferences(profileKey, migrated)) return migrated;
    safeSetLocalStorage(unitPreferencesLegacyOwnerStorageKey, profileKey);
    window.localStorage.removeItem(speedUnitStorageKey);
    window.localStorage.removeItem(distanceUnitStorageKey);
    return migrated;
  } catch {
    return null;
  }
}

export function unitPreferencesMatch(left: unknown, right: unknown) {
  const normalizedLeft = normalizeUnitPreferences(left);
  const normalizedRight = normalizeUnitPreferences(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}
