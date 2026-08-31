import type { RaceViewPreferences } from '../types';
import { normalizeRaceViewPreferences } from './raceViewPreferences';

type GlobalRaceViewPayload = {
  raceViewPreferences?: RaceViewPreferences | null;
};

type ApplyGlobalRaceViewOptions = {
  /**
   * A developer may have a newer locked edit saved locally/cloud-side while
   * the global PATCH is offline. Keep only those publishable entries visible
   * until the retry succeeds; ordinary clients still receive the global view
   * unconditionally.
   */
  preserveNewerLockedAccountEntries?: boolean;
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
  options: ApplyGlobalRaceViewOptions = {},
) {
  const account = normalizeRaceViewPreferences(accountPreferences);
  if (!globalPreferences) {
    return account;
  }
  const global = normalizeRaceViewPreferences(globalPreferences);
  const applied = normalizeRaceViewPreferences({
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

  if (!options.preserveNewerLockedAccountEntries) {
    return applied;
  }

  const newerLockedCameras = account.cameraLocked
    ? Object.fromEntries(Object.entries(account.earthCamerasByTrack).filter(([trackId, camera]) => (
        camera.updatedAt > (global.earthCamerasByTrack[trackId]?.updatedAt ?? -1)
      )))
    : {};
  const newerLockedOverlays = Object.fromEntries(
    Object.entries(account.riderOverlaysByTrack).filter(([trackId, layout]) => (
      layout.locked
      && (account.riderOverlayUpdatedAtByTrack[trackId] ?? 0)
        > (global.riderOverlayUpdatedAtByTrack[trackId] ?? -1)
    )),
  );
  const newerLockedOverlayRevisions = Object.fromEntries(
    Object.keys(newerLockedOverlays).map((trackId) => [
      trackId,
      account.riderOverlayUpdatedAtByTrack[trackId] ?? 0,
    ]),
  );

  return normalizeRaceViewPreferences({
    ...applied,
    earthCamerasByTrack: {
      ...applied.earthCamerasByTrack,
      ...newerLockedCameras,
    },
    riderOverlaysByTrack: {
      ...applied.riderOverlaysByTrack,
      ...newerLockedOverlays,
    },
    riderOverlayUpdatedAtByTrack: {
      ...applied.riderOverlayUpdatedAtByTrack,
      ...newerLockedOverlayRevisions,
    },
  });
}

export function globalRaceViewNeedsPublication(
  accountPreferences: RaceViewPreferences,
  globalPreferences: RaceViewPreferences | null,
) {
  const account = normalizeRaceViewPreferences(accountPreferences);
  const global = globalPreferences ? normalizeRaceViewPreferences(globalPreferences) : null;
  const hasNewerLockedCamera = account.cameraLocked
    && Object.entries(account.earthCamerasByTrack).some(([trackId, camera]) => (
      camera.updatedAt > (global?.earthCamerasByTrack[trackId]?.updatedAt ?? -1)
    ));
  const hasNewerLockedOverlay = Object.entries(account.riderOverlaysByTrack)
    .some(([trackId, layout]) => (
      layout.locked
      && (account.riderOverlayUpdatedAtByTrack[trackId] ?? 0)
        > (global?.riderOverlayUpdatedAtByTrack[trackId] ?? -1)
    ));
  return hasNewerLockedCamera || hasNewerLockedOverlay;
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
    throw new Error('Global race view save returned no track presentation.');
  }
  return normalized;
}
