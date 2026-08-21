import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  distanceUnitStorageKey,
  speedUnitStorageKey,
  unitPreferencesLegacyOwnerStorageKey,
  unitPreferencesStorageKey,
} from '../../src/data';
import {
  localeRegionCode,
  mergeUnitPreferences,
  migrateLegacyUnitPreferences,
  normalizeUnitPreferences,
  readStoredUnitPreferences,
  regionalUnitPreferences,
  writeStoredUnitPreferences,
} from '../../src/lib/unitPreferences';

function createStorage(initialEntries: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initialEntries));
  return {
    entries,
    storage: {
      getItem: vi.fn((key: string) => entries.get(key) ?? null),
      removeItem: vi.fn((key: string) => { entries.delete(key); }),
      setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account unit preferences', () => {
  it('normalizes only supported units and bounded timestamps', () => {
    expect(normalizeUnitPreferences({ speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 12.6 }))
      .toEqual({ speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 13 });
    expect(normalizeUnitPreferences({ speedUnit: 'knots', distanceUnit: 'ft', updatedAt: 10 })).toBeNull();
    expect(normalizeUnitPreferences({ speedUnit: 'kph', distanceUnit: 'km', updatedAt: 10 })).toBeNull();
    expect(normalizeUnitPreferences([])).toBeNull();
    expect(normalizeUnitPreferences({ speedUnit: 'kph', distanceUnit: 'm', updatedAt: Infinity }))
      .toEqual({ speedUnit: 'kph', distanceUnit: 'm', updatedAt: 0 });

    const before = Date.now();
    const future = normalizeUnitPreferences({
      speedUnit: 'kph',
      distanceUnit: 'm',
      updatedAt: before + 24 * 60 * 60 * 1000,
    });
    expect(future?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(future?.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('chooses regional defaults without coupling speed and distance systems', () => {
    expect(localeRegionCode(['en_US'])).toBe('US');
    expect(regionalUnitPreferences(['en-US'])).toMatchObject({ speedUnit: 'mph', distanceUnit: 'ft' });
    expect(regionalUnitPreferences(['en-GB'])).toMatchObject({ speedUnit: 'mph', distanceUnit: 'm' });
    expect(regionalUnitPreferences(['fr-FR'])).toMatchObject({ speedUnit: 'kph', distanceUnit: 'm' });
  });

  it('keeps the newest complete preference snapshot and lets incoming values win ties', () => {
    const current = { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 200 } as const;
    const stale = { speedUnit: 'kph', distanceUnit: 'm', updatedAt: 100 } as const;
    const tied = { speedUnit: 'kph', distanceUnit: 'm', updatedAt: 200 } as const;

    expect(mergeUnitPreferences(current, stale)).toEqual(current);
    expect(mergeUnitPreferences(current, tied)).toEqual(tied);
    expect(mergeUnitPreferences(null, current)).toEqual(current);
  });

  it('isolates stored preferences by profile and migrates legacy toggles only once', () => {
    const { entries, storage } = createStorage({
      [speedUnitStorageKey]: 'kph',
      [distanceUnitStorageKey]: 'km',
    });
    vi.stubGlobal('window', { localStorage: storage });

    const migrated = migrateLegacyUnitPreferences('user:first');
    expect(migrated).toMatchObject({ speedUnit: 'kph', distanceUnit: 'm' });
    expect(readStoredUnitPreferences('user:first')).toEqual(migrated);
    expect(entries.get(unitPreferencesLegacyOwnerStorageKey)).toBe('user:first');
    expect(entries.has(speedUnitStorageKey)).toBe(false);
    expect(entries.has(distanceUnitStorageKey)).toBe(false);

    expect(writeStoredUnitPreferences('user:second', {
      speedUnit: 'mph',
      distanceUnit: 'ft',
      updatedAt: 300,
    })).toBe(true);
    expect(readStoredUnitPreferences('user:second')).toEqual({
      speedUnit: 'mph',
      distanceUnit: 'ft',
      updatedAt: 300,
    });
    expect(entries.has(`${unitPreferencesStorageKey}:${encodeURIComponent('user:first')}`)).toBe(true);
    expect(entries.has(`${unitPreferencesStorageKey}:${encodeURIComponent('user:second')}`)).toBe(true);

    entries.set(speedUnitStorageKey, 'mph');
    entries.set(distanceUnitStorageKey, 'ft');
    expect(migrateLegacyUnitPreferences('user:third')).toBeNull();
  });
});
