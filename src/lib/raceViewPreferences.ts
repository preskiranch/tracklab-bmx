import { raceViewPreferencesStorageKey } from '../data';
import type {
  DemoRiderNames,
  DemoRiderPhotos,
  EarthCamera,
  RaceCommentaryPreferences,
  RaceCommentaryVoicePreset,
  RaceRiderOverlayLayout,
  RaceViewPreferences,
} from '../types';
import { safeSetLocalStorage } from './browserStorage';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';

export const defaultRaceRiderOverlayLayout: RaceRiderOverlayLayout = {
  xPct: 0.04,
  yPct: 0.52,
  width: 940,
  height: 420,
  locked: false,
};

export const defaultRaceCommentaryPreferences: RaceCommentaryPreferences = {
  enabled: true,
  ambientEnabled: true,
  ambientVolume: 0.065,
  ambientVolumeLocked: true,
  voicePreset: 'american-man',
  volume: 0.9,
  adaptiveMemory: true,
  recentLines: [],
};

const demoRiderIds = [1, 2, 3, 4] as const;

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedRevision(value: unknown) {
  return Math.max(0, finiteNumber(value, 0));
}

function normalizedCamera(value: unknown): EarthCamera | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const camera = value as Partial<EarthCamera>;
  const center = camera.center
    && Number.isFinite(camera.center.lat)
    && Number.isFinite(camera.center.lng)
    ? { lat: camera.center.lat, lng: camera.center.lng }
    : undefined;
  const zoom = Number.isFinite(camera.zoom) ? camera.zoom : undefined;
  return {
    angle: Math.max(0, Math.min(67, finiteNumber(camera.angle, 0))),
    heading: ((finiteNumber(camera.heading, 0) % 360) + 360) % 360,
    ...(center ? { center } : {}),
    ...(zoom != null ? { zoom } : {}),
    updatedAt: normalizedRevision(camera.updatedAt),
  };
}

export function normalizeRaceRiderOverlayLayout(value: unknown): RaceRiderOverlayLayout {
  const layout = value && typeof value === 'object'
    ? value as Partial<RaceRiderOverlayLayout>
    : {};
  return {
    xPct: Math.max(0, Math.min(1, finiteNumber(layout.xPct, defaultRaceRiderOverlayLayout.xPct))),
    yPct: Math.max(0, Math.min(1, finiteNumber(layout.yPct, defaultRaceRiderOverlayLayout.yPct))),
    width: Math.max(320, Math.min(1800, finiteNumber(layout.width, defaultRaceRiderOverlayLayout.width))),
    height: Math.max(360, Math.min(900, finiteNumber(layout.height, defaultRaceRiderOverlayLayout.height))),
    locked: Boolean(layout.locked),
  };
}

export function normalizeRaceCommentaryPreferences(value: unknown): RaceCommentaryPreferences {
  const preferences = value && typeof value === 'object'
    ? value as Partial<RaceCommentaryPreferences>
    : {};
  const voicePreset: RaceCommentaryVoicePreset = 'american-man';
  const recentLines = Array.isArray(preferences.recentLines)
    ? preferences.recentLines
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.trim().replace(/\s+/g, ' ').slice(0, 220))
      .filter(Boolean)
      .slice(-240)
    : [];

  return {
    enabled: preferences.enabled == null
      ? defaultRaceCommentaryPreferences.enabled
      : Boolean(preferences.enabled),
    ambientEnabled: preferences.ambientEnabled == null
      ? defaultRaceCommentaryPreferences.ambientEnabled
      : Boolean(preferences.ambientEnabled),
    ambientVolume: Math.max(0, Math.min(0.2, finiteNumber(
      preferences.ambientVolume,
      defaultRaceCommentaryPreferences.ambientVolume,
    ))),
    ambientVolumeLocked: preferences.ambientVolumeLocked == null
      ? defaultRaceCommentaryPreferences.ambientVolumeLocked
      : Boolean(preferences.ambientVolumeLocked),
    voicePreset,
    volume: defaultRaceCommentaryPreferences.volume,
    adaptiveMemory: true,
    recentLines,
  };
}

