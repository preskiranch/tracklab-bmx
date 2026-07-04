import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bike,
  Bluetooth,
  Database,
  Gauge,
  Globe2,
  MapPinned,
  Plus,
  PlayCircle,
  Radio,
  Route,
  Settings,
  StopCircle,
  Usb,
  Users,
} from 'lucide-react';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { DiagnosticsPanel, type CloudUserDataStatus } from './components/DiagnosticsPanel';
import { EarthTrackView } from './components/EarthTrackView';
import { type ChatMessage, MultiplayerPanel } from './components/MultiplayerPanel';
import { MonitorView } from './components/MonitorView';
import { PairingRail } from './components/PairingRail';
import { SessionControlPanel } from './components/SessionControlPanel';
import {
  bikeProfilesStorageKey,
  customRoutesStorageKey,
  defaultPlayerSlots,
  distanceUnitStorageKey,
  earthCameraStorageKey,
  liveBikeTimeoutMs,
  maxPlayers,
  raceCaptureStorageKey,
  speedUnitStorageKey,
  storageKey,
} from './data';
import { countriesForCatalog, statesForCountry, trackCatalog, tracksForLocation } from './data/trackCatalog';
import {
  playStartGateTone,
  playUciRandomStartVoice,
  primeAudioCues,
  stopStartGateAudio,
  uciVoiceWatchGateOffsetMs,
} from './lib/audioCues';
import {
  applyUserTrackMapping,
  createUserTrackMapping,
  distanceBetweenTrackPoints,
  nearestRouteMeter,
  parseUserTrackMapping,
  pointAtRouteMeter,
  draftRouteFromMapping,
  readStoredTrackMappings,
  routeLengthWithDefaultSplitBranches,
  routeLengthMeters,
  routeVariantsFromMapping,
  routeWithDefaultSplitBranches,
  splitBranchLabels,
  splitDecisionPointsForRoute,
  writeStoredTrackMappings,
  type StoredTrackMappings,
  zoneBoundariesFromRouteVariant,
} from './lib/trackMapping';
import {
  fetchLocationPredictions,
  hasGoogleMapsApiKey,
  resetPlaceAutocompleteSession,
  resolveLocationText,
  resolvePlacePrediction,
  trackBoundsPoints,
  trackCenter,
  type PlacePredictionOption,
} from './lib/googleMaps';
import { patchBridgeUserData, readBridgeUserData } from './lib/localBridgeStore';
import { patchCloudUserData, readCloudUserData } from './lib/cloudUserData';
import { createInitialRiders } from './game/physics';
import { useRaceEngine } from './hooks/useRaceEngine';
import { useBluetoothBikes } from './hooks/useBluetoothBikes';
import { createDemoPlayers, useDemoBikes } from './hooks/useDemoBikes';
import { useMultiplayer } from './hooks/useMultiplayer';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import { useZoneAudioCues } from './hooks/useZoneAudioCues';
import type {
  AppMode,
  BikeProfile,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  IntervalMode,
  LeaderboardEntry,
  LeaderboardMetric,
  MappingEditMode,
  MetricKey,
  MultiplayerRaceState,
  PlayerSlot,
  PlayMode,
  RaceCapture,
  ReactionTimesByPlayer,
  SessionMode,
  SpeedUnit,
  StartCadenceMode,
  TrackPoint,
  TrackRecord,
  TrackRouteVariantId,
  TrackSplitBranch,
  TrackSplitSection,
  UserTrackMapping,
} from './types';

const defaultTrack = trackCatalog.find((track) => track.id === 'chula-vista-elite-bmx') ?? trackCatalog[0];
const uciRandomDelayMinMs = 100;
const uciRandomDelayMaxMs = 2700;
const customRouteInitialZoom = 18;
const customRouteInitialAngle = 0;
const customRouteInitialHeading = 0;

type BikeConnectionSource = 'bluetooth' | 'advanced' | 'demo';
type SplitBranchId = TrackSplitBranch['id'];
type RaceRouteVariantId = TrackRouteVariantId;
type CustomRoutePreview = {
  input: string;
  label?: string;
  point: TrackPoint;
  route: TrackRecord;
  camera: EarthCamera;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function releaseBrowserFullscreen() {
  const fullscreenDocument = document as FullscreenDocument;
  if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement) {
    return;
  }

  const exitFullscreen = document.exitFullscreen ?? fullscreenDocument.webkitExitFullscreen;
  if (!exitFullscreen) {
    return;
  }

  try {
    Promise.resolve(exitFullscreen.call(document)).catch(() => undefined);
  } catch {
    // Ignore browser-level fullscreen refusal so race reset/cancel can continue.
  }
}

function randomIntegerInclusive(minimum: number, maximum: number) {
  const min = Math.ceil(minimum);
  const max = Math.floor(maximum);
  if (max <= min) {
    return min;
  }

  const range = max - min + 1;
  const cryptoApi = window.crypto;
  if (cryptoApi?.getRandomValues) {
    const maxUnbiased = Math.floor(0x100000000 / range) * range;
    const value = new Uint32Array(1);

    do {
      cryptoApi.getRandomValues(value);
    } while (value[0] >= maxUnbiased);

    return min + (value[0] % range);
  }

  return min + Math.floor(Math.random() * range);
}

function createDraftTrackSplit(index: number): DraftTrackSplit {
  const createdAt = Date.now();
  return {
    id: `split-${index}-${createdAt.toString(36)}`,
    index,
    splitPoint: null,
    mergePoint: null,
    activeBranch: 'a',
    branchA: [],
    branchB: [],
  };
}

const splitBranchMinInteriorPoints = 2;
const splitBranchEndpointSnapMeters = 8;
const routePointDuplicateMeters = 0.75;
const mainRouteSplitSnapMeters = 1;
const mainRouteMergeResumeHoldMeters = 5;

function appendTrackPoint(points: TrackPoint[], point: TrackPoint, minDistanceMeters = routePointDuplicateMeters) {
  const previous = points[points.length - 1];
  if (previous && distanceBetweenTrackPoints(previous, point) < minDistanceMeters) {
    return points;
  }

  return [...points, point];
}

function branchWithEndpoints(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint | null) {
  const next = [...points];

  if (next.length === 0 || distanceBetweenTrackPoints(next[0], splitPoint) > 0.5) {
    next.unshift(splitPoint);
  }

  if (mergePoint && distanceBetweenTrackPoints(next[next.length - 1], mergePoint) > 0.5) {
    next.push(mergePoint);
  }

  return next;
}

function branchInteriorPoints(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint | null) {
  return points.filter((point) => {
    if (distanceBetweenTrackPoints(point, splitPoint) <= 0.5) {
      return false;
    }

    return !mergePoint || distanceBetweenTrackPoints(point, mergePoint) > 0.5;
  });
}

function branchTouchesMerge(points: TrackPoint[], mergePoint: TrackPoint | null) {
  return Boolean(mergePoint && points.some((point) => (
    distanceBetweenTrackPoints(point, mergePoint) <= splitBranchEndpointSnapMeters
  )));
}

function branchIsComplete(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint | null) {
  return branchInteriorPoints(points, splitPoint, mergePoint).length >= splitBranchMinInteriorPoints
    && branchTouchesMerge(points, mergePoint);
}

function snapBranchEndpoint(point: TrackPoint, splitPoint: TrackPoint, mergePoint: TrackPoint) {
  if (distanceBetweenTrackPoints(point, splitPoint) <= splitBranchEndpointSnapMeters) {
    return splitPoint;
  }

  if (distanceBetweenTrackPoints(point, mergePoint) <= splitBranchEndpointSnapMeters) {
    return mergePoint;
  }

  return point;
}

function splitSectionFromDraft(draft: DraftTrackSplit): TrackSplitSection | null {
  if (!draft.splitPoint || !draft.mergePoint) {
    return null;
  }

  if (
    !branchIsComplete(draft.branchA, draft.splitPoint, draft.mergePoint)
    || !branchIsComplete(draft.branchB, draft.splitPoint, draft.mergePoint)
  ) {
    return null;
  }

  const branchA = branchWithEndpoints(draft.branchA, draft.splitPoint, draft.mergePoint);
  const branchB = branchWithEndpoints(draft.branchB, draft.splitPoint, draft.mergePoint);
  if (branchA.length < 2 || branchB.length < 2) {
    return null;
  }

  return {
    id: draft.id,
    index: draft.index,
    name: `Split ${draft.index} / Merge ${draft.index}`,
    splitPoint: draft.splitPoint,
    mergePoint: draft.mergePoint,
    branches: [
      {
        id: 'a',
        name: splitBranchLabels.a,
        points: branchA,
        lengthMeters: Math.round(routeLengthMeters(branchA)),
      },
      {
        id: 'b',
        name: splitBranchLabels.b,
        points: branchB,
        lengthMeters: Math.round(routeLengthMeters(branchB)),
      },
    ],
  };
}

function splitSectionPreviewFromDraft(draft: DraftTrackSplit): TrackSplitSection | null {
  if (!draft.splitPoint || !draft.mergePoint) {
    return null;
  }

  const branchA = branchWithEndpoints(draft.branchA, draft.splitPoint, draft.mergePoint);
  const branchB = branchWithEndpoints(draft.branchB, draft.splitPoint, draft.mergePoint);

  return {
    id: draft.id,
    index: draft.index,
    name: `Split ${draft.index} / Merge ${draft.index}`,
    splitPoint: draft.splitPoint,
    mergePoint: draft.mergePoint,
    branches: [
      {
        id: 'a',
        name: splitBranchLabels.a,
        points: branchA,
        lengthMeters: Math.round(routeLengthMeters(branchA)),
      },
      {
        id: 'b',
        name: splitBranchLabels.b,
        points: branchB,
        lengthMeters: Math.round(routeLengthMeters(branchB)),
      },
    ],
  };
}

function readRequestedTrackId() {
  try {
    const requestedTrackId = new URLSearchParams(window.location.search).get('track')?.trim();
    return requestedTrackId ? requestedTrackId : null;
  } catch {
    return null;
  }
}

function findInitialTrack(requestedTrackId: string | null, customRoutes: TrackRecord[] = []) {
  return [...trackCatalog, ...customRoutes].find((track) => track.id === requestedTrackId) ?? defaultTrack;
}

function readStoredCustomRoutes(): TrackRecord[] {
  try {
    const stored = window.localStorage.getItem(customRoutesStorageKey);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as TrackRecord[];
    return Array.isArray(parsed)
      ? parsed.filter((track) => track.id && track.name && Number.isFinite(track.latitude) && Number.isFinite(track.longitude))
      : [];
  } catch {
    return [];
  }
}

function writeStoredCustomRoutes(routes: TrackRecord[]) {
  window.localStorage.setItem(customRoutesStorageKey, JSON.stringify(routes));
}

const defaultEarthCamera = {
  angle: 45,
  heading: 0,
} as const;

function normalizeEarthAngle(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(67, Math.round(numeric))) : defaultEarthCamera.angle;
}

function normalizeEarthHeading(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? ((Math.round(numeric) % 360) + 360) % 360 : defaultEarthCamera.heading;
}

function normalizeEarthZoom(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(2, Math.min(22, Number(numeric.toFixed(2)))) : undefined;
}

function normalizeEarthCenter(value: unknown): TrackPoint | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const point = value as Partial<TrackPoint>;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

function normalizeEarthCamera(value: Partial<EarthCamera> | unknown): EarthCamera {
  const camera = value && typeof value === 'object' ? value as Partial<EarthCamera> : {};
  const center = normalizeEarthCenter(camera.center);
  const zoom = normalizeEarthZoom(camera.zoom);

  return {
    angle: normalizeEarthAngle(camera.angle),
    heading: normalizeEarthHeading(camera.heading),
    ...(center ? { center } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
    updatedAt: Number.isFinite(camera.updatedAt) ? Number(camera.updatedAt) : Date.now(),
  };
}

function earthCamerasMatch(left: EarthCamera | undefined, right: EarthCamera) {
  const leftHasCenter = Boolean(left?.center);
  const rightHasCenter = Boolean(right.center);
  const leftHasZoom = typeof left?.zoom === 'number';
  const rightHasZoom = typeof right.zoom === 'number';

  return Boolean(left)
    && left?.angle === right.angle
    && left.heading === right.heading
    && leftHasZoom === rightHasZoom
    && Math.abs((left.zoom ?? -1) - (right.zoom ?? -1)) < 0.01
    && leftHasCenter === rightHasCenter
    && Math.abs((left.center?.lat ?? 0) - (right.center?.lat ?? 0)) < 0.0000001
    && Math.abs((left.center?.lng ?? 0) - (right.center?.lng ?? 0)) < 0.0000001;
}

function cameraCenterBelongsToTrack(camera: Partial<EarthCamera>, track: TrackRecord) {
  if (!camera.center) {
    return true;
  }

  const routePoints = trackBoundsPoints(track);
  if (routePoints.length === 0) {
    return true;
  }

  const nearestRoutePointMeters = Math.min(
    ...routePoints.map((point) => distanceBetweenTrackPoints(camera.center!, point)),
  );
  const allowedOffsetMeters = Math.max(750, track.lengthMeters * 2.5);
  return nearestRoutePointMeters <= allowedOffsetMeters;
}

function readStoredEarthCameras(): Record<string, EarthCamera> {
  try {
    const stored = window.localStorage.getItem(earthCameraStorageKey);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([trackId]) => trackId.trim().length > 0)
        .map(([trackId, camera]) => [trackId, normalizeEarthCamera(camera)]),
    );
  } catch {
    return {};
  }
}

function writeStoredEarthCameras(cameras: Record<string, EarthCamera>) {
  window.localStorage.setItem(earthCameraStorageKey, JSON.stringify(cameras));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'custom-route';
}

function customRouteOutline(center: TrackPoint): TrackPoint[] {
  const offset = 0.0012;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat - offset, lng: center.lng + offset },
    { lat: center.lat + offset, lng: center.lng + offset },
    { lat: center.lat + offset, lng: center.lng - offset },
    { lat: center.lat - offset, lng: center.lng - offset },
  ];
}

function createCustomRouteRecord(name: string, locationLabel: string | undefined, point: TrackPoint): TrackRecord {
  const createdAt = Date.now();

  return {
    id: `custom-${slugify(name)}-${createdAt.toString(36)}`,
    name,
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'Personal',
    region: 'Personal',
    source: 'Custom',
    sourceUrl: 'local://custom-route',
    address: locationLabel,
    latitude: point.lat,
    longitude: point.lng,
    lengthMeters: 1000,
    elevationMeters: 0,
    surface: 'Custom ride route',
    outline: customRouteOutline(point),
    routeStatus: 'locator-only',
    zones: [],
    leaderboards: {
      rpm: [],
      speed: [],
      watts: [],
    },
  };
}

function createCustomRoutePreviewRecord(name: string, locationLabel: string | undefined, point: TrackPoint): TrackRecord {
  return {
    ...createCustomRouteRecord(name, locationLabel, point),
    id: `custom-preview-${slugify(name)}-${Date.now().toString(36)}`,
  };
}

function isCustomRoutePreviewId(trackId: string) {
  return trackId.startsWith('custom-preview-');
}

function profileVisual(index: number) {
  return defaultPlayerSlots[index % defaultPlayerSlots.length] ?? defaultPlayerSlots[0];
}

function isPlayerColorName(value: unknown): value is PlayerSlot['colorName'] {
  return value === 'lime' || value === 'red' || value === 'blue' || value === 'yellow';
}

function defaultBikeName(deviceId: number) {
  return `Bike ${deviceId}`;
}

function createBikeProfile(deviceId: number, index: number, name = defaultBikeName(deviceId)): BikeProfile {
  const visual = profileVisual(index);
  return {
    deviceId,
    name,
    colorName: visual.colorName,
    accent: visual.accent,
    updatedAt: Date.now(),
  };
}

