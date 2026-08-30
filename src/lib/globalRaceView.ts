import type { RaceViewPreferences } from '../types';
import { normalizeRaceViewPreferences } from './raceViewPreferences';

type GlobalRaceViewPayload = {
  raceViewPreferences?: RaceViewPreferences | null;
};

function normalizeGlobalRaceView(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return normalizeRaceViewPreferences(value);
}

export function applyGlobalRaceViewPreferences(
  accountPreferences: RaceViewPreferences,
  globalPreferences: RaceViewPreferences | null,
) {
  const account = normalizeRaceViewPreferences(accountPreferences);
  if (!globalPreferences) {
    return account;
  }
  const global = normalizeRaceViewPreferences(globalPreferences);
  return normalizeRaceViewPreferences({
    ...account,
    cameraLocked: true,
    cameraLockedUpdatedAt: Math.max(
      account.cameraLockedUpdatedAt,
      global.cameraLockedUpdatedAt,
    ),
    earthCamerasByTrack: {
      ...account.earthCamerasByTrack,
      ...global.earthCamerasByTrack,
    },
    riderOverlaysByTrack: {
      ...account.riderOverlaysByTrack,
      ...global.riderOverlaysByTrack,
    },
    riderOverlayUpdatedAtByTrack: {
      ...account.riderOverlayUpdatedAtByTrack,
      ...global.riderOverlayUpdatedAtByTrack,
    },
  });
}

export async function readGlobalRaceViewPreferences() {
  const response = await fetch('/api/global-race-view', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Global race view returned ${response.status}`);
  }
  const payload = await response.json() as GlobalRaceViewPayload;
  return normalizeGlobalRaceView(payload.raceViewPreferences);
}

export async function saveGlobalRaceViewPreferences(preferences: RaceViewPreferences) {
  const response = await fetch('/api/global-race-view', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raceViewPreferences: preferences }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Global race view save returned ${response.status}`);
  }
  const payload = await response.json() as GlobalRaceViewPayload;
  const normalized = normalizeGlobalRaceView(payload.raceViewPreferences);
  if (!normalized) {
    throw new Error('Global race view save returned no camera layout.');
  }
  return normalized;
}