export function normalizeDemoRiderNames(value: unknown): DemoRiderNames {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const candidates = value as Record<string, unknown>;
  return Object.fromEntries(
    demoRiderIds.flatMap((playerId) => {
      const candidate = candidates[playerId];
      if (typeof candidate !== 'string') {
        return [];
      }

      const name = candidate.trim().replace(/\s+/g, ' ').slice(0, 64);
      return name ? [[playerId, name]] : [];
    }),
  ) as DemoRiderNames;
}

export function normalizeDemoRiderPhotos(value: unknown): DemoRiderPhotos {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const candidates = value as Record<string, unknown>;
  return Object.fromEntries(
    demoRiderIds.flatMap((playerId) => {
      const photoUrl = normalizeRiderPhotoDataUrl(candidates[playerId]);
      return photoUrl ? [[playerId, photoUrl]] : [];
    }),
  ) as DemoRiderPhotos;
}

export function normalizeRaceViewPreferences(
  value: unknown,
  fallbackCameras: Record<string, EarthCamera> = {},
): RaceViewPreferences {
  const preferences = value && typeof value === 'object'
    ? value as Partial<RaceViewPreferences>
    : {};
  const cameraCandidates = preferences.earthCamerasByTrack
    && typeof preferences.earthCamerasByTrack === 'object'
    ? preferences.earthCamerasByTrack
    : fallbackCameras;
  const overlayCandidates = preferences.riderOverlaysByTrack
    && typeof preferences.riderOverlaysByTrack === 'object'
    ? preferences.riderOverlaysByTrack
    : {};
  const overlayRevisionCandidates = preferences.riderOverlayUpdatedAtByTrack
    && typeof preferences.riderOverlayUpdatedAtByTrack === 'object'
    ? preferences.riderOverlayUpdatedAtByTrack
    : {};

  return {
    cameraLocked: Boolean(preferences.cameraLocked),
    cameraLockedUpdatedAt: normalizedRevision(preferences.cameraLockedUpdatedAt),
    earthCamerasByTrack: Object.fromEntries(
      Object.entries(cameraCandidates)
        .flatMap(([trackId, camera]) => {
          const normalized = normalizedCamera(camera);
          return trackId.trim() && normalized ? [[trackId, normalized]] : [];
        }),
    ),
    riderOverlaysByTrack: Object.fromEntries(
      Object.entries(overlayCandidates)
        .filter(([trackId]) => trackId.trim().length > 0)
        .map(([trackId, layout]) => [trackId, normalizeRaceRiderOverlayLayout(layout)]),
    ),
    riderOverlayUpdatedAtByTrack: Object.fromEntries(
      Object.entries(overlayRevisionCandidates)
        .filter(([trackId]) => trackId.trim().length > 0)
        .map(([trackId, updatedAt]) => [trackId, normalizedRevision(updatedAt)]),
    ),
    demoRiderNames: normalizeDemoRiderNames(preferences.demoRiderNames),
    demoRiderNamesUpdatedAt: normalizedRevision(preferences.demoRiderNamesUpdatedAt),
    demoRiderPhotos: normalizeDemoRiderPhotos(preferences.demoRiderPhotos),
    demoRiderPhotosUpdatedAt: normalizedRevision(preferences.demoRiderPhotosUpdatedAt),
    commentary: normalizeRaceCommentaryPreferences(preferences.commentary),
    commentaryUpdatedAt: normalizedRevision(preferences.commentaryUpdatedAt),
  };
}

function mergeRevisionedRecords<T>(
  current: Record<string, T>,
  incoming: Record<string, T>,
  revisionFor: (key: string, value: T, source: 'current' | 'incoming') => number,
) {
  const merged = { ...current };
  Object.entries(incoming).forEach(([key, value]) => {
    const currentValue = current[key];
    if (
      currentValue === undefined
      || revisionFor(key, value, 'incoming') >= revisionFor(key, currentValue, 'current')
    ) {
      merged[key] = value;
    }
  });
  return merged;
}

/**
 * Combines a local snapshot with a cloud snapshot without allowing an older
 * write from either browser to erase a newer per-track or per-setting change.
 * Equal legacy revisions prefer the incoming (cloud) snapshot.
 */