function normalizeBikeProfile(value: unknown, index: number): BikeProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const profile = value as Partial<BikeProfile>;
  const deviceId = Number(profile.deviceId);
  if (!Number.isFinite(deviceId) || deviceId <= 0) {
    return null;
  }

  const visual = profileVisual(index);
  const name = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim().slice(0, 64)
    : defaultBikeName(deviceId);

  return {
    deviceId,
    name,
    colorName: isPlayerColorName(profile.colorName) ? profile.colorName : visual.colorName,
    accent: typeof profile.accent === 'string' && profile.accent.trim() ? profile.accent : visual.accent,
    updatedAt: Number.isFinite(profile.updatedAt) ? Number(profile.updatedAt) : Date.now(),
  };
}

function dedupeBikeProfiles(profiles: BikeProfile[]) {
  const byDevice = new Map<number, BikeProfile>();
  profiles.forEach((profile, index) => {
    const normalized = normalizeBikeProfile(profile, index);
    if (!normalized) {
      return;
    }

    const current = byDevice.get(normalized.deviceId);
    if (!current || normalized.updatedAt >= current.updatedAt) {
      byDevice.set(normalized.deviceId, normalized);
    }
  });

  return [...byDevice.values()].sort((a, b) => a.deviceId - b.deviceId);
}

function mergeBikeProfiles(localProfiles: BikeProfile[], bridgeProfiles: BikeProfile[]) {
  return dedupeBikeProfiles([...localProfiles, ...bridgeProfiles]);
}

function mergeCustomRoutes(localRoutes: TrackRecord[], bridgeRoutes: TrackRecord[]) {
  const byId = new Map<string, TrackRecord>();
  [...localRoutes, ...bridgeRoutes].forEach((route) => {
    if (route?.id) {
      byId.set(route.id, route);
    }
  });
  return [...byId.values()];
}

function readStoredBikeProfiles(): BikeProfile[] {
  try {
    const storedProfiles = window.localStorage.getItem(bikeProfilesStorageKey);
    if (storedProfiles) {
      const parsedProfiles = JSON.parse(storedProfiles) as BikeProfile[];
      return Array.isArray(parsedProfiles) ? dedupeBikeProfiles(parsedProfiles) : [];
    }

    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as Array<Pick<PlayerSlot, 'id' | 'deviceId'>>;
    return dedupeBikeProfiles(parsed
      .filter((item) => item.deviceId != null)
      .map((item, index) => createBikeProfile(Number(item.deviceId), index, `Player ${item.id}`)));
  } catch {
    return [];
  }
}

function writeStoredBikeProfiles(profiles: BikeProfile[]) {
  window.localStorage.setItem(bikeProfilesStorageKey, JSON.stringify(dedupeBikeProfiles(profiles)));
}

function readStoredSpeedUnit(): SpeedUnit {
  return window.localStorage.getItem(speedUnitStorageKey) === 'mph' ? 'mph' : 'kph';
}

function readStoredDistanceUnit(): DistanceUnit {
  const stored = window.localStorage.getItem(distanceUnitStorageKey);
  return stored === 'm' || stored === 'km' ? 'm' : 'ft';
}

