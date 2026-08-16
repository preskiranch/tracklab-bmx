import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioRidersStorageKey } from '../../src/data';
import {
  readStoredStudioRidersForProfile,
  studioRiderStorageKeyForProfile,
  writeStoredStudioRidersForProfile,
} from '../../src/lib/studioRiderStorage';
import type { StudioRider } from '../../src/types';

function rider(id: string, name: string): StudioRider {
  return { id, name, createdAt: 100, updatedAt: 100 };
}

function installStorage(options: { failScopedWrites?: boolean } = {}) {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.failScopedWrites && key !== studioRidersStorageKey) {
          throw new Error('storage full');
        }
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account-scoped studio rider storage', () => {
  it('keeps rosters isolated when accounts share one browser', () => {
    installStorage();
    writeStoredStudioRidersForProfile('owner-profile', [rider('owner-rider', 'Jordan')]);
    writeStoredStudioRidersForProfile('athlete-profile', [rider('athlete-rider', 'Rasheen')]);

    expect(readStoredStudioRidersForProfile('owner-profile').map(({ name }) => name)).toEqual(['Jordan']);
    expect(readStoredStudioRidersForProfile('athlete-profile').map(({ name }) => name)).toEqual(['Rasheen']);
    expect(studioRiderStorageKeyForProfile('owner-profile'))
      .not.toBe(studioRiderStorageKeyForProfile('athlete-profile'));
  });

  it('never exposes the legacy device-wide roster to an athlete account', () => {
    const storage = installStorage();
    storage.set(studioRidersStorageKey, JSON.stringify([rider('studio-rider', 'Jordan')]));

    expect(readStoredStudioRidersForProfile('athlete-profile')).toEqual([]);
    expect(readStoredStudioRidersForProfile('owner-profile', {
      allowLegacyOwnerRoster: true,
    }).map(({ name }) => name)).toEqual(['Jordan']);
    expect(storage.get(studioRiderStorageKeyForProfile('owner-profile'))).toBeTruthy();
    expect(storage.get(studioRiderStorageKeyForProfile('athlete-profile'))).toBeUndefined();
    expect(storage.get(studioRidersStorageKey)).toBeUndefined();
  });

  it('retains the legacy roster when the scoped migration write fails', () => {
    const storage = installStorage({ failScopedWrites: true });
    storage.set(studioRidersStorageKey, JSON.stringify([rider('studio-rider', 'Jordan')]));

    expect(readStoredStudioRidersForProfile('owner-profile', {
      allowLegacyOwnerRoster: true,
    }).map(({ name }) => name)).toEqual(['Jordan']);
    expect(storage.get(studioRidersStorageKey)).toBeTruthy();
    expect(storage.get(studioRiderStorageKeyForProfile('owner-profile'))).toBeUndefined();
  });
});
