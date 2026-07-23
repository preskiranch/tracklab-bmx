import { raceViewPreferencesStorageKey } from '../data';
import type {
  DemoRiderNames,
  EarthCamera,
  RaceCommentaryModel,
  RaceCommentaryPreferences,
  RaceCommentaryVoicePreset,
  RaceRiderOverlayLayout,
  RaceViewPreferences,
} from '../types';
import { safeSetLocalStorage } from './browserStorage';

export const defaultRaceRiderOverlayLayout: RaceRiderOverlayLayout = {
  xPct: 0.04,
  yPct: 0.7,
  width: 940,
  height: 220,
  locked: false,
};

export const defaultRaceCommentaryPreferences: RaceCommentaryPreferences = {
  enabled: true,
  model: 'gpt-5.6-terra',
  voicePreset: 'australian-woman',
  volume: 0.9,
  adaptiveMemory: true,
  recentLines: [],
};

const commentaryModels = new Set<RaceCommentaryModel>([
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
]);
const commentaryVoices = new Set<RaceCommentaryVoicePreset>([
  'australian-woman',
  'australian-man',
  'american-woman',
  'american-man',
  'british-woman',
  'british-man',
]);
const demoRiderIds = [1, 2, 3, 4] as const;

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    updatedAt: Math.max(0, finiteNumber(camera.updatedAt, Date.now())),
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
    height: Math.max(190, Math.min(900, finiteNumber(layout.height, defaultRaceRiderOverlayLayout.height))),
    locked: Boolean(layout.locked),
  };
}

export function normalizeRaceCommentaryPreferences(value: unknown): RaceCommentaryPreferences {
  const preferences = value && typeof value === 'object'
    ? value as Partial<RaceCommentaryPreferences>
    : {};
  const model = commentaryModels.has(preferences.model as RaceCommentaryModel)
    ? preferences.model as RaceCommentaryModel
    : defaultRaceCommentaryPreferences.model;
  const voicePreset = commentaryVoices.has(preferences.voicePreset as RaceCommentaryVoicePreset)
    ? preferences.voicePreset as RaceCommentaryVoicePreset
    : defaultRaceCommentaryPreferences.voicePreset;
  const recentLines = Array.isArray(preferences.recentLines)
    ? preferences.recentLines
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.trim().replace(/\s+/g, ' ').slice(0, 220))
      .filter(Boolean)
      .slice(-24)
    : [];

  return {
    enabled: preferences.enabled == null
      ? defaultRaceCommentaryPreferences.enabled
      : Boolean(preferences.enabled),
    model,
    voicePreset,
    volume: Math.max(0, Math.min(1, finiteNumber(
      preferences.volume,
      defaultRaceCommentaryPreferences.volume,
    ))),
    adaptiveMemory: preferences.adaptiveMemory == null
      ? defaultRaceCommentaryPreferences.adaptiveMemory
      : Boolean(preferences.adaptiveMemory),
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

  return {
    cameraLocked: Boolean(preferences.cameraLocked),
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
    demoRiderNames: normalizeDemoRiderNames(preferences.demoRiderNames),
    commentary: normalizeRaceCommentaryPreferences(preferences.commentary),
  };
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