export function mergeRaceViewPreferences(
  currentValue: unknown,
  incomingValue: unknown,
): RaceViewPreferences {
  const current = normalizeRaceViewPreferences(currentValue);
  const incoming = normalizeRaceViewPreferences(incomingValue);
  const cameraLockedFromIncoming = incoming.cameraLockedUpdatedAt >= current.cameraLockedUpdatedAt;
  const namesFromIncoming = incoming.demoRiderNamesUpdatedAt >= current.demoRiderNamesUpdatedAt;
  const photosFromIncoming = incoming.demoRiderPhotosUpdatedAt >= current.demoRiderPhotosUpdatedAt;
  const commentaryFromIncoming = incoming.commentaryUpdatedAt >= current.commentaryUpdatedAt;
  const riderOverlayUpdatedAtByTrack = Object.fromEntries(
    [...new Set([
      ...Object.keys(current.riderOverlayUpdatedAtByTrack),
      ...Object.keys(incoming.riderOverlayUpdatedAtByTrack),
    ])].map((trackId) => [
      trackId,
      Math.max(
        current.riderOverlayUpdatedAtByTrack[trackId] ?? 0,
        incoming.riderOverlayUpdatedAtByTrack[trackId] ?? 0,
      ),
    ]),
  );

  return normalizeRaceViewPreferences({
    cameraLocked: cameraLockedFromIncoming ? incoming.cameraLocked : current.cameraLocked,
    cameraLockedUpdatedAt: Math.max(current.cameraLockedUpdatedAt, incoming.cameraLockedUpdatedAt),
    earthCamerasByTrack: mergeRevisionedRecords(
      current.earthCamerasByTrack,
      incoming.earthCamerasByTrack,
      (_key, camera) => camera.updatedAt,
    ),
    riderOverlaysByTrack: mergeRevisionedRecords(
      current.riderOverlaysByTrack,
      incoming.riderOverlaysByTrack,
      (trackId, _layout, source) => (
        source === 'incoming'
          ? incoming.riderOverlayUpdatedAtByTrack[trackId] ?? 0
          : current.riderOverlayUpdatedAtByTrack[trackId] ?? 0
      ),
    ),
    riderOverlayUpdatedAtByTrack,
    demoRiderNames: namesFromIncoming ? incoming.demoRiderNames : current.demoRiderNames,
    demoRiderNamesUpdatedAt: Math.max(
      current.demoRiderNamesUpdatedAt,
      incoming.demoRiderNamesUpdatedAt,
    ),
    demoRiderPhotos: photosFromIncoming ? incoming.demoRiderPhotos : current.demoRiderPhotos,
    demoRiderPhotosUpdatedAt: Math.max(
      current.demoRiderPhotosUpdatedAt,
      incoming.demoRiderPhotosUpdatedAt,
    ),
    commentary: commentaryFromIncoming ? incoming.commentary : current.commentary,
    commentaryUpdatedAt: Math.max(current.commentaryUpdatedAt, incoming.commentaryUpdatedAt),
  });
}

export function raceViewPreferencesMatch(left: unknown, right: unknown) {
  return JSON.stringify(normalizeRaceViewPreferences(left))
    === JSON.stringify(normalizeRaceViewPreferences(right));
}

function profileStorageKey(profileKey: string) {
  return `${raceViewPreferencesStorageKey}:${encodeURIComponent(profileKey)}`;
}

export function readStoredRaceViewPreferences(
  profileKey: string,
  fallbackCameras: Record<string, EarthCamera> = {},
) {
  if (typeof window === 'undefined') {
    return normalizeRaceViewPreferences(null, fallbackCameras);
  }

  try {
    const stored = window.localStorage.getItem(profileStorageKey(profileKey));
    return normalizeRaceViewPreferences(stored ? JSON.parse(stored) : null, fallbackCameras);
  } catch {
    return normalizeRaceViewPreferences(null, fallbackCameras);
  }
}

export function writeStoredRaceViewPreferences(profileKey: string, preferences: RaceViewPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  safeSetLocalStorage(
    profileStorageKey(profileKey),
    JSON.stringify(normalizeRaceViewPreferences(preferences)),
  );
}
