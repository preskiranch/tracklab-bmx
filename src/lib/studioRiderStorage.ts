import { studioRidersStorageKey } from '../data';
import type { StudioRider } from '../types';
import { safeSetLocalStorage } from './browserStorage';
import { mergeStudioRiders } from './studioRiders';

export function studioRiderStorageKeyForProfile(profileKey: string) {
  const normalizedProfileKey = profileKey.trim();
  return normalizedProfileKey
    ? `${studioRidersStorageKey}:${encodeURIComponent(normalizedProfileKey)}`
    : '';
}

export function readStoredStudioRidersForProfile(
  profileKey: string,
  options: { allowLegacyOwnerRoster?: boolean } = {},
): StudioRider[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const storageKey = studioRiderStorageKeyForProfile(profileKey);
  if (!storageKey) {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      return mergeStudioRiders(JSON.parse(stored));
    }

    // Only the website owner may migrate the original device-wide roster.
    // Athlete accounts must never inherit it on a shared studio browser.
    if (options.allowLegacyOwnerRoster) {
      const legacyStored = window.localStorage.getItem(studioRidersStorageKey);
      const legacyRiders = legacyStored ? mergeStudioRiders(JSON.parse(legacyStored)) : [];
      if (legacyRiders.length > 0) {
        const migrated = safeSetLocalStorage(storageKey, JSON.stringify(legacyRiders));
        if (migrated) {
          try {
            window.localStorage.removeItem(studioRidersStorageKey);
          } catch {
            // The scoped copy is authoritative even if the browser blocks cleanup.
          }
        }
      }
      return legacyRiders;
    }
  } catch {
    // Ignore blocked or malformed browser storage and let cloud sync recover it.
  }

  return [];
}

export function writeStoredStudioRidersForProfile(profileKey: string, riders: StudioRider[]) {
  const storageKey = studioRiderStorageKeyForProfile(profileKey);
  if (!storageKey) {
    return;
  }
  safeSetLocalStorage(storageKey, JSON.stringify(mergeStudioRiders(riders)));
}