function downloadTrackMapping(mapping: UserTrackMapping) {
  const blob = new Blob([JSON.stringify(mapping, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${mapping.trackId}-tracklab-mapping.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readStoredRaceCapture(): RaceCapture | null {
  try {
    const stored = window.localStorage.getItem(raceCaptureStorageKey);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as RaceCapture;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function safeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'track';
}

function raceCaptureFilename(capture: RaceCapture, extension: 'json' | 'csv') {
  const date = new Date(capture.createdAt).toISOString().replace(/[:.]/g, '-');
  return `${safeFilenamePart(capture.track.name)}-${date}-race-capture.${extension}`;
}

function csvValue(value: unknown) {
  if (value == null) {
    return '';
  }

  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function raceCaptureToCsv(capture: RaceCapture) {
  const headers = [
    'recordType',
    'sessionId',
    'track',
    'playerId',
    'riderName',
    'deviceId',
    'deviceLabel',
    'source',
    'sampleAtIso',
    'elapsedMs',
    'watts',
    'cadenceRpm',
    'speedKph',
    'speedSource',
    'wattsAtIso',
    'cadenceAtIso',
    'speedAtIso',
    'signal',
    'battery',
    'riderDistanceMeters',
    'riderVelocityMps',
    'riderPhase',
    'rank',
    'finishTimeMs',
    'thirtyFootTimeMs',
    'topSpeedKph',
    'averageSpeedKph',
    'topCadence',
    'averageCadence',
    'topWatts',
    'averageWatts',
  ];

  const rows = capture.samples.map((sample) => [
    'sample',
    capture.sessionId,
    capture.track.name,
    sample.playerId,
    sample.riderName,
    sample.deviceId,
    sample.deviceLabel,
    sample.source,
    new Date(sample.at).toISOString(),
    sample.elapsedMs,
    sample.watts,
    sample.cadence,
    sample.speedKph,
    sample.speedSource,
    sample.wattsAt ? new Date(sample.wattsAt).toISOString() : '',
    sample.cadenceAt ? new Date(sample.cadenceAt).toISOString() : '',
    sample.speedAt ? new Date(sample.speedAt).toISOString() : '',
    sample.signal,
    sample.battery,
    sample.riderDistanceMeters,
    sample.riderVelocityMps,
    sample.riderPhase,
    sample.rank,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);

  const summaryRows = capture.summary.map((summary) => [
    'summary',
    capture.sessionId,
    capture.track.name,
    summary.playerId,
    summary.riderName,
    '',
    summary.deviceLabel,
    capture.source,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    summary.distanceMeters,
    '',
    '',
    summary.rank,
    summary.finishTimeMs,
    summary.thirtyFootTimeMs,
    summary.topSpeedKph,
    summary.averageSpeedKph,
    summary.topCadence,
    summary.averageCadence,
    summary.topWatts,
    summary.averageWatts,
  ]);

  return [headers, ...rows, ...summaryRows].map((row) => row.map(csvValue).join(',')).join('\n');
}

function formatClock() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type StartGateStatus = {
  active: boolean;
  label: string;
  detail: string;
  lightIndex: 0 | 1 | 2 | 3 | null;
};

type OutgoingMultiplayerRaceState = Omit<MultiplayerRaceState, 'clientId' | 'riderName' | 'roomId' | 'at'>;

const idleStartGateStatus: StartGateStatus = {
  active: false,
  label: '',
  detail: '',
  lightIndex: null,
};

const startTreeLabels = ['RED', 'YELLOW 1', 'YELLOW 2', 'GREEN'] as const;

function isReactionBikeSample(sample: { cadence: number | null; speedKph: number | null; watts: number }) {
  return (sample.cadence ?? 0) > 0 || (sample.speedKph ?? 0) > 0 || sample.watts > 0;
}

function isFalseStartBikeSample(sample: { cadence: number | null; speedKph: number | null; watts: number }) {
  return (sample.cadence ?? 0) >= 12 || (sample.speedKph ?? 0) >= 2 || sample.watts >= 35;
}

function isGoogleLocationPermissionError(message: string) {
  return /REQUEST_DENIED|blocked|not allowed|not authorized|places\.googleapis\.com|Geocoding Service/i.test(message);
}

function formatAutocompleteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isGoogleLocationPermissionError(message)) {
    return 'Google address suggestions are blocked for this API key. Enable Places API (new), then add it to this key\'s API restrictions.';
  }

  return message;
}

function formatRouteLocationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isGoogleLocationPermissionError(message)) {
    return 'Google address lookup is blocked for this API key. Enable Geocoding API and Places API (new), then add both to this key\'s API restrictions.';
  }

  return message;
}

export default function App() {
  const bridge = useWattbikeBridge();
  const bluetooth = useBluetoothBikes();
  const raceShellRef = useRef<HTMLDivElement | null>(null);
  const startGateTimeoutsRef = useRef<number[]>([]);
  const startGateSequenceIdRef = useRef(0);
  const startGateArmedAtRef = useRef<number | null>(null);
  const falseStartHandledRef = useRef(false);
  const capturedSampleKeysRef = useRef<Set<string>>(new Set());
  const bridgeUserDataLoadedRef = useRef(false);
  const cloudUserDataLoadedKeyRef = useRef<string | null>(null);
  const cloudUserDataAvailableRef = useRef(false);
  const roomTrackApplyRef = useRef<string | null>(null);
  const latestRaceSyncRef = useRef<OutgoingMultiplayerRaceState | null>(null);
  const customRoutePreviewRequestIdRef = useRef(0);
  const customRoutePreviewTrackIdRef = useRef<string | null>(null);
  const [initialRequestedTrackId] = useState(readRequestedTrackId);
  const [initialCustomRoutes] = useState<TrackRecord[]>(readStoredCustomRoutes);
  const pendingInitialTrackIdRef = useRef(initialRequestedTrackId);
  const [initialUrlTrackPending, setInitialUrlTrackPending] = useState(initialRequestedTrackId !== null);
  const [initialTrack] = useState(() => findInitialTrack(initialRequestedTrackId, initialCustomRoutes));
  const selectedTrackIdRef = useRef(initialTrack.id);
  const [baseCatalogTracks, setBaseCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [catalogDatabaseReady, setCatalogDatabaseReady] = useState(false);
  const [customRoutes, setCustomRoutes] = useState<TrackRecord[]>(initialCustomRoutes);
  const [storedMappings, setStoredMappings] = useState<StoredTrackMappings>(readStoredTrackMappings);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingFullscreen, setMappingFullscreen] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneMeters, setDraftZoneMeters] = useState<number[]>([]);
  const [draftSplitSections, setDraftSplitSections] = useState<TrackSplitSection[]>([]);
  const [draftSplitBuilder, setDraftSplitBuilder] = useState<DraftTrackSplit | null>(null);
  const [mappingRestSeconds, setMappingRestSeconds] = useState(1);
  const [bikeProfiles, setBikeProfiles] = useState<BikeProfile[]>(readStoredBikeProfiles);
  const [bikeConnectionSource, setBikeConnectionSource] = useState<BikeConnectionSource>('bluetooth');
  const [demoMode, setDemoMode] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(Math.min(4, maxPlayers));
  const [demoRaceSeed, setDemoRaceSeed] = useState(() => Date.now());
  const [demoRaceStartedAt, setDemoRaceStartedAt] = useState<number | null>(null);
  const [demoSignalsStopped, setDemoSignalsStopped] = useState(false);
  const [earthCamerasByTrack, setEarthCamerasByTrack] = useState<Record<string, EarthCamera>>(readStoredEarthCameras);
  const [appMode, setAppMode] = useState<AppMode>('race');
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(readStoredSpeedUnit);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(readStoredDistanceUnit);
  const [now, setNow] = useState(Date.now());
  const [selectedCountry, setSelectedCountry] = useState(initialTrack.country);
  const [selectedState, setSelectedState] = useState(initialTrack.state);
  const [selectedTrackId, setSelectedTrackId] = useState(initialTrack.id);
  const [sessionMode, setSessionMode] = useState<SessionMode>('sprint');
  const [intervalMode, setIntervalMode] = useState<IntervalMode>('auto');
  const [manualZoneIds, setManualZoneIds] = useState<string[]>(['z2', 'z4']);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['cadence', 'speed', 'power', 'reaction']);
  const [branchChoicesByPlayer, setBranchChoicesByPlayer] = useState<Partial<Record<PlayerSlot['id'], SplitBranchId>>>({});
  const [mappingRouteVariantId, setMappingRouteVariantId] = useState<RaceRouteVariantId>('amateur');
  const [raceRouteVariantId, setRaceRouteVariantId] = useState<RaceRouteVariantId>('amateur');
  const [earthAngle, setEarthAngle] = useState(
    () => earthCamerasByTrack[initialTrack.id]?.angle
      ?? (initialTrack.countryCode === 'CUSTOM' ? customRouteInitialAngle : defaultEarthCamera.angle),
  );
  const [earthHeading, setEarthHeading] = useState(
    () => earthCamerasByTrack[initialTrack.id]?.heading
      ?? (initialTrack.countryCode === 'CUSTOM' ? customRouteInitialHeading : defaultEarthCamera.heading),
  );
  const [earthCenter, setEarthCenter] = useState<TrackPoint | null>(
    () => earthCamerasByTrack[initialTrack.id]?.center
      ?? (initialTrack.countryCode === 'CUSTOM' ? trackCenter(initialTrack) : null),
  );
  const [earthZoom, setEarthZoom] = useState<number | null>(
    () => earthCamerasByTrack[initialTrack.id]?.zoom
      ?? (initialTrack.countryCode === 'CUSTOM' ? customRouteInitialZoom : null),
  );
  const [customRouteName, setCustomRouteName] = useState('');
  const [customRouteLocation, setCustomRouteLocation] = useState('');
  const [customRouteStatus, setCustomRouteStatus] = useState<string | null>(null);
  const [customRoutePredictions, setCustomRoutePredictions] = useState<PlacePredictionOption[]>([]);
  const [customRoutePredictionStatus, setCustomRoutePredictionStatus] = useState<string | null>(null);
  const [selectedCustomRoutePrediction, setSelectedCustomRoutePrediction] = useState<PlacePredictionOption | null>(null);
  const [customRoutePreview, setCustomRoutePreview] = useState<CustomRoutePreview | null>(null);
  const [startCadenceMode, setStartCadenceMode] = useState<StartCadenceMode>('uci');
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [startGateStatus, setStartGateStatus] = useState<StartGateStatus>(idleStartGateStatus);
  const [reactionStartAt, setReactionStartAt] = useState<number | null>(null);
  const [reactionTimesByPlayer, setReactionTimesByPlayer] = useState<ReactionTimesByPlayer>({});
  const [raceCapture, setRaceCapture] = useState<RaceCapture | null>(readStoredRaceCapture);
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [cloudUserDataStatus, setCloudUserDataStatus] = useState<CloudUserDataStatus>('loading');
  const [cloudUserDataMessage, setCloudUserDataMessage] = useState('Loading cloud profile data.');
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>('rpm');
  const [publicLeaderboards, setPublicLeaderboards] = useState<Record<LeaderboardMetric, LeaderboardEntry[]> | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 1, author: 'Coach', text: 'Gate cadence looked strong through the first straight.', at: '10:24 AM' },
    { id: 2, author: 'System', text: "Private room opened for today's session.", at: '10:25 AM' },
  ]);
  const demo = useDemoBikes({
    enabled: demoMode,
    bikeCount: demoBikeCount,
    raceSeed: demoRaceSeed,
    raceStartedAt: demoRaceStartedAt,
    signalState: demoSignalsStopped ? 'stopped' : demoRaceStartedAt == null ? 'ready' : 'racing',
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('room')) {
      setPlayMode('multiplayer');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/data/track-database.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Track database returned ${response.status}`);
        }
        return response.json() as Promise<{ tracks?: TrackRecord[] }>;
      })
      .then((database) => {
        if (!cancelled) {
          if (Array.isArray(database.tracks) && database.tracks.length > 0) {
            setBaseCatalogTracks(database.tracks);
          }
          setCatalogDatabaseReady(true);
        }
      })
      .catch((error: Error) => {
        console.warn(`Using bundled seed catalog: ${error.message}`);
        if (!cancelled) {
          setCatalogDatabaseReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistentCatalogTracks = useMemo(
    () => [...baseCatalogTracks, ...customRoutes],
    [baseCatalogTracks, customRoutes],
  );
  const catalogTracks = useMemo(
    () => {
      const previewRoute = customRoutePreview?.route;
      return previewRoute ? [...persistentCatalogTracks, previewRoute] : persistentCatalogTracks;
    },
    [customRoutePreview, persistentCatalogTracks],
  );

  useEffect(() => {
    const requestedTrackId = pendingInitialTrackIdRef.current;
    if (requestedTrackId) {
      const requestedTrack = catalogTracks.find((track) => track.id === requestedTrackId);
      if (requestedTrack) {
        pendingInitialTrackIdRef.current = null;
        setInitialUrlTrackPending(false);

        if (
          requestedTrack.id !== selectedTrackId
          || requestedTrack.country !== selectedCountry
          || requestedTrack.state !== selectedState
        ) {
          setSelectedCountry(requestedTrack.country);
          setSelectedState(requestedTrack.state);
          setSelectedTrackId(requestedTrack.id);
        }
        return;
      }

      if (!catalogDatabaseReady) {
        return;
      }

      pendingInitialTrackIdRef.current = null;
      setInitialUrlTrackPending(false);
    }

    const selectedTrackExists = catalogTracks.find((track) => track.id === selectedTrackId);
    const nextTrack = selectedTrackExists ?? catalogTracks[0] ?? defaultTrack;

    if (nextTrack.id !== selectedTrackId || nextTrack.country !== selectedCountry || nextTrack.state !== selectedState) {
      setSelectedCountry(nextTrack.country);
      setSelectedState(nextTrack.state);
      setSelectedTrackId(nextTrack.id);
    }
  }, [catalogDatabaseReady, catalogTracks, selectedCountry, selectedState, selectedTrackId]);

  useEffect(() => {
    if (initialUrlTrackPending) {
      return;
    }

    if (isCustomRoutePreviewId(selectedTrackId)) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('track', selectedTrackId);
    window.history.replaceState(null, '', url);
  }, [initialUrlTrackPending, selectedTrackId]);

  const countries = useMemo(() => countriesForCatalog(catalogTracks), [catalogTracks]);
  const states = useMemo(() => statesForCountry(selectedCountry, catalogTracks), [catalogTracks, selectedCountry]);
  const availableTracks = useMemo(
    () => tracksForLocation(selectedCountry, selectedState, catalogTracks),
    [catalogTracks, selectedCountry, selectedState],
  );
  const selectedTrack = useMemo(
    () => catalogTracks.find((track) => track.id === selectedTrackId) ?? availableTracks[0] ?? defaultTrack,
    [availableTracks, catalogTracks, selectedTrackId],
  );
  useEffect(() => {
    selectedTrackIdRef.current = selectedTrack.id;
  }, [selectedTrack.id]);
  const selectedTrackMapping = storedMappings[selectedTrack.id];
  const selectedRouteVariants = useMemo(
    () => (selectedTrackMapping ? routeVariantsFromMapping(selectedTrackMapping) : []),
    [selectedTrackMapping],
  );
  const savedRouteVariantIds = useMemo(
    () => selectedRouteVariants.map((variant) => variant.id),
    [selectedRouteVariants],
  );
  const hasDualStartRoutes = useMemo(() => {
    const amateurRoute = selectedRouteVariants.find((variant) => variant.id === 'amateur');
    const proRoute = selectedRouteVariants.find((variant) => variant.id === 'pro');
    return Boolean(
      amateurRoute
      && proRoute
      && distanceBetweenTrackPoints(amateurRoute.startGate, proRoute.startGate) > 3,
    );
  }, [selectedRouteVariants]);
  const activeMappingRoute = useMemo(
    () => (selectedTrackMapping ? draftRouteFromMapping(selectedTrackMapping, mappingRouteVariantId) : null),
    [mappingRouteVariantId, selectedTrackMapping],
  );
  useEffect(() => {
    const savedCamera = earthCamerasByTrack[selectedTrack.id];
    const isCustomRoute = selectedTrack.countryCode === 'CUSTOM';
    const fallbackCenter = isCustomRoute ? trackCenter(selectedTrack) : null;
    const fallbackZoom = isCustomRoute ? customRouteInitialZoom : null;
    setEarthAngle(savedCamera?.angle ?? (isCustomRoute ? customRouteInitialAngle : defaultEarthCamera.angle));
    setEarthHeading(savedCamera?.heading ?? (isCustomRoute ? customRouteInitialHeading : defaultEarthCamera.heading));
    setEarthCenter(savedCamera?.center ?? fallbackCenter);
    setEarthZoom(savedCamera?.zoom ?? fallbackZoom);
  }, [
    earthCamerasByTrack,
    selectedTrack.countryCode,
    selectedTrack.id,
    selectedTrack.latitude,
    selectedTrack.longitude,
  ]);
  const effectiveTrack = useMemo(
    () => {
      const mappedTrack = selectedTrackMapping
        ? applyUserTrackMapping(selectedTrack, selectedTrackMapping, hasDualStartRoutes ? raceRouteVariantId : undefined)
        : selectedTrack;
      if (!publicLeaderboards) {
        return mappedTrack;
      }

      return {
        ...mappedTrack,
        leaderboards: {
          rpm: publicLeaderboards.rpm.length > 0 ? publicLeaderboards.rpm : mappedTrack.leaderboards.rpm,
          speed: publicLeaderboards.speed.length > 0 ? publicLeaderboards.speed : mappedTrack.leaderboards.speed,
          watts: publicLeaderboards.watts.length > 0 ? publicLeaderboards.watts : mappedTrack.leaderboards.watts,
        },
      };
    },
    [hasDualStartRoutes, publicLeaderboards, raceRouteVariantId, selectedTrack, selectedTrackMapping],
  );

  useEffect(() => {
    if (!hasDualStartRoutes && raceRouteVariantId !== 'amateur') {
      setRaceRouteVariantId('amateur');
    }
  }, [hasDualStartRoutes, raceRouteVariantId, selectedTrack.id]);

  useEffect(() => {
    let cancelled = false;
    setPublicLeaderboards(null);

    if (isCustomRoutePreviewId(selectedTrack.id)) {
      return undefined;
    }

    fetch(`/api/multiplayer/leaderboards?trackId=${encodeURIComponent(selectedTrack.id)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Leaderboard request returned ${response.status}`);
        }
        return response.json() as Promise<{ leaderboards?: Record<LeaderboardMetric, LeaderboardEntry[]> }>;
      })
      .then((payload) => {
        if (cancelled || !payload.leaderboards) {
          return;
        }
        setPublicLeaderboards({
          rpm: Array.isArray(payload.leaderboards.rpm) ? payload.leaderboards.rpm : [],
          speed: Array.isArray(payload.leaderboards.speed) ? payload.leaderboards.speed : [],
          watts: Array.isArray(payload.leaderboards.watts) ? payload.leaderboards.watts : [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPublicLeaderboards(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTrack.id]);
  const draftRouteSplitSections = useMemo(() => {
    const activeSplitPreview = draftSplitBuilder ? splitSectionPreviewFromDraft(draftSplitBuilder) : null;
    return activeSplitPreview ? [...draftSplitSections, activeSplitPreview] : draftSplitSections;
  }, [draftSplitBuilder, draftSplitSections]);
  const draftRidePoints = useMemo(
    () => routeWithDefaultSplitBranches(draftPoints, draftRouteSplitSections),
    [draftPoints, draftRouteSplitSections],
  );
  const draftZonePoints = useMemo(
    () => draftZoneMeters
      .map((meter) => pointAtRouteMeter(draftRidePoints, meter))
      .filter((point): point is TrackPoint => point != null),
    [draftRidePoints, draftZoneMeters],
  );
  const draftLengthMeters = useMemo(
    () => (draftPoints.length > 1 ? routeLengthWithDefaultSplitBranches(draftPoints, draftRouteSplitSections) : 0),
    [draftPoints, draftRouteSplitSections],
  );
  const draftSplitBuilderStatus = useMemo(() => {
    if (!draftSplitBuilder) {
      return 'Select Split, then tap where Split 1 starts.';
    }

    if (!draftSplitBuilder.splitPoint) {
      return `Tap the Split ${draftSplitBuilder.index} junction.`;
    }

    if (!draftSplitBuilder.mergePoint) {
      return `Tap the Merge ${draftSplitBuilder.index} junction.`;
    }

    const branchOneStarted = branchInteriorPoints(
      draftSplitBuilder.branchA,
      draftSplitBuilder.splitPoint,
      draftSplitBuilder.mergePoint,
    ).length;
    const branchOneComplete = branchIsComplete(
      draftSplitBuilder.branchA,
      draftSplitBuilder.splitPoint,
      draftSplitBuilder.mergePoint,
    );
    if (draftSplitBuilder.activeBranch === 'a') {
      if (branchOneStarted < splitBranchMinInteriorPoints) {
        return branchOneStarted === 0
          ? `Draw Branch 1 from Split ${draftSplitBuilder.index} to Merge ${draftSplitBuilder.index}.`
          : `Keep drawing Branch 1 along the lane contour.`;
      }

      if (!branchOneComplete) {
        return `Keep drawing Branch 1 to Merge ${draftSplitBuilder.index}.`;
      }

      return `Branch 1 reached Merge ${draftSplitBuilder.index}. Select Branch 2 or keep fine tuning.`;
    }

    if (!branchOneComplete) {
      return branchOneStarted === 0
        ? `Draw Branch 1 from Split ${draftSplitBuilder.index} to Merge ${draftSplitBuilder.index}.`
        : `Finish Branch 1 at Merge ${draftSplitBuilder.index} before starting Branch 2.`;
    }

    const branchTwoStarted = branchInteriorPoints(
      draftSplitBuilder.branchB,
      draftSplitBuilder.splitPoint,
      draftSplitBuilder.mergePoint,
    ).length;
    const branchTwoComplete = branchIsComplete(
      draftSplitBuilder.branchB,
      draftSplitBuilder.splitPoint,
      draftSplitBuilder.mergePoint,
    );
    if (branchTwoStarted < splitBranchMinInteriorPoints) {
      return branchTwoStarted === 0
        ? `Draw Branch 2 from Split ${draftSplitBuilder.index} to Merge ${draftSplitBuilder.index}.`
        : `Keep drawing Branch 2 along the lane contour.`;
    }

    if (!branchTwoComplete) {
      return `Keep drawing Branch 2 to Merge ${draftSplitBuilder.index}.`;
    }

    return `${draftSplitBuilder.index === 1 ? 'Split 1 / Merge 1' : `Split ${draftSplitBuilder.index} / Merge ${draftSplitBuilder.index}`} is ready to add.`;
  }, [draftSplitBuilder]);
  const canSaveDraftSplit = useMemo(
    () => Boolean(draftSplitBuilder && splitSectionFromDraft(draftSplitBuilder)),
    [draftSplitBuilder],
  );
  const demoPlayers = useMemo(() => createDemoPlayers(demoBikeCount), [demoBikeCount]);
  const connectedBikeSamples = useMemo(() => {
    const next = new Map(bridge.samplesByDevice);
    bluetooth.samplesByDevice.forEach((sample, deviceId) => {
      next.set(deviceId, sample);
    });
    return next;
  }, [bluetooth.samplesByDevice, bridge.samplesByDevice]);
  const samplesByDevice = demoMode ? demo.samplesByDevice : connectedBikeSamples;
  const connectedDeviceIds = useMemo(
    () => [...connectedBikeSamples.keys()].sort((a, b) => a - b).slice(0, maxPlayers),
    [connectedBikeSamples],
  );
  const profileByDevice = useMemo(
    () => new Map(bikeProfiles.map((profile) => [profile.deviceId, profile])),
    [bikeProfiles],
  );
  const sessionPlayers = useMemo(
    () => connectedDeviceIds.map((deviceId, index) => {
      const visual = profileVisual(index);
      const profile = profileByDevice.get(deviceId);

      return {
        id: visual.id,
        name: profile?.name ?? defaultBikeName(deviceId),
        colorName: profile?.colorName ?? visual.colorName,
        accent: profile?.accent ?? visual.accent,
        deviceId,
      };
    }),
    [connectedDeviceIds, profileByDevice],
  );
  const activePlayers = useMemo(
    () => {
      if (demoMode) {
        return demoPlayers.slice(0, maxPlayers);
      }

      return sessionPlayers;
    },
    [demoMode, demoPlayers, sessionPlayers],
  );
  const multiplayer = useMultiplayer({
    enabled: playMode === 'multiplayer',
    track: effectiveTrack,
    bikeCount: activePlayers.length,
  });
  const cloudProfileKey = multiplayer.profile.guestKey;
  const livePlayerCount = useMemo(
    () => activePlayers.filter((player) => {
      if (player.deviceId == null) {
        return false;
      }

      const sample = samplesByDevice.get(player.deviceId);
      return Boolean(sample && now - sample.at < liveBikeTimeoutMs);
    }).length,
    [activePlayers, now, samplesByDevice],
  );
  const pairingPlayers = useMemo(
    () => {
      if (demoMode) {
        return demoPlayers;
      }

      return sessionPlayers;
    },
    [demoMode, demoPlayers, sessionPlayers],
  );
  const mappedZones = useMemo(
    () => (effectiveTrack.routeStatus === 'user-mapped' ? effectiveTrack.zones : []),
    [effectiveTrack.routeStatus, effectiveTrack.zones],
  );
  const activeZones = useMemo(() => {
    if (sessionMode === 'sprint') {
      return mappedZones;
    }

    if (intervalMode === 'auto') {
      return mappedZones.filter((zone) => zone.type === 'pedal');
    }

    return mappedZones.filter((zone) => manualZoneIds.includes(zone.id));
  }, [intervalMode, manualZoneIds, mappedZones, sessionMode]);
  const splitDecisionPoints = useMemo(
    () => (effectiveTrack.centerline
      ? splitDecisionPointsForRoute(effectiveTrack.centerline, effectiveTrack.splitSections ?? [])
      : []),
    [effectiveTrack.centerline, effectiveTrack.splitSections],
  );
  const activeBranchChoicesByPlayer = useMemo(() => {
    const seedOffset = Math.abs(Math.trunc(demoRaceSeed / 997)) % 2;
    return activePlayers.reduce<Partial<Record<PlayerSlot['id'], SplitBranchId>>>((choices, player, index) => {
      choices[player.id] = branchChoicesByPlayer[player.id]
        ?? (demoMode && splitDecisionPoints.length > 0
          ? ((index + seedOffset) % 2 === 0 ? 'a' : 'b')
          : 'a');
      return choices;
    }, {});
  }, [activePlayers, branchChoicesByPlayer, demoMode, demoRaceSeed, splitDecisionPoints.length]);
  const { raceState, riders, raceSummary, startRace, resetRace } = useRaceEngine(
    activePlayers,
    samplesByDevice,
    effectiveTrack.lengthMeters,
    activeBranchChoicesByPlayer,
    splitDecisionPoints,
  );
  useZoneAudioCues(raceState, riders, activeZones);
  const raceViewFullscreen = startGateStatus.active || raceState === 'racing';
  const stagedRiders = useMemo(() => {
    if (!startGateStatus.active || raceState === 'racing') {
      return riders;
    }

    const liveRidersByPlayer = new Map(riders.map((rider) => [rider.playerId, rider]));
    return createInitialRiders(activePlayers, activeBranchChoicesByPlayer).map((rider) => {
      const liveRider = liveRidersByPlayer.get(rider.playerId);
      return liveRider && liveRider.distance <= 1 && !liveRider.finishedAt ? liveRider : rider;
    });
  }, [activeBranchChoicesByPlayer, activePlayers, raceState, riders, startGateStatus.active]);
  const canCancelRace = startGateStatus.active || raceState === 'racing';

  const releaseRaceFullscreen = useCallback(() => {
    releaseBrowserFullscreen();
  }, []);

  const clearStartGateSequence = useCallback(() => {
    startGateSequenceIdRef.current += 1;
    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    startGateArmedAtRef.current = null;
    stopStartGateAudio();
    setStartGateStatus(idleStartGateStatus);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, []);

  const prepareForTrackSelection = useCallback((nextTrackId: string) => {
    pendingInitialTrackIdRef.current = null;
    setInitialUrlTrackPending(false);
    selectedTrackIdRef.current = nextTrackId;
    clearStartGateSequence();
    falseStartHandledRef.current = false;
    setMappingFullscreen(false);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
    releaseRaceFullscreen();
  }, [clearStartGateSequence, releaseRaceFullscreen, resetRace]);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom?.track.id) {
      return;
    }

    const roomTrackId = multiplayer.currentRoom.track.id;
    if (roomTrackId === selectedTrackId) {
      return;
    }

    const roomTrack = catalogTracks.find((track) => track.id === roomTrackId);
    if (!roomTrack) {
      return;
    }

    roomTrackApplyRef.current = roomTrackId;
    prepareForTrackSelection(roomTrack.id);
    setSelectedCountry(roomTrack.country);
    setSelectedState(roomTrack.state);
    setSelectedTrackId(roomTrack.id);
  }, [catalogTracks, multiplayer.currentRoom?.track.id, playMode, prepareForTrackSelection, selectedTrackId]);

  useEffect(() => {
    const roomId = multiplayer.currentRoom?.id;
    const roomTrackId = multiplayer.currentRoom?.track.id;
    if (playMode !== 'multiplayer' || !roomId || !roomTrackId || effectiveTrack.id === roomTrackId) {
      return;
    }

    if (roomTrackApplyRef.current === roomTrackId) {
      roomTrackApplyRef.current = null;
      return;
    }

    void multiplayer.syncTrack(effectiveTrack);
  }, [effectiveTrack, multiplayer.currentRoom?.id, multiplayer.currentRoom?.track.id, multiplayer.syncTrack, playMode]);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      latestRaceSyncRef.current = null;
      return;
    }

    latestRaceSyncRef.current = {
      sessionId: raceCapture?.sessionId ?? `${multiplayer.currentRoom.id}:${effectiveTrack.id}:manual`,
      trackId: effectiveTrack.id,
      raceState,
      riders: activePlayers
        .map((player) => {
          const rider = riders.find((item) => item.playerId === player.id);
          if (!rider) {
            return null;
          }

          const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
          return {
            id: `${player.deviceId ?? player.id}`,
            playerId: player.id,
            name: player.name,
            colorName: player.colorName,
            accent: player.accent,
            distance: rider.distance,
            velocity: rider.velocity,
            boost: rider.boost,
            air: rider.air,
            pitch: rider.pitch,
            phase: rider.phase,
            rank: rider.rank,
            finishedAt: rider.finishedAt,
            selectedBranch: rider.selectedBranch,
            actualBranches: rider.actualBranches,
            watts: sample?.watts ?? rider.lastWatts,
            cadence: sample?.cadence ?? null,
            speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
            signal: sample?.signal ?? 0,
            sampleAt: sample?.at ?? null,
          };
        })
        .filter((rider): rider is OutgoingMultiplayerRaceState['riders'][number] => rider != null),
      summary: raceSummary,
    };
  }, [activePlayers, effectiveTrack.id, multiplayer.currentRoom, playMode, raceCapture?.sessionId, raceState, raceSummary, riders, samplesByDevice]);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      return undefined;
    }

    const sendRaceState = () => {
      if (latestRaceSyncRef.current) {
        multiplayer.sendRaceState(latestRaceSyncRef.current);
      }
    };

    sendRaceState();
    const timer = window.setInterval(sendRaceState, raceState === 'racing' ? 150 : 750);
    return () => window.clearInterval(timer);
  }, [multiplayer.currentRoom, multiplayer.sendRaceState, playMode, raceState]);

  const remoteRaceStates = useMemo(() => {
    const roomId = multiplayer.currentRoom?.id;
    if (!roomId) {
      return [];
    }

    return multiplayer.roomRaceStates.filter((state) => (
      state.clientId !== multiplayer.clientId
      && state.roomId === roomId
      && state.trackId === effectiveTrack.id
      && now - state.at < 6500
    ));
  }, [effectiveTrack.id, multiplayer.clientId, multiplayer.currentRoom?.id, multiplayer.roomRaceStates, now]);

  useEffect(() => {
    if (demoMode && raceState === 'finished') {
      setDemoSignalsStopped(true);
      setDemoRaceStartedAt(null);
    }
  }, [demoMode, raceState]);

  const createRaceCapture = useCallback(() => {
    const createdAt = Date.now();
    const sessionId = `tlb-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    capturedSampleKeysRef.current = new Set();

    const capture: RaceCapture = {
      version: 1,
      sessionId,
      createdAt,
      startedAt: null,
      endedAt: null,
      status: 'armed',
      source: demoMode ? 'demo' : 'live',
      track: {
        id: effectiveTrack.id,
        name: effectiveTrack.name,
        country: effectiveTrack.country,
        state: effectiveTrack.state,
        lengthMeters: effectiveTrack.lengthMeters,
      },
      sessionMode,
      selectedMetrics,
      players: activePlayers.map((player) => ({
        id: player.id,
        name: player.name,
        deviceId: player.deviceId,
        colorName: player.colorName,
      })),
      zones: activeZones,
      events: [{
        at: createdAt,
        elapsedMs: 0,
        type: 'race-arm',
        label: 'Race armed / countdown started',
      }],
      samples: [],
      reactionTimesByPlayer: {},
      summary: [],
    };

    setRaceCapture(capture);
  }, [activePlayers, activeZones, demoMode, effectiveTrack, selectedMetrics, sessionMode]);

  const appendRaceCaptureEvent = useCallback((type: RaceCapture['events'][number]['type'], label: string, at = Date.now()) => {
    setRaceCapture((current) => {
      if (!current) {
        return current;
      }

      const status = type === 'race-start'
        ? 'racing'
        : type === 'race-finish'
          ? 'finished'
          : type === 'race-reset'
            ? 'reset'
            : type === 'race-cancel'
              ? 'cancelled'
            : current.status;

      return {
        ...current,
        status,
        startedAt: type === 'race-start' ? at : current.startedAt,
        endedAt: type === 'race-finish' || type === 'race-reset' || type === 'race-cancel' ? at : current.endedAt,
        events: [
          ...current.events,
          {
            at,
            elapsedMs: at - current.createdAt,
            type,
            label,
          },
        ],
      };
    });
  }, []);

  useEffect(() => {
    if (raceState === 'finished') {
      releaseRaceFullscreen();
    }
  }, [raceState, releaseRaceFullscreen]);

  const sendRoomReadyState = useCallback((sessionId: string) => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      return;
    }

    multiplayer.sendRaceState({
      sessionId,
      trackId: effectiveTrack.id,
      raceState: 'ready',
      riders: [],
      summary: [],
    });
  }, [effectiveTrack.id, multiplayer.currentRoom, multiplayer.sendRaceState, playMode]);

  useEffect(() => {
    if (reactionStartAt == null || activePlayers.length === 0) {
      return;
    }

    setReactionTimesByPlayer((current) => {
      let changed = false;
      const next: ReactionTimesByPlayer = { ...current };

      activePlayers.forEach((player) => {
        if (player.deviceId == null || next[player.id] != null) {
          return;
        }

        const sample = samplesByDevice.get(player.deviceId);
        if (!sample || sample.at < reactionStartAt || !isReactionBikeSample(sample)) {
          return;
        }

        next[player.id] = Math.max(0, sample.at - reactionStartAt);
        changed = true;
      });

      return changed ? next : current;
    });
  }, [activePlayers, reactionStartAt, samplesByDevice]);

  useEffect(() => {
    if (demoMode || connectedDeviceIds.length === 0) {
      return;
    }

    setBikeProfiles((current) => {
      let changed = false;
      const next = [...current];
      const knownDevices = new Set(next.map((profile) => profile.deviceId));

      connectedDeviceIds.forEach((deviceId, index) => {
        if (knownDevices.has(deviceId)) {
          return;
        }

        next.push(createBikeProfile(deviceId, index));
        knownDevices.add(deviceId);
        changed = true;
      });

      return changed ? dedupeBikeProfiles(next) : current;
    });
  }, [connectedDeviceIds, demoMode]);

  useEffect(() => {
    if (bridge.connection !== 'open' || bridgeUserDataLoadedRef.current) {
      return;
    }

    let cancelled = false;
    readBridgeUserData()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setStoredMappings((current) => {
          const next = { ...current, ...data.trackMappings };
          writeStoredTrackMappings(next);
          return next;
        });
        setCustomRoutes((current) => {
          const next = mergeCustomRoutes(current, data.customRoutes);
          writeStoredCustomRoutes(next);
          return next;
        });
        setBikeProfiles((current) => mergeBikeProfiles(current, data.bikeProfiles));
        bridgeUserDataLoadedRef.current = true;
      })
      .catch((error: Error) => {
        console.warn(`Could not load TrackLab bridge user data: ${error.message}`);
        bridgeUserDataLoadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [bridge.connection]);

  useEffect(() => {
    if (!cloudProfileKey) {
      setCloudUserDataStatus('offline');
      setCloudUserDataMessage('No profile key is available for cloud sync.');
      return;
    }

    let cancelled = false;
    cloudUserDataLoadedKeyRef.current = null;
    cloudUserDataAvailableRef.current = false;
    setCloudUserDataStatus('loading');
    setCloudUserDataMessage('Loading cloud profile data.');

    readCloudUserData(cloudProfileKey)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setStoredMappings((current) => {
          const next = { ...current, ...data.trackMappings };
          writeStoredTrackMappings(next);
          return next;
        });
        setCustomRoutes((current) => {
          const next = mergeCustomRoutes(current, data.customRoutes);
          writeStoredCustomRoutes(next);
          return next;
        });
        setBikeProfiles((current) => mergeBikeProfiles(current, data.bikeProfiles));
        cloudUserDataAvailableRef.current = true;
        cloudUserDataLoadedKeyRef.current = cloudProfileKey;
        setCloudUserDataStatus('online');
        setCloudUserDataMessage('Bike names, custom routes, and track maps are syncing to this profile.');
      })
      .catch((error: Error) => {
        console.warn(`Could not load TrackLab cloud user data: ${error.message}`);
        cloudUserDataAvailableRef.current = false;
        cloudUserDataLoadedKeyRef.current = cloudProfileKey;
        setCloudUserDataStatus('offline');
        setCloudUserDataMessage(`Cloud profile unavailable. Local browser storage is still active. ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [cloudProfileKey]);

  useEffect(() => {
    writeStoredBikeProfiles(bikeProfiles);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
        void patchCloudUserData(cloudProfileKey, { bikeProfiles })
          .then(() => {
            setCloudUserDataStatus('online');
            setCloudUserDataMessage('Bike profiles saved to this cloud profile.');
          })
          .catch((error: Error) => {
            setCloudUserDataStatus('offline');
            setCloudUserDataMessage(`Could not save bike profiles to cloud. ${error.message}`);
            console.warn(`Could not save bike profiles to TrackLab cloud: ${error.message}`);
          });
      }
      return;
    }

    void patchBridgeUserData({ bikeProfiles }).catch((error: Error) => {
      console.warn(`Could not save bike profiles to TrackLab bridge: ${error.message}`);
    });
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void patchCloudUserData(cloudProfileKey, { bikeProfiles })
        .then(() => {
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Bike profiles saved to this cloud profile.');
        })
        .catch((error: Error) => {
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Could not save bike profiles to cloud. ${error.message}`);
          console.warn(`Could not save bike profiles to TrackLab cloud: ${error.message}`);
        });
    }
  }, [bikeProfiles, bridge.connection, cloudProfileKey]);

  useEffect(() => {
    writeStoredCustomRoutes(customRoutes);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
        void patchCloudUserData(cloudProfileKey, { customRoutes })
          .then(() => {
            setCloudUserDataStatus('online');
            setCloudUserDataMessage('Custom routes saved to this cloud profile.');
          })
          .catch((error: Error) => {
            setCloudUserDataStatus('offline');
            setCloudUserDataMessage(`Could not save custom routes to cloud. ${error.message}`);
            console.warn(`Could not save custom routes to TrackLab cloud: ${error.message}`);
          });
      }
      return;
    }

    void patchBridgeUserData({ customRoutes }).catch((error: Error) => {
      console.warn(`Could not save custom routes to TrackLab bridge: ${error.message}`);
    });
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void patchCloudUserData(cloudProfileKey, { customRoutes })
        .then(() => {
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Custom routes saved to this cloud profile.');
        })
        .catch((error: Error) => {
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Could not save custom routes to cloud. ${error.message}`);
          console.warn(`Could not save custom routes to TrackLab cloud: ${error.message}`);
        });
    }
  }, [bridge.connection, cloudProfileKey, customRoutes]);

  useEffect(() => {
    writeStoredTrackMappings(storedMappings);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
        void patchCloudUserData(cloudProfileKey, { trackMappings: storedMappings })
          .then(() => {
            setCloudUserDataStatus('online');
            setCloudUserDataMessage('Track mappings saved to this cloud profile.');
          })
          .catch((error: Error) => {
            setCloudUserDataStatus('offline');
            setCloudUserDataMessage(`Could not save track maps to cloud. ${error.message}`);
            console.warn(`Could not save track mappings to TrackLab cloud: ${error.message}`);
          });
      }
      return;
    }

    void patchBridgeUserData({ trackMappings: storedMappings }).catch((error: Error) => {
      console.warn(`Could not save track mappings to TrackLab bridge: ${error.message}`);
    });
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void patchCloudUserData(cloudProfileKey, { trackMappings: storedMappings })
        .then(() => {
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Track mappings saved to this cloud profile.');
        })
        .catch((error: Error) => {
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Could not save track maps to cloud. ${error.message}`);
          console.warn(`Could not save track mappings to TrackLab cloud: ${error.message}`);
        });
    }
  }, [bridge.connection, cloudProfileKey, storedMappings]);

  useEffect(() => {
    window.localStorage.setItem(speedUnitStorageKey, speedUnit);
  }, [speedUnit]);

  useEffect(() => {
    window.localStorage.setItem(distanceUnitStorageKey, distanceUnit);
  }, [distanceUnit]);

  useEffect(() => {
    if (!raceCapture) {
      return;
    }

    window.localStorage.setItem(raceCaptureStorageKey, JSON.stringify(raceCapture));
  }, [raceCapture]);

  useEffect(() => {
    if (!raceCapture || (raceCapture.status !== 'armed' && raceCapture.status !== 'racing')) {
      return;
    }

    const captureStartedAt = raceCapture.startedAt ?? raceCapture.createdAt;
    const capturedSamples = activePlayers.flatMap((player) => {
      if (player.deviceId == null) {
        return [];
      }

      const sample = samplesByDevice.get(player.deviceId);
      if (!sample || sample.at < raceCapture.createdAt) {
        return [];
      }

      const sampleKey = `${raceCapture.sessionId}:${sample.deviceId}:${sample.at}`;
      if (capturedSampleKeysRef.current.has(sampleKey)) {
        return [];
      }

      capturedSampleKeysRef.current.add(sampleKey);
      const rider = riders.find((item) => item.playerId === player.id);

      return [{
        at: sample.at,
        elapsedMs: sample.at - captureStartedAt,
        playerId: player.id,
        riderName: player.name,
        deviceId: sample.deviceId,
        deviceLabel: sample.label,
        source: sample.source,
        watts: sample.watts,
        cadence: sample.cadence,
        speedKph: sample.speedKph,
        wattsAt: sample.wattsAt,
        cadenceAt: sample.cadenceAt,
        speedAt: sample.speedAt,
        speedSource: sample.speedSource,
        signal: sample.signal,
        battery: sample.battery,
        riderDistanceMeters: rider ? Number(rider.distance.toFixed(2)) : null,
        riderVelocityMps: rider ? Number(rider.velocity.toFixed(2)) : null,
        riderPhase: rider?.phase ?? null,
        rank: rider?.rank ?? null,
      }];
    });

    if (capturedSamples.length === 0) {
      return;
    }

    setRaceCapture((current) => {
      if (!current || current.sessionId !== raceCapture.sessionId) {
        return current;
      }

      return {
        ...current,
        samples: [...current.samples, ...capturedSamples],
      };
    });
  }, [activePlayers, raceCapture, riders, samplesByDevice]);

  useEffect(() => {
    if (!raceCapture || raceState !== 'finished' || raceSummary.length === 0 || raceCapture.status === 'finished') {
      return;
    }

    const finishedAt = Date.now();
    setRaceCapture((current) => {
      if (!current || current.sessionId !== raceCapture.sessionId) {
        return current;
      }

      return {
        ...current,
        status: 'finished',
        endedAt: finishedAt,
        reactionTimesByPlayer,
        summary: raceSummary,
        events: [
          ...current.events,
          {
            at: finishedAt,
            elapsedMs: finishedAt - current.createdAt,
            type: 'race-finish',
            label: 'Race finished / summary captured',
          },
        ],
      };
    });
  }, [raceCapture, raceState, raceSummary, reactionTimesByPlayer]);

  useEffect(() => {
    setManualZoneIds((current) => {
      const valid = current.filter((zoneId) => mappedZones.some((zone) => zone.id === zoneId));
      return valid.length > 0 ? valid : mappedZones.filter((zone) => zone.type === 'pedal').slice(0, 2).map((zone) => zone.id);
    });
    resetRace();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, [effectiveTrack.activeRouteVariantId, effectiveTrack.id, mappedZones, resetRace]);

  const renamePlayer = useCallback((playerId: PlayerSlot['id'], name: string) => {
    const player = sessionPlayers.find((item) => item.id === playerId);
    if (!player?.deviceId) {
      return;
    }

    const deviceId = player.deviceId;
    const safeName = name.trim().slice(0, 64) || defaultBikeName(deviceId);
    setBikeProfiles((current) => {
      const next = current.map((profile) => (
        profile.deviceId === deviceId
          ? { ...profile, name: safeName, updatedAt: Date.now() }
          : profile
      ));

      return next.some((profile) => profile.deviceId === deviceId)
        ? dedupeBikeProfiles(next)
        : dedupeBikeProfiles([...next, createBikeProfile(deviceId, playerId - 1, safeName)]);
    });
  }, [sessionPlayers]);

  const assignDevice = useCallback((playerId: PlayerSlot['id'], deviceId: number | null) => {
    const player = sessionPlayers.find((item) => item.id === playerId);
    const nextDeviceId = deviceId ?? player?.deviceId;
    if (!nextDeviceId) {
      return;
    }

    const visual = profileVisual(playerId - 1);
    setBikeProfiles((current) => {
      const next = current.map((profile) => (
        profile.deviceId === nextDeviceId
          ? {
            ...profile,
            name: deviceId == null ? defaultBikeName(nextDeviceId) : player?.name ?? profile.name,
            colorName: visual.colorName,
            accent: visual.accent,
            updatedAt: Date.now(),
          }
          : profile
      ));

      return next.some((profile) => profile.deviceId === nextDeviceId)
        ? dedupeBikeProfiles(next)
        : dedupeBikeProfiles([...next, createBikeProfile(nextDeviceId, playerId - 1, player?.name)]);
    });
  }, [sessionPlayers]);

  const autoAssign = useCallback(() => {
    if (connectedDeviceIds.length === 0) {
      return;
    }

    setBikeProfiles((current) => {
      const knownDevices = new Set(current.map((profile) => profile.deviceId));
      const additions = connectedDeviceIds
        .filter((deviceId) => !knownDevices.has(deviceId))
        .map((deviceId, index) => createBikeProfile(deviceId, index));

      return additions.length > 0 ? dedupeBikeProfiles([...current, ...additions]) : current;
    });
  }, [connectedDeviceIds]);

  const discardCustomRoutePreview = useCallback(() => {
    customRoutePreviewRequestIdRef.current += 1;
    const previewTrackId = customRoutePreviewTrackIdRef.current;
    customRoutePreviewTrackIdRef.current = null;
    setCustomRoutePreview(null);

    if (previewTrackId) {
      setStoredMappings((current) => {
        if (!current[previewTrackId]) {
          return current;
        }

        const next = { ...current };
        delete next[previewTrackId];
        writeStoredTrackMappings(next);
        return next;
      });
      setEarthCamerasByTrack((current) => {
        if (!current[previewTrackId]) {
          return current;
        }

        const next = { ...current };
        delete next[previewTrackId];
        writeStoredEarthCameras(next);
        return next;
      });
    }
  }, []);

  const handleCountryChange = (country: string) => {
    const nextState = statesForCountry(country, persistentCatalogTracks)[0];
    const nextTrack = tracksForLocation(country, nextState, persistentCatalogTracks)[0];
    if (!nextTrack) {
      return;
    }

    discardCustomRoutePreview();
    prepareForTrackSelection(nextTrack.id);
    setSelectedCountry(country);
    setSelectedState(nextState);
    setSelectedTrackId(nextTrack.id);
  };

  const handleStateChange = (state: string) => {
    const nextTrack = tracksForLocation(selectedCountry, state, persistentCatalogTracks)[0];
    if (!nextTrack) {
      return;
    }

    discardCustomRoutePreview();
    prepareForTrackSelection(nextTrack.id);
    setSelectedState(state);
    setSelectedTrackId(nextTrack.id);
  };

  const handleTrackChange = (trackId: string) => {
    const nextTrack = persistentCatalogTracks.find((track) => track.id === trackId);
    if (!nextTrack) {
      return;
    }

    discardCustomRoutePreview();
    prepareForTrackSelection(nextTrack.id);
    setSelectedCountry(nextTrack.country);
    setSelectedState(nextTrack.state);
    setSelectedTrackId(nextTrack.id);
  };

  const handleCustomLocationShortcut = () => {
    setAppMode('race');
    setCustomRouteStatus((current) => current ?? 'Enter a route name and location to create a custom ride.');

    window.setTimeout(() => {
      document.getElementById('custom-route-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('custom-route-location-input')?.focus();
    }, 80);
  };

  const handleCustomRouteLocationChange = useCallback((value: string) => {
    customRoutePreviewRequestIdRef.current += 1;
    setCustomRouteLocation(value);
    setCustomRouteStatus(null);
    setSelectedCustomRoutePrediction((current) => {
      if (current && current.label !== value) {
        resetPlaceAutocompleteSession();
      }

      return null;
    });
  }, []);

  const handleCustomRoutePredictionSelect = useCallback((prediction: PlacePredictionOption) => {
    const previewName = customRouteName.trim() || prediction.mainText;
    const requestId = customRoutePreviewRequestIdRef.current + 1;
    customRoutePreviewRequestIdRef.current = requestId;

    setSelectedCustomRoutePrediction(prediction);
    setCustomRouteLocation(prediction.label);
    setCustomRoutePredictions([]);
    setCustomRoutePredictionStatus('Locating selected address...');
    setCustomRouteStatus('Locating selected address...');

    if (!customRouteName.trim()) {
      setCustomRouteName(prediction.mainText);
    }

    resolvePlacePrediction(prediction)
      .then((resolved) => {
        if (customRoutePreviewRequestIdRef.current !== requestId) {
          return;
        }

        const previewRoute = createCustomRoutePreviewRecord(
          previewName,
          resolved.label ?? prediction.label,
          resolved.point,
        );
        const previewCamera = normalizeEarthCamera({
          angle: customRouteInitialAngle,
          heading: customRouteInitialHeading,
          center: trackCenter(previewRoute),
          zoom: customRouteInitialZoom,
          updatedAt: Date.now(),
        });

        customRoutePreviewTrackIdRef.current = previewRoute.id;
        setCustomRoutePreview({
          input: prediction.label,
          label: resolved.label ?? prediction.label,
          point: resolved.point,
          route: previewRoute,
          camera: previewCamera,
        });
        prepareForTrackSelection(previewRoute.id);
        setSelectedCountry(previewRoute.country);
        setSelectedState(previewRoute.state);
        setSelectedTrackId(previewRoute.id);
        setEarthAngle(previewCamera.angle);
        setEarthHeading(previewCamera.heading);
        setEarthCenter(previewCamera.center ?? null);
        setEarthZoom(previewCamera.zoom ?? null);
        setCustomRoutePredictionStatus('Address located on the map. Add the custom route to save it.');
        setCustomRouteStatus('Previewing selected address. Add the custom route to save it.');
      })
      .catch((error) => {
        if (customRoutePreviewRequestIdRef.current !== requestId) {
          return;
        }

        setCustomRoutePreview(null);
        setCustomRoutePredictionStatus(null);
        setCustomRouteStatus(`${formatRouteLocationError(error)} Try another suggestion or use coordinates.`);
      });
  }, [customRouteName, prepareForTrackSelection]);

  useEffect(() => {
    const input = customRouteLocation.trim();

    if (selectedCustomRoutePrediction && selectedCustomRoutePrediction.label === input) {
      setCustomRoutePredictions([]);
      return;
    }

    if (input.length < 3) {
      setCustomRoutePredictions([]);
      setCustomRoutePredictionStatus(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCustomRoutePredictionStatus('Searching Google addresses...');
      fetchLocationPredictions(input)
        .then((predictions) => {
          if (cancelled) {
            return;
          }

          setCustomRoutePredictions(predictions);
          setCustomRoutePredictionStatus(
            predictions.length > 0 ? null : 'No address suggestions found. Coordinates still work.',
          );
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setCustomRoutePredictions([]);
          setCustomRoutePredictionStatus(`${formatAutocompleteError(error)} Coordinates still work.`);
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customRouteLocation, selectedCustomRoutePrediction]);

  const handleCustomRouteCreate = async () => {
    const name = customRouteName.trim();
    const location = customRouteLocation.trim();

    if (!name || !location) {
      setCustomRouteStatus('Add a route name and a start location.');
      return;
    }

    setCustomRouteStatus('Finding location...');
    try {
      const matchingPreview = customRoutePreview?.input === location ? customRoutePreview : null;
      const resolved = matchingPreview
        ? { point: matchingPreview.point, label: matchingPreview.label ?? location }
        : selectedCustomRoutePrediction && selectedCustomRoutePrediction.label === location
          ? await resolvePlacePrediction(selectedCustomRoutePrediction)
          : await resolveLocationText(location);
      const customRoute = createCustomRouteRecord(name, resolved.label ?? location, resolved.point);
      const customRouteCamera = normalizeEarthCamera({
        angle: customRouteInitialAngle,
        heading: customRouteInitialHeading,
        center: trackCenter(customRoute),
        zoom: customRouteInitialZoom,
        updatedAt: Date.now(),
      });
      setCustomRoutes((current) => {
        const next = [...current, customRoute];
        writeStoredCustomRoutes(next);
        return next;
      });
      setEarthCamerasByTrack((current) => {
        const next = {
          ...current,
          [customRoute.id]: customRouteCamera,
        };
        const previewTrackId = customRoutePreviewTrackIdRef.current;
        if (previewTrackId) {
          delete next[previewTrackId];
        }
        writeStoredEarthCameras(next);
        return next;
      });
      const previewTrackId = customRoutePreviewTrackIdRef.current;
      if (previewTrackId) {
        setStoredMappings((current) => {
          if (!current[previewTrackId]) {
            return current;
          }

          const next = { ...current };
          delete next[previewTrackId];
          writeStoredTrackMappings(next);
          return next;
        });
      }
      customRoutePreviewRequestIdRef.current += 1;
      customRoutePreviewTrackIdRef.current = null;
      setCustomRoutePreview(null);
      prepareForTrackSelection(customRoute.id);
      setSelectedCountry(customRoute.country);
      setSelectedState(customRoute.state);
      setSelectedTrackId(customRoute.id);
      setEarthAngle(customRouteCamera.angle);
      setEarthHeading(customRouteCamera.heading);
      setEarthCenter(customRouteCamera.center ?? null);
      setEarthZoom(customRouteCamera.zoom ?? null);
      setCustomRouteName('');
      setCustomRouteLocation('');
      setCustomRoutePredictions([]);
      setCustomRoutePredictionStatus(null);
      setSelectedCustomRoutePrediction(null);
      setCustomRouteStatus('Custom route added. Trace the path and save it.');
      setDraftPoints([]);
      setDraftZoneMeters([]);
      setDraftSplitSections([]);
      setDraftSplitBuilder(null);
      setMappingRestSeconds(1);
      setMappingMode(true);
      setMappingEditMode('navigate');
      resetRace();
    } catch (error) {
      const message = formatRouteLocationError(error);
      const suggestionHint = customRoutePredictions.length > 0
        ? ' Click one of the address suggestions, then add the route.'
        : ' Coordinates like 38.7345, -121.2910 work without geocoding.';
      setCustomRouteStatus(`${message}${suggestionHint}`);
    }
  };

  const handleCustomRouteDelete = (trackId: string) => {
    const customRoute = customRoutes.find((route) => route.id === trackId);
    if (!customRoute) {
      return;
    }

    setCustomRoutes((current) => {
      const next = current.filter((route) => route.id !== trackId);
      writeStoredCustomRoutes(next);
      return next;
    });
    setStoredMappings((current) => {
      if (!current[trackId]) {
        return current;
      }

      const next = { ...current };
      delete next[trackId];
      writeStoredTrackMappings(next);
      return next;
    });
    setEarthCamerasByTrack((current) => {
      if (!current[trackId]) {
        return current;
      }

      const next = { ...current };
      delete next[trackId];
      writeStoredEarthCameras(next);
      return next;
    });

    if (selectedTrackId === trackId) {
      const fallbackTrack = baseCatalogTracks[0] ?? defaultTrack;
      prepareForTrackSelection(fallbackTrack.id);
      setSelectedCountry(fallbackTrack.country);
      setSelectedState(fallbackTrack.state);
      setSelectedTrackId(fallbackTrack.id);
    }

    setDraftPoints([]);
    setDraftZoneMeters([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    setMappingMode(false);
    setMappingFullscreen(false);
    setCustomRouteStatus(`Deleted ${customRoute.name}.`);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  useEffect(() => {
    setMappingRouteVariantId('amateur');
    setRaceRouteVariantId('amateur');
    setMappingEditMode('navigate');
    setMappingMode(false);
    setMappingFullscreen(false);
  }, [selectedTrack.id]);

  useEffect(() => {
    setDraftPoints(activeMappingRoute?.centerline ?? []);
    setDraftZoneMeters(activeMappingRoute ? zoneBoundariesFromRouteVariant(activeMappingRoute) : []);
    setDraftSplitSections(activeMappingRoute?.splitSections ?? []);
    setDraftSplitBuilder(null);
    setMappingRestSeconds(activeMappingRoute?.restAfterSeconds ?? 1);
  }, [activeMappingRoute]);

  const handleMappingModeChange = (enabled: boolean) => {
    if (enabled && draftPoints.length === 0 && activeMappingRoute) {
      setDraftPoints(activeMappingRoute.centerline);
      setDraftZoneMeters(zoneBoundariesFromRouteVariant(activeMappingRoute));
      setDraftSplitSections(activeMappingRoute.splitSections ?? []);
      setMappingRestSeconds(activeMappingRoute.restAfterSeconds);
    }

    if (enabled) {
      setMappingEditMode('navigate');
    } else {
      setMappingFullscreen(false);
    }

    setMappingMode(enabled);
  };

  const handleMappingFullscreenChange = (enabled: boolean) => {
    if (enabled && !mappingMode) {
      handleMappingModeChange(true);
    }

    setMappingFullscreen(enabled);
  };

  const snapDraftPointToSplitJunction = useCallback((point: TrackPoint) => {
    let closestJunction: TrackPoint | null = null;
    let closestSplitSection: TrackSplitSection | null = null;
    let closestJunctionKind: 'split' | 'merge' | null = null;
    let closestDistance = mainRouteSplitSnapMeters;

    for (const splitSection of draftRouteSplitSections) {
      const splitDistance = distanceBetweenTrackPoints(point, splitSection.splitPoint);
      if (splitDistance <= closestDistance) {
        closestDistance = splitDistance;
        closestJunction = splitSection.splitPoint;
        closestSplitSection = splitSection;
        closestJunctionKind = 'split';
      }

      const mergeDistance = distanceBetweenTrackPoints(point, splitSection.mergePoint);
      if (mergeDistance <= closestDistance) {
        closestDistance = mergeDistance;
        closestJunction = splitSection.mergePoint;
        closestSplitSection = splitSection;
        closestJunctionKind = 'merge';
      }
    }

    return {
      point: closestJunction ?? point,
      splitSection: closestSplitSection,
      junctionKind: closestJunctionKind,
    };
  }, [draftRouteSplitSections]);

  const handleMappingPathPointAdd = useCallback((point: TrackPoint) => {
    const snappedPoint = snapDraftPointToSplitJunction(point);
    setDraftPoints((current) => {
      const appendOrReplacePoint = (points: TrackPoint[], nextPoint: TrackPoint) => {
        const previous = points[points.length - 1];
        if (previous && distanceBetweenTrackPoints(previous, nextPoint) < routePointDuplicateMeters) {
          return [...points.slice(0, -1), nextPoint];
        }

        return [...points, nextPoint];
      };

      const previousPoint = current[current.length - 1];
      const resumeMergeSection = previousPoint
        ? draftRouteSplitSections.find((section) => (
          distanceBetweenTrackPoints(previousPoint, section.mergePoint) <= routePointDuplicateMeters
        ))
        : null;

      if (
        resumeMergeSection
        && distanceBetweenTrackPoints(point, resumeMergeSection.mergePoint) <= mainRouteMergeResumeHoldMeters
      ) {
        return appendOrReplacePoint(current, resumeMergeSection.mergePoint);
      }

      let next = appendOrReplacePoint(current, snappedPoint.point);
      if (snappedPoint.junctionKind === 'split' && snappedPoint.splitSection) {
        next = appendOrReplacePoint(next, snappedPoint.splitSection.mergePoint);
      }

      return next;
    });
  }, [draftRouteSplitSections, snapDraftPointToSplitJunction]);

  const handleMappingPathPointMove = useCallback((index: number, point: TrackPoint) => {
    const snappedPoint = snapDraftPointToSplitJunction(point);
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.map((draftPoint, draftIndex) => (draftIndex === index ? snappedPoint.point : draftPoint));
      const nextLength = next.length > 1 ? routeLengthWithDefaultSplitBranches(next, draftRouteSplitSections) : 0;
      setDraftZoneMeters((currentZones) => currentZones.filter((meter) => meter > 2 && meter < nextLength - 2));
      return next;
    });
  }, [draftRouteSplitSections, snapDraftPointToSplitJunction]);

  const handleMappingPathPointRemove = useCallback((index: number) => {
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.filter((_, draftIndex) => draftIndex !== index);
      const nextLength = next.length > 1 ? routeLengthWithDefaultSplitBranches(next, draftRouteSplitSections) : 0;
      setDraftZoneMeters((currentZones) => currentZones.filter((meter) => meter > 2 && meter < nextLength - 2));
      return next;
    });
  }, [draftRouteSplitSections]);

  const startOrUpdateSplitBuilder = useCallback((branch: SplitBranchId = 'a') => {
    setDraftSplitBuilder((current) => {
      if (current) {
        return { ...current, activeBranch: branch };
      }

      return createDraftTrackSplit(draftSplitSections.length + 1);
    });
    setMappingMode(true);
    setMappingEditMode('split');
  }, [draftSplitSections.length]);

  const handleSplitBranchChange = useCallback((branch: SplitBranchId) => {
    setDraftSplitBuilder((current) => {
      if (
        branch === 'b'
        && current?.splitPoint
        && current.mergePoint
        && !branchIsComplete(current.branchA, current.splitPoint, current.mergePoint)
      ) {
        return current;
      }

      if (current) {
        return { ...current, activeBranch: branch };
      }

      return { ...createDraftTrackSplit(draftSplitSections.length + 1), activeBranch: branch };
    });
    setMappingMode(true);
    setMappingEditMode('split');
  }, [draftSplitSections.length]);

  const handleMappingSplitPointAdd = useCallback((point: TrackPoint) => {
    setDraftSplitBuilder((current) => {
      const builder = current ?? createDraftTrackSplit(draftSplitSections.length + 1);
      if (!builder.splitPoint) {
        return {
          ...builder,
          splitPoint: point,
          activeBranch: 'a',
        };
      }

      if (!builder.mergePoint) {
        return {
          ...builder,
          mergePoint: point,
          activeBranch: 'a',
        };
      }

      const branchKey = builder.activeBranch === 'a' ? 'branchA' : 'branchB';
      const snappedPoint = snapBranchEndpoint(point, builder.splitPoint, builder.mergePoint);
      if (
        branchTouchesMerge(builder[branchKey], builder.mergePoint)
        && distanceBetweenTrackPoints(snappedPoint, builder.mergePoint) > 0.5
      ) {
        return builder;
      }

      const baseBranch = branchInteriorPoints(builder[branchKey], builder.splitPoint, builder.mergePoint);
      return {
        ...builder,
        [branchKey]: appendTrackPoint(baseBranch, snappedPoint),
      };
    });
  }, [draftSplitSections.length]);

  const handleMappingSplitDrawEnd = useCallback(() => {
    // Ending a drag stroke should not finish the branch. Riders need to be able
    // to add several strokes/points along a lane before switching branches.
  }, []);

  const saveDraftSplit = useCallback(() => {
    const nextSplit = draftSplitBuilder ? splitSectionFromDraft(draftSplitBuilder) : null;
    if (!nextSplit) {
      return;
    }

    setDraftSplitSections((sections) => [...sections, nextSplit]);
    setDraftSplitBuilder(null);
  }, [draftSplitBuilder]);

  const cancelDraftSplit = useCallback(() => {
    setDraftSplitBuilder(null);
  }, []);

  const removeDraftSplitSection = useCallback((splitId: string) => {
    setDraftSplitSections((current) => current
      .filter((section) => section.id !== splitId)
      .map((section, index) => ({
        ...section,
        index: index + 1,
        name: `Split ${index + 1} / Merge ${index + 1}`,
        branches: section.branches.map((branch) => ({
          ...branch,
          name: splitBranchLabels[branch.id],
        })),
      })));
  }, []);

  const undoMappingPoint = () => {
    if (mappingEditMode === 'split') {
      if (draftSplitBuilder) {
        if (!draftSplitBuilder.splitPoint) {
          setDraftSplitBuilder(null);
          return;
        }

        if (!draftSplitBuilder.mergePoint) {
          setDraftSplitBuilder({
            ...draftSplitBuilder,
            splitPoint: null,
          });
          return;
        }

        const branchKey = draftSplitBuilder.activeBranch === 'a' ? 'branchA' : 'branchB';
        const branchPoints = draftSplitBuilder.splitPoint
          ? branchInteriorPoints(
            draftSplitBuilder[branchKey],
            draftSplitBuilder.splitPoint,
            draftSplitBuilder.mergePoint,
          )
          : draftSplitBuilder[branchKey];
        if (branchPoints.length === 0) {
          if (draftSplitBuilder.activeBranch === 'b') {
            setDraftSplitBuilder({
              ...draftSplitBuilder,
              activeBranch: 'a',
            });
            return;
          }

          setDraftSplitBuilder({
            ...draftSplitBuilder,
            mergePoint: null,
            branchA: [],
            branchB: [],
          });
          return;
        }

        setDraftSplitBuilder({
          ...draftSplitBuilder,
          [branchKey]: branchPoints.slice(0, -1),
        });
        return;
      }

      setDraftSplitSections((current) => current.slice(0, -1));
      return;
    }

    if (mappingEditMode === 'zones') {
      setDraftZoneMeters((current) => current.slice(0, -1));
      return;
    }

    const nextPoints = draftPoints.slice(0, -1);
    const nextLength = nextPoints.length > 1 ? routeLengthWithDefaultSplitBranches(nextPoints, draftRouteSplitSections) : 0;
    setDraftPoints(nextPoints);
    setDraftZoneMeters((currentZones) => currentZones.filter((meter) => meter < nextLength - 1));
  };

  const clearMappingDraft = () => {
    setDraftPoints([]);
    setDraftZoneMeters([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
  };

  const updateMappingRestSeconds = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.min(30, Number.isFinite(seconds) ? seconds : 0));
    setMappingRestSeconds(safeSeconds);
  };

  const saveMapping = () => {
    if (draftPoints.length < 2) {
      return;
    }

    const completedDraftSplit = draftSplitBuilder ? splitSectionFromDraft(draftSplitBuilder) : null;
    const mapping = createUserTrackMapping(
      selectedTrack,
      draftPoints,
      mappingRestSeconds,
      draftZoneMeters,
      completedDraftSplit ? [...draftSplitSections, completedDraftSplit] : draftSplitSections,
      mappingRouteVariantId,
      selectedTrackMapping ? routeVariantsFromMapping(selectedTrackMapping) : [],
    );
    setStoredMappings((current) => {
      const next = { ...current, [selectedTrack.id]: mapping };
      writeStoredTrackMappings(next);
      return next;
    });
    if (completedDraftSplit) {
      setDraftSplitSections((current) => [...current, completedDraftSplit]);
      setDraftSplitBuilder(null);
    }
    setRaceRouteVariantId(mappingRouteVariantId);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const removeMapping = () => {
    setStoredMappings((current) => {
      const next = { ...current };
      delete next[selectedTrack.id];
      writeStoredTrackMappings(next);
      return next;
    });
    setDraftPoints([]);
    setDraftZoneMeters([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const exportMapping = () => {
    const mapping = storedMappings[selectedTrack.id];
    if (mapping) {
      downloadTrackMapping(mapping);
    }
  };

  const importMapping = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const mapping = parseUserTrackMapping(String(reader.result ?? ''));
        setStoredMappings((current) => {
          const next = { ...current, [mapping.trackId]: mapping };
          writeStoredTrackMappings(next);
          return next;
        });

        const importedTrack = catalogTracks.find((track) => track.id === mapping.trackId);
        if (importedTrack) {
          prepareForTrackSelection(importedTrack.id);
          setSelectedCountry(importedTrack.country);
          setSelectedState(importedTrack.state);
          setSelectedTrackId(importedTrack.id);
        }

        const importedRoutes = routeVariantsFromMapping(mapping);
        const importedRoute = importedRoutes.find((route) => route.id === 'amateur') ?? importedRoutes[0];
        setMappingRouteVariantId(importedRoute.id);
        setRaceRouteVariantId(importedRoute.id);
        setDraftPoints(importedRoute.centerline);
        setDraftZoneMeters(zoneBoundariesFromRouteVariant(importedRoute));
        setDraftSplitSections(importedRoute.splitSections ?? []);
        setDraftSplitBuilder(null);
        setMappingRestSeconds(importedRoute.restAfterSeconds);
        setMappingEditMode('navigate');
        setMappingMode(true);
        setDemoRaceStartedAt(null);
        setDemoSignalsStopped(false);
        resetRace();
      } catch (error) {
        console.error(error);
      }
    };
    reader.readAsText(file);
  };

  const exportRaceCaptureJson = () => {
    if (!raceCapture) {
      return;
    }

    downloadTextFile(
      raceCaptureFilename(raceCapture, 'json'),
      JSON.stringify(raceCapture, null, 2),
      'application/json',
    );
  };

  const exportRaceCaptureCsv = () => {
    if (!raceCapture) {
      return;
    }

    downloadTextFile(
      raceCaptureFilename(raceCapture, 'csv'),
      raceCaptureToCsv(raceCapture),
      'text/csv',
    );
  };

  const handleMappingZonePointAdd = useCallback((point: TrackPoint) => {
    setDraftZoneMeters((current) => {
      if (draftRidePoints.length < 2) {
        return current;
      }

      const routeLength = routeLengthMeters(draftRidePoints);
      const meter = Math.round(nearestRouteMeter(draftRidePoints, point));
      if (meter <= 2 || meter >= routeLength - 2 || current.some((boundary) => Math.abs(boundary - meter) < 3)) {
        return current;
      }

      return [...current, meter].sort((a, b) => a - b);
    });
  }, [draftRidePoints]);

  const handleMappingZonePointMove = useCallback((index: number, point: TrackPoint) => {
    setDraftZoneMeters((current) => {
      if (draftRidePoints.length < 2 || index < 0 || index >= current.length) {
        return current;
      }

      const routeLength = routeLengthMeters(draftRidePoints);
      const meter = Math.round(nearestRouteMeter(draftRidePoints, point));
      if (meter <= 2 || meter >= routeLength - 2) {
        return current;
      }

      return current
        .map((boundary, boundaryIndex) => (boundaryIndex === index ? meter : boundary))
        .filter((boundary, boundaryIndex, boundaries) => (
          boundaryIndex === boundaries.findIndex((candidate) => Math.abs(candidate - boundary) < 3)
        ))
        .sort((a, b) => a - b);
    });
  }, [draftRidePoints]);

  const handleMappingZonePointRemove = useCallback((index: number) => {
    setDraftZoneMeters((current) => current.filter((_, zoneIndex) => zoneIndex !== index));
  }, []);

  const toggleManualZone = (zoneId: string) => {
    setManualZoneIds((current) => (
      current.includes(zoneId)
        ? current.filter((item) => item !== zoneId)
        : [...current, zoneId]
    ));
  };

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetrics((current) => {
      if (current.includes(metric)) {
        return current.length === 1 ? current : current.filter((item) => item !== metric);
      }

      return [...current, metric];
    });
  };

  const handleBranchChoiceChange = useCallback((playerId: PlayerSlot['id'], branch: SplitBranchId) => {
    setBranchChoicesByPlayer((current) => ({
      ...current,
      [playerId]: branch,
    }));
  }, []);

  const handleMappingRouteVariantChange = useCallback((variantId: RaceRouteVariantId) => {
    setMappingRouteVariantId(variantId);
    setMappingEditMode('navigate');
  }, []);

  const handleRaceRouteVariantChange = useCallback((variantId: RaceRouteVariantId) => {
    setRaceRouteVariantId(variantId);
    resetRace();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, [resetRace]);

  const handleEarthCameraChange = useCallback((camera: Partial<EarthCamera>) => {
    const nextCamera = normalizeEarthCamera({
      angle: camera.angle ?? earthAngle,
      heading: camera.heading ?? earthHeading,
      center: camera.center ?? earthCenter ?? undefined,
      zoom: camera.zoom ?? earthZoom ?? undefined,
      updatedAt: Date.now(),
    });
    const cameraIsOnSelectedTrack = cameraCenterBelongsToTrack(nextCamera, effectiveTrack);
    const safeCamera = cameraIsOnSelectedTrack
      ? nextCamera
      : normalizeEarthCamera({
        angle: nextCamera.angle,
        heading: nextCamera.heading,
        updatedAt: nextCamera.updatedAt,
      });

    setEarthAngle((current) => (current === safeCamera.angle ? current : safeCamera.angle));
    setEarthHeading((current) => (current === safeCamera.heading ? current : safeCamera.heading));
    setEarthCenter((current) => {
      if (!cameraIsOnSelectedTrack) {
        return current;
      }

      const nextCenter = safeCamera.center ?? null;
      if (
        current
        && nextCenter
        && Math.abs(current.lat - nextCenter.lat) < 0.0000001
        && Math.abs(current.lng - nextCenter.lng) < 0.0000001
      ) {
        return current;
      }

      return nextCenter;
    });
    setEarthZoom((current) => (
      !cameraIsOnSelectedTrack
        ? current
        : current != null
          && safeCamera.zoom != null
          && Math.abs(current - safeCamera.zoom) < 0.01
          ? current
          : safeCamera.zoom ?? null
    ));

    setEarthCamerasByTrack((current) => {
      if (!cameraIsOnSelectedTrack) {
        return current;
      }

      if (earthCamerasMatch(current[selectedTrack.id], safeCamera)) {
        return current;
      }

      const next = {
        ...current,
        [selectedTrack.id]: safeCamera,
      };
      writeStoredEarthCameras(next);
      return next;
    });
  }, [earthAngle, earthCenter, earthHeading, earthZoom, effectiveTrack, selectedTrack.id]);

  const handleEarthAngleChange = useCallback((angle: number) => {
    handleEarthCameraChange({ angle });
  }, [handleEarthCameraChange]);

  const handleEarthHeadingChange = useCallback((heading: number) => {
    handleEarthCameraChange({ heading });
  }, [handleEarthCameraChange]);

  useEffect(() => () => clearStartGateSequence(), [clearStartGateSequence]);

  const scheduleStartGateStep = useCallback((delayMs: number, action: () => void, sequenceId = startGateSequenceIdRef.current) => {
    const timeoutId = window.setTimeout(() => {
      if (sequenceId !== startGateSequenceIdRef.current) {
        return;
      }

      action();
    }, delayMs);
    startGateTimeoutsRef.current.push(timeoutId);
  }, []);

  const armReactionTimer = useCallback(() => {
    setReactionStartAt(Date.now());
    setReactionTimesByPlayer({});
  }, []);

  const beginRaceAtGateDrop = useCallback((expectedTrackId?: string, sequenceId = startGateSequenceIdRef.current) => {
    if (
      (expectedTrackId && selectedTrackIdRef.current !== expectedTrackId)
      || sequenceId !== startGateSequenceIdRef.current
    ) {
      return;
    }

    const gateDropAt = Date.now();
    startGateArmedAtRef.current = null;
    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 104729);
      setDemoRaceStartedAt(gateDropAt);
    }

    setStartGateStatus({
      active: true,
      label: 'GO',
      detail: 'Gate open',
      lightIndex: 3,
    });
    if (!demoMode) {
      bridge.sendControlCommand('race-start');
    }

    appendRaceCaptureEvent('race-start', 'Gate drop / race started', gateDropAt);
    startRace();
    scheduleStartGateStep(420, () => setStartGateStatus(idleStartGateStatus));
  }, [appendRaceCaptureEvent, bridge, demoMode, scheduleStartGateStep, startRace]);

  useEffect(() => {
    if (!startGateStatus.active || raceState === 'racing' || demoMode || falseStartHandledRef.current) {
      return;
    }

    const gateArmedAt = startGateArmedAtRef.current;
    if (gateArmedAt == null) {
      return;
    }

    const falseStartPlayer = activePlayers.find((player) => {
      if (player.deviceId == null) {
        return false;
      }

      const sample = samplesByDevice.get(player.deviceId);
      return Boolean(sample && sample.at >= gateArmedAt + 120 && isFalseStartBikeSample(sample));
    });

    if (!falseStartPlayer) {
      return;
    }

    falseStartHandledRef.current = true;
    const sessionId = raceCapture?.sessionId ?? `false-start-${Date.now()}`;
    appendRaceCaptureEvent('race-cancel', `False start: ${falseStartPlayer.name}`);
    clearStartGateSequence();
    setMappingFullscreen(false);
    bridge.sendControlCommand('race-reset');
    sendRoomReadyState(sessionId);
    resetRace();
    releaseRaceFullscreen();
  }, [
    activePlayers,
    appendRaceCaptureEvent,
    bridge,
    clearStartGateSequence,
    demoMode,
    raceCapture?.sessionId,
    raceState,
    releaseRaceFullscreen,
    resetRace,
    samplesByDevice,
    sendRoomReadyState,
    startGateStatus.active,
  ]);

  const handleDemoModeChange = (enabled: boolean, nextSource: BikeConnectionSource = enabled ? 'demo' : 'bluetooth') => {
    clearStartGateSequence();
    setBikeConnectionSource(nextSource);
    setDemoMode(enabled);
    setDemoRaceSeed(Date.now());
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const handleBikeConnectionSourceChange = (source: BikeConnectionSource) => {
    if (source === 'demo') {
      handleDemoModeChange(true, 'demo');
      return;
    }

    if (demoMode) {
      handleDemoModeChange(false, source);
      return;
    }

    setBikeConnectionSource(source);
  };

  const handleDemoBikeCountChange = (count: number) => {
    clearStartGateSequence();
    setDemoBikeCount(Math.max(1, Math.min(maxPlayers, Math.round(count))));
    setDemoRaceSeed(Date.now() + count);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const prepareNoBikeDemoTest = useCallback(() => {
    clearStartGateSequence();
    setDemoMode(true);
    setDemoBikeCount(Math.min(maxPlayers, Math.max(4, demoBikeCount)));
    setDemoRaceSeed(Date.now());
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
    setAppMode('race');
  }, [clearStartGateSequence, demoBikeCount, resetRace]);

  const enableMultiplayerTest = useCallback(() => {
    setPlayMode('multiplayer');
    setAppMode('diagnostics');
  }, []);

  const handleReset = () => {
    const sessionId = raceCapture?.sessionId ?? `reset-${Date.now()}`;
    appendRaceCaptureEvent('race-reset', 'Race reset');
    clearStartGateSequence();
    falseStartHandledRef.current = false;
    setMappingFullscreen(false);
    if (!demoMode) {
      bridge.sendControlCommand('race-reset');
    }

    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 7919);
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(false);
    }

    resetRace();
    sendRoomReadyState(sessionId);
    releaseRaceFullscreen();
  };

  const handleCancel = () => {
    const sessionId = raceCapture?.sessionId ?? `cancel-${Date.now()}`;
    const label = raceState === 'racing'
      ? 'Race cancelled mid-race'
      : 'Race cancelled before gate drop';
    appendRaceCaptureEvent('race-cancel', label);
    clearStartGateSequence();
    falseStartHandledRef.current = false;
    setMappingFullscreen(false);

    if (!demoMode) {
      bridge.sendControlCommand('race-reset');
    }

    if (demoMode) {
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(true);
    }

    resetRace();
    sendRoomReadyState(sessionId);
    releaseRaceFullscreen();
  };

  const shareMultiplayerInvite = useCallback(() => {
    if (!multiplayer.inviteUrl) {
      return;
    }

    void navigator.clipboard?.writeText(multiplayer.inviteUrl).catch(() => {
      window.prompt('Copy this TrackLab room invite link:', multiplayer.inviteUrl);
    });
  }, [multiplayer.inviteUrl]);

  const copyMultiplayerProfileKey = useCallback(() => {
    if (!cloudProfileKey) {
      return;
    }

    void navigator.clipboard?.writeText(cloudProfileKey).catch(() => {
      window.prompt('Copy this TrackLab profile key:', cloudProfileKey);
    });
  }, [cloudProfileKey]);

  const chooseRandomRoomTrack = useCallback(() => {
    const candidates = catalogTracks.filter((track) => (
      track.routeStatus === 'verified'
      || track.routeStatus === 'estimated'
      || track.routeStatus === 'user-mapped'
    ));
    const pool = candidates.length > 0 ? candidates : catalogTracks;
    const nextTrack = pool[Math.floor(Math.random() * pool.length)];
    if (!nextTrack) {
      return;
    }

    prepareForTrackSelection(nextTrack.id);
    setSelectedCountry(nextTrack.country);
    setSelectedState(nextTrack.state);
    setSelectedTrackId(nextTrack.id);
    void multiplayer.syncTrack(nextTrack);
  }, [catalogTracks, multiplayer.syncTrack, prepareForTrackSelection]);

  const sendChatMessage = () => {
    const text = chatDraft.trim();
    if (!text) {
      return;
    }

    if (playMode === 'multiplayer' && multiplayer.currentRoom) {
      multiplayer.sendRoomChat(text);
      setChatDraft('');
      return;
    }

    setChatMessages((current) => [
      ...current,
      { id: Date.now(), author: playMode === 'local' ? 'Local Coach' : 'Room Host', text, at: formatClock() },
    ].slice(-6));
    setChatDraft('');
  };

  const handleStart = async () => {
    if (effectiveTrack.routeStatus !== 'user-mapped' || startGateStatus.active || raceState === 'racing') {
      return;
    }

    const startingTrackId = effectiveTrack.id;
    if (selectedTrackIdRef.current !== startingTrackId) {
      return;
    }

    clearStartGateSequence();
    const sequenceId = startGateSequenceIdRef.current;
    falseStartHandledRef.current = false;
    startGateArmedAtRef.current = Date.now();
    setMappingFullscreen(false);
    setDemoSignalsStopped(false);
    createRaceCapture();
    if (!demoMode) {
      bridge.sendControlCommand('race-arm');
    }

    primeAudioCues();

    if (startCadenceMode === 'uci') {
      setStartGateStatus({
        active: true,
        label: 'UCI CADENCE',
        detail: 'Starting random cadence audio',
        lightIndex: null,
      });

      const voiceStart = await playUciRandomStartVoice();
      if (sequenceId !== startGateSequenceIdRef.current || selectedTrackIdRef.current !== startingTrackId) {
        return;
      }

      const randomDelayMs = randomIntegerInclusive(uciRandomDelayMinMs, uciRandomDelayMaxMs);
      const firstToneAtMs = uciVoiceWatchGateOffsetMs + randomDelayMs;
      const scheduleVoiceStep = (voiceOffsetMs: number, action: () => void) => {
        const elapsedSinceVoiceStartMs = Date.now() - voiceStart.startedAt;
        scheduleStartGateStep(Math.max(0, voiceOffsetMs - elapsedSinceVoiceStartMs), action, sequenceId);
      };

      setStartGateStatus({
        active: true,
        label: 'OK RIDERS',
        detail: voiceStart.source === 'audio' ? 'UCI random start voice' : 'Fallback random start voice',
        lightIndex: null,
      });

      scheduleVoiceStep(3300, () => {
        setStartGateStatus({
          active: true,
          label: 'RIDERS READY',
          detail: 'Watch the gate',
          lightIndex: null,
        });
      });

      scheduleVoiceStep(uciVoiceWatchGateOffsetMs, () => {
        setStartGateStatus({
          active: true,
          label: 'RANDOM DELAY',
          detail: 'Watch the gate',
          lightIndex: null,
        });
      });

      [0, 120, 240].forEach((offsetMs, index) => {
        scheduleVoiceStep(firstToneAtMs + offsetMs, () => {
          if (index === 0) {
            armReactionTimer();
          }

          const lightIndex = index as 0 | 1 | 2;
          setStartGateStatus({
            active: true,
            label: startTreeLabels[lightIndex],
            detail: 'UCI cadence',
            lightIndex,
          });
          playStartGateTone('uci-red');
        });
      });

      scheduleVoiceStep(firstToneAtMs + 360, () => {
        playStartGateTone('uci-green');
        beginRaceAtGateDrop(startingTrackId, sequenceId);
      });
      return;
    }

    const safeCountdownSeconds = Math.max(3, Math.min(6, Math.round(countdownSeconds)));
    setStartGateStatus({
      active: true,
      label: `Gate in ${safeCountdownSeconds}`,
      detail: 'Standard countdown',
      lightIndex: null,
    });

    for (let secondsRemaining = safeCountdownSeconds; secondsRemaining >= 1; secondsRemaining -= 1) {
      const delayMs = (safeCountdownSeconds - secondsRemaining) * 1000;
      scheduleStartGateStep(delayMs, () => {
        if (secondsRemaining === safeCountdownSeconds) {
          armReactionTimer();
        }

        const lightIndex = secondsRemaining <= 3 ? (3 - secondsRemaining) as 0 | 1 | 2 : null;
        setStartGateStatus({
          active: true,
          label: lightIndex == null ? `Gate in ${secondsRemaining}` : startTreeLabels[lightIndex],
          detail: lightIndex == null ? 'Standard countdown' : `Gate in ${secondsRemaining}`,
          lightIndex,
        });
        playStartGateTone('tick');
      });
    }

    scheduleStartGateStep(safeCountdownSeconds * 1000, () => {
      playStartGateTone('gate');
      beginRaceAtGateDrop(startingTrackId, sequenceId);
    }, sequenceId);
  };

  const connectionLabel = (() => {
    if (demoMode) {
      return 'Demo race source online';
    }

    if (bikeConnectionSource === 'bluetooth') {
      if (!bluetooth.supported) {
        return 'Bluetooth Direct unavailable';
      }

      return bluetooth.connectedCount > 0 ? 'Bluetooth Direct online' : 'Bluetooth Direct ready';
    }

    if (bluetooth.connectedCount > 0 && bridge.connection === 'open') {
      return 'ANT+ / Bluetooth inputs online';
    }

    if (bluetooth.connectedCount > 0) {
      return 'Bluetooth bikes online';
    }

    if (bridge.connection !== 'open') {
      return 'Advanced Connector offline';
    }

    if (bridge.sourceState === 'idle') {
      return 'Advanced Connector ready';
    }

    if (bridge.sourceState === 'starting') {
      return 'Starting Advanced Connector';
    }

    if (bridge.sourceState === 'error') {
      return 'Advanced Connector error';
    }

    return activePlayers.length > 0
      ? `${livePlayerCount}/${activePlayers.length} bike${activePlayers.length === 1 ? '' : 's'} live`
      : `${bridge.mode.toString().toUpperCase()} connector scanning`;
  })();
  const connectionStatus = (() => {
    if (demoMode) {
      return `Simulating ${demoBikeCount} bike${demoBikeCount === 1 ? '' : 's'} with ${demo.variableCount} race variables.`;
    }

    if (bikeConnectionSource === 'bluetooth') {
      if (!bluetooth.supported) {
        return 'This browser does not support direct Bluetooth pairing. Use Chrome or Edge, or switch to Advanced Connector for ANT+/USB.';
      }

      return bluetooth.connectedCount > 0
        ? bluetooth.status
        : 'Press Connect Wattbike, choose the bike from the browser Bluetooth prompt, then pedal to confirm live data.';
    }

    const bridgeControlStatus = bridge.controlStatus ? ` ${bridge.controlStatus}` : '';

    if (bluetooth.connectedCount > 0) {
      return `${bluetooth.status} ${bridge.connection === 'open' ? bridge.status : bridge.error ?? bridge.status}${bridgeControlStatus}`;
    }

    return `${bridge.error ?? `${bridge.status} ${bluetooth.status}`}${bridgeControlStatus}`;
  })();
  const bridgeBusy = bridge.sourceState === 'starting' || bridge.sourceState === 'stopping';
  const bridgeRunning = bridge.sourceState === 'running';
  const bridgeButtonDisabled = demoMode || bikeConnectionSource !== 'advanced' || bridge.connection !== 'open' || bridgeBusy;
  const bridgeButtonLabel = bridgeBusy
    ? bridge.sourceState === 'stopping' ? 'Stopping Connector' : 'Starting Connector'
    : bridgeRunning ? 'Stop Connector' : 'Start Connector';
  const bridgePrompt = (() => {
    if (demoMode) {
      return 'Demo mode is generating bike data.';
    }

    if (bikeConnectionSource === 'bluetooth') {
      return bluetooth.supported
        ? 'No connector needed. Browser Bluetooth feeds the same BMX gear logic, race engine, monitor, and summaries.'
        : 'Direct Bluetooth is blocked in this browser. Switch to Advanced Connector or use a supported desktop browser.';
    }

    if (bridge.connection !== 'open') {
      return 'Install or open TrackLab Bike Connector on this computer, then reload this page.';
    }

    if (bridge.sourceState === 'idle') {
      return 'Press Start Connector, then put each Wattbike in Just Ride at resistance level 1.';
    }

    if (bridge.sourceState === 'running' && activePlayers.length === 0) {
      return 'Waiting for bike signal. Put each Wattbike in Just Ride at level 1 and pedal for a few seconds.';
    }

    if (activePlayers.length > 0) {
      return 'Bike signal live. Saved bike IDs will be remembered after refresh.';
    }

    return bridge.status;
  })();
  const connectionState = demoMode || bluetooth.connectedCount > 0 || activePlayers.length > 0
    ? 'open'
    : bikeConnectionSource === 'bluetooth'
      ? bluetooth.supported ? 'idle' : 'error'
      : bridge.connection === 'open' && (bridge.sourceState === 'running' || bridge.sourceState === 'starting')
      ? 'connecting'
      : bridge.connection;
  const showBluetoothPairing = !demoMode && bikeConnectionSource === 'bluetooth';
  const pairingEmptyMessage = demoMode
    ? 'Choose demo riders to generate live race samples.'
    : bikeConnectionSource === 'advanced'
      ? 'Start Advanced Connector, put each Wattbike in Just Ride at resistance level 1, then pedal for ANT+/USB discovery.'
      : bluetooth.supported
        ? 'Press Connect Wattbike to pair Bluetooth bikes. Riders appear only after live bike data is detected.'
        : 'Direct Bluetooth is unavailable in this browser. Use Advanced Connector for ANT+/USB or open the site in a supported browser.';
  const pairingDeviceLabel = bikeConnectionSource === 'advanced' ? 'ANT+ / USB device' : 'Bluetooth bike';

  return (
    <div
      className={`platform-shell${raceViewFullscreen ? ' race-fullscreen' : ''}${mappingFullscreen ? ' map-fullscreen' : ''}`}
      ref={raceShellRef}
    >
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radio size={20} strokeWidth={2.6} />
          </div>
          <div>
            <h1>TrackLab BMX</h1>
            <p>Wattbike training and racing</p>
          </div>
        </div>

        <section className="connection-card">
          <div className="connection-row">
            <span className={`connection-dot ${connectionState}`} />
            <div>
              <strong>{connectionLabel}</strong>
              <span>{activePlayers.length} / {maxPlayers} bikes connected</span>
            </div>
          </div>
          <p>{connectionStatus}</p>
          <div className="connection-source-switch" aria-label="Connection method">
            <button
              className={bikeConnectionSource === 'bluetooth' && !demoMode ? 'selected' : ''}
              type="button"
              onClick={() => handleBikeConnectionSourceChange('bluetooth')}
            >
              <Bluetooth size={15} />
              <span>Bluetooth Direct</span>
            </button>
            <button
              className={bikeConnectionSource === 'advanced' && !demoMode ? 'selected' : ''}
              type="button"
              onClick={() => handleBikeConnectionSourceChange('advanced')}
            >
              <Usb size={15} />
              <span>Advanced Connector</span>
            </button>
            <button
              className={demoMode ? 'selected' : ''}
              type="button"
              onClick={() => handleBikeConnectionSourceChange('demo')}
            >
              <Bike size={15} />
              <span>Demo</span>
            </button>
          </div>
          {bikeConnectionSource === 'bluetooth' && !demoMode && (
            <button
              className="bluetooth-connect-button"
              type="button"
              onClick={bluetooth.connectBike}
              disabled={!bluetooth.supported}
            >
              <Bluetooth size={16} />
              <span>{bluetooth.connectedCount > 0 ? 'Connect Another Wattbike' : 'Connect Wattbike'}</span>
            </button>
          )}
          {bikeConnectionSource === 'advanced' && !demoMode && (
            <div className="bridge-controls">
              <button
                className={bridgeRunning ? 'bridge-control-button stop' : 'bridge-control-button start'}
                type="button"
                onClick={() => {
                  void (bridgeRunning ? bridge.stopLocalBridge() : bridge.startLocalBridge());
                }}
                disabled={bridgeButtonDisabled}
              >
                {bridgeRunning ? <StopCircle size={16} /> : <PlayCircle size={16} />}
                <span>{bridgeButtonLabel}</span>
              </button>
              <span className={`bridge-live-pill ${activePlayers.length > 0 ? 'live' : bridgeRunning ? 'waiting' : ''}`}>
                {activePlayers.length > 0 ? 'Bike connected' : bridgeRunning ? 'Scanning' : 'Idle'}
              </span>
            </div>
          )}
          <div className="bridge-prompt">{bridgePrompt}</div>
        </section>

        <nav className="side-nav" aria-label="Primary">
          <button className={appMode === 'race' ? 'selected' : ''} type="button" onClick={() => setAppMode('race')}>
            <Activity size={17} />
            Dashboard
          </button>
          <button className={appMode === 'monitor' ? 'selected' : ''} type="button" onClick={() => setAppMode('monitor')}>
            <Gauge size={17} />
            Monitor
          </button>
          <button className={appMode === 'diagnostics' ? 'selected' : ''} type="button" onClick={() => setAppMode('diagnostics')}>
            <Settings size={17} />
            Preflight
          </button>
          <button type="button">
            <Route size={17} />
            Tracks
          </button>
          <button type="button">
            <BarChart3 size={17} />
            Analytics
          </button>
          <button type="button">
            <Users size={17} />
            Riders
          </button>
        </nav>

        <PairingRail
          players={pairingPlayers}
          samplesByDevice={samplesByDevice}
          onAssign={demoMode ? () => undefined : assignDevice}
          onAutoAssign={demoMode ? () => undefined : autoAssign}
          onRename={demoMode ? undefined : renamePlayer}
          onBluetoothConnect={showBluetoothPairing ? bluetooth.connectBike : undefined}
          bluetoothSupported={bluetooth.supported}
          bluetoothStatus={bluetooth.status}
          bluetoothDeviceCount={bluetooth.connectedCount}
          title={demoMode ? 'Demo Riders' : 'Detected Bikes'}
          subtitle={demoMode ? `${demoBikeCount} simulated / max ${maxPlayers}` : undefined}
          emptyMessage={pairingEmptyMessage}
          deviceLabel={demoMode ? 'Demo device' : pairingDeviceLabel}
          readOnly={demoMode}
          maxPlayers={maxPlayers}
        />
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          <div className="track-selectors">
            <label>
              <span>Country</span>
              <select value={selectedCountry} onChange={(event) => handleCountryChange(event.target.value)}>
                {countries.map((country) => <option value={country} key={country}>{country}</option>)}
              </select>
            </label>
            <label>
              <span>State / region</span>
              <select value={selectedState} onChange={(event) => handleStateChange(event.target.value)}>
                {states.map((state) => <option value={state} key={state}>{state}</option>)}
              </select>
            </label>
            <label>
              <span>Track</span>
              <select value={selectedTrack.id} onChange={(event) => handleTrackChange(event.target.value)}>
                {availableTracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
              </select>
            </label>
          </div>

          <button className="custom-location-shortcut" type="button" onClick={handleCustomLocationShortcut}>
            <Plus size={16} />
            <span>Custom Location</span>
            <MapPinned size={16} />
          </button>

          <div className="catalog-badge">
            <Database size={16} />
            <span>{catalogTracks.length} track locator records</span>
          </div>

          <div className="global-status">
            <Globe2 size={16} />
            <span>Provider-ready catalog / {selectedTrack.region}</span>
          </div>
        </header>

        {appMode === 'monitor' ? (
          <MonitorView
            players={activePlayers}
            samplesByDevice={samplesByDevice}
            speedUnit={speedUnit}
          />
        ) : appMode === 'diagnostics' ? (
          <DiagnosticsPanel
            bridgeConnection={bridge.connection}
            bridgeMode={bridge.mode}
            bridgeSourceState={bridge.sourceState}
            bridgeStatus={bridge.status}
            bridgeError={bridge.error}
            bridgeControlStatus={bridge.controlStatus}
            bridgeBusy={bridgeBusy}
            bridgeRunning={bridgeRunning}
            bluetoothSupported={bluetooth.supported}
            bluetoothStatus={bluetooth.status}
            bluetoothConnectedCount={bluetooth.connectedCount}
            googleMapsConfigured={hasGoogleMapsApiKey()}
            cloudStatus={cloudUserDataStatus}
            cloudMessage={cloudUserDataMessage}
            profileKey={cloudProfileKey}
            playMode={playMode}
            multiplayerConnection={multiplayer.connection}
            multiplayerStatus={multiplayer.status}
            currentRoomId={multiplayer.currentRoom?.id ?? null}
            inviteUrl={multiplayer.inviteUrl}
            onlineRiderCount={multiplayer.onlineRiders.length}
            track={effectiveTrack}
            hasSavedMapping={Boolean(selectedTrackMapping)}
            customRouteCount={customRoutes.length}
            catalogTrackCount={catalogTracks.length}
            players={activePlayers}
            samplesByDevice={samplesByDevice}
            bikeProfiles={bikeProfiles}
            maxPlayers={maxPlayers}
            demoMode={demoMode}
            demoBikeCount={demoBikeCount}
            demoVariableCount={demo.variableCount}
            distanceUnit={distanceUnit}
            raceCapture={raceCapture}
            onStartBridge={() => {
              void bridge.startLocalBridge();
            }}
            onStopBridge={() => {
              void bridge.stopLocalBridge();
            }}
            onEnableDemoTest={prepareNoBikeDemoTest}
            onEnableMultiplayer={enableMultiplayerTest}
            onCreatePrivateRoom={multiplayer.createPrivateRoom}
            onCopyInvite={shareMultiplayerInvite}
            onCopyProfileKey={copyMultiplayerProfileKey}
            onOpenRace={() => setAppMode('race')}
            onOpenMonitor={() => setAppMode('monitor')}
          />
        ) : (
          <>
            <div className="dashboard-grid">
              <EarthTrackView
                track={effectiveTrack}
                riders={stagedRiders}
                remoteRaceStates={remoteRaceStates}
                players={activePlayers}
                samplesByDevice={samplesByDevice}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                raceState={raceState}
                raceViewFullscreen={raceViewFullscreen}
                startGateActive={startGateStatus.active}
                startGateLightIndex={startGateStatus.lightIndex}
                reactionTimesByPlayer={reactionTimesByPlayer}
                earthAngle={earthAngle}
                earthHeading={earthHeading}
                earthCenter={earthCenter}
                earthZoom={earthZoom}
                activeZones={activeZones}
                canCancelRace={canCancelRace}
                mappingMode={mappingMode}
                mappingFullscreen={mappingFullscreen}
                mappingEditMode={mappingEditMode}
                draftPoints={draftPoints}
                draftZoneMeters={draftZoneMeters}
                draftZonePoints={draftZonePoints}
                draftSplitSections={draftSplitSections}
                draftRouteSplitSections={draftRouteSplitSections}
                draftSplitBuilder={draftSplitBuilder}
                onEarthCameraChange={handleEarthCameraChange}
                onEarthAngleChange={handleEarthAngleChange}
                onEarthHeadingChange={handleEarthHeadingChange}
                onCancelRace={handleCancel}
                onMappingFullscreenChange={handleMappingFullscreenChange}
                onMappingPathPointAdd={handleMappingPathPointAdd}
                onMappingPathPointMove={handleMappingPathPointMove}
                onMappingPathPointRemove={handleMappingPathPointRemove}
                onMappingZonePointAdd={handleMappingZonePointAdd}
                onMappingZonePointMove={handleMappingZonePointMove}
                onMappingZonePointRemove={handleMappingZonePointRemove}
                onMappingSplitPointAdd={handleMappingSplitPointAdd}
                onMappingSplitDrawEnd={handleMappingSplitDrawEnd}
              />

              <SessionControlPanel
                track={effectiveTrack}
                sessionMode={sessionMode}
                intervalMode={intervalMode}
                activeZones={activeZones}
                manualZoneIds={manualZoneIds}
                selectedMetrics={selectedMetrics}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                earthAngle={earthAngle}
                earthHeading={earthHeading}
                customRouteName={customRouteName}
                customRouteLocation={customRouteLocation}
                customRouteStatus={customRouteStatus}
                customRoutePredictions={customRoutePredictions}
                customRoutePredictionStatus={customRoutePredictionStatus}
                selectedCustomRoutePredictionId={selectedCustomRoutePrediction?.id ?? null}
                customRoutes={customRoutes}
                selectedTrackId={selectedTrack.id}
                players={activePlayers}
                branchChoicesByPlayer={activeBranchChoicesByPlayer}
                mappingRouteVariantId={mappingRouteVariantId}
                raceRouteVariantId={raceRouteVariantId}
                savedRouteVariantIds={savedRouteVariantIds}
                hasDualStartRoutes={hasDualStartRoutes}
                raceState={raceState}
                activeBikeCount={activePlayers.length}
                maxPlayers={maxPlayers}
                demoMode={demoMode}
                demoBikeCount={demoBikeCount}
                demoVariableCount={demo.variableCount}
                mappingMode={mappingMode}
                mappingFullscreen={mappingFullscreen}
                mappingEditMode={mappingEditMode}
                draftPointCount={draftPoints.length}
                draftZoneCount={draftPoints.length > 1 ? draftZoneMeters.length + 1 : 0}
                draftLengthMeters={draftLengthMeters}
                draftSplitSections={draftSplitSections}
                draftSplitBuilder={draftSplitBuilder}
                draftSplitBuilderStatus={draftSplitBuilderStatus}
                canSaveDraftSplit={canSaveDraftSplit}
                hasSavedMapping={Boolean(selectedTrackMapping)}
                mappingRestSeconds={mappingRestSeconds}
                startCadenceMode={startCadenceMode}
                countdownSeconds={countdownSeconds}
                startGateActive={startGateStatus.active}
                startGateLabel={startGateStatus.label}
                startGateDetail={startGateStatus.detail}
                onSessionModeChange={setSessionMode}
                onIntervalModeChange={setIntervalMode}
                onManualZoneToggle={toggleManualZone}
                onMetricToggle={toggleMetric}
                onSpeedUnitChange={setSpeedUnit}
                onDistanceUnitChange={setDistanceUnit}
                onEarthAngleChange={handleEarthAngleChange}
                onEarthHeadingChange={handleEarthHeadingChange}
                onCustomRouteNameChange={setCustomRouteName}
                onCustomRouteLocationChange={handleCustomRouteLocationChange}
                onCustomRoutePredictionSelect={handleCustomRoutePredictionSelect}
                onCustomRouteCreate={handleCustomRouteCreate}
                onCustomRouteSelect={handleTrackChange}
                onCustomRouteDelete={handleCustomRouteDelete}
                onBranchChoiceChange={handleBranchChoiceChange}
                onMappingRouteVariantChange={handleMappingRouteVariantChange}
                onRaceRouteVariantChange={handleRaceRouteVariantChange}
                onDemoModeChange={handleDemoModeChange}
                onDemoBikeCountChange={handleDemoBikeCountChange}
                onStartCadenceModeChange={setStartCadenceMode}
                onCountdownSecondsChange={(seconds) => setCountdownSeconds(Math.max(3, Math.min(6, Math.round(seconds))))}
                onMappingModeChange={handleMappingModeChange}
                onMappingFullscreenChange={handleMappingFullscreenChange}
                onMappingEditModeChange={setMappingEditMode}
                onMappingSplitStart={startOrUpdateSplitBuilder}
                onMappingSplitBranchChange={handleSplitBranchChange}
                onMappingSplitSave={saveDraftSplit}
                onMappingSplitCancel={cancelDraftSplit}
                onMappingSplitRemove={removeDraftSplitSection}
                onMappingRestSecondsChange={updateMappingRestSeconds}
                onMappingUndoPoint={undoMappingPoint}
                onMappingClearDraft={clearMappingDraft}
                onMappingSave={saveMapping}
                onMappingRemove={removeMapping}
                onMappingExport={exportMapping}
                onMappingImport={importMapping}
                onPrimeAudio={primeAudioCues}
                onStart={handleStart}
                onCancel={handleCancel}
                onReset={handleReset}
              />
            </div>

            <div className="lower-grid">
              <AnalyticsPanel
                track={effectiveTrack}
                players={activePlayers}
                riders={riders}
                raceSummary={raceSummary}
                samplesByDevice={samplesByDevice}
                selectedMetrics={selectedMetrics}
                reactionTimesByPlayer={reactionTimesByPlayer}
                leaderboardMetric={leaderboardMetric}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                activeZones={activeZones}
                raceCapture={raceCapture}
                onRaceCaptureJsonExport={exportRaceCaptureJson}
                onRaceCaptureCsvExport={exportRaceCaptureCsv}
                onLeaderboardMetricChange={setLeaderboardMetric}
              />

              <MultiplayerPanel
                playMode={playMode}
                connection={multiplayer.connection}
                status={multiplayer.status}
                profileKey={cloudProfileKey}
                riderName={multiplayer.profile.name}
                riderAvailable={multiplayer.profile.available}
                currentUserId={multiplayer.clientId}
                currentRoom={multiplayer.currentRoom}
                rooms={multiplayer.rooms}
                onlineRiders={multiplayer.onlineRiders}
                incomingChallenges={multiplayer.incomingChallenges}
                inviteUrl={multiplayer.inviteUrl}
                track={effectiveTrack}
                players={activePlayers}
                maxPlayers={maxPlayers}
                riders={riders}
                samplesByDevice={samplesByDevice}
                chatMessages={chatMessages}
                roomMessages={multiplayer.roomMessages}
                remoteRaceStates={remoteRaceStates}
                chatDraft={chatDraft}
                onPlayModeChange={setPlayMode}
                onProfileKeyChange={(profileKey) => multiplayer.setProfile({ guestKey: profileKey })}
                onProfileKeyCopy={copyMultiplayerProfileKey}
                onRiderNameChange={(name) => multiplayer.setProfile({ name })}
                onRiderAvailableChange={(available) => multiplayer.setProfile({ available })}
                onCreatePrivateRoom={multiplayer.createPrivateRoom}
                onJoinRoom={multiplayer.joinRoom}
                onLeaveRoom={multiplayer.leaveRoom}
                onShareInvite={shareMultiplayerInvite}
                onRandomTrack={chooseRandomRoomTrack}
                onQuickMatch={multiplayer.quickMatch}
                onChallengeRider={multiplayer.challengeRider}
                onAcceptChallenge={(challengeId) => multiplayer.respondToChallenge(challengeId, true)}
                onDeclineChallenge={(challengeId) => multiplayer.respondToChallenge(challengeId, false)}
                onChatDraftChange={setChatDraft}
                onChatSend={sendChatMessage}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
