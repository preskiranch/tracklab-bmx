import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { MembershipLanding } from './components/MembershipLanding';
import { type ChatMessage, MultiplayerPanel } from './components/MultiplayerPanel';
import { MonitorView } from './components/MonitorView';
import { PairingRail } from './components/PairingRail';
import { RaceReviewPanel } from './components/RaceReviewPanel';
import { SessionControlPanel } from './components/SessionControlPanel';
import {
  bikeConnectionSourceStorageKey,
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
  createTrackZonesForBoundarySets,
  createZoneBoundarySet,
  createTrackZones,
  createUserTrackMapping,
  defaultZoneBoundarySetId,
  distanceBetweenTrackPoints,
  mergeTrackMappingsBySavedAt,
  nearestRouteMeter,
  newestTrackMapping,
  parseUserTrackMapping,
  pointAtRouteMeter,
  draftRouteFromMapping,
  readStoredTrackMappings,
  routeLengthWithDefaultSplitBranches,
  routeLengthMeters,
  routeVariantsFromMapping,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
  splitBranchLabels,
  splitBranchSelectionsForChoice,
  splitDecisionPointsForRoute,
  writeStoredTrackMappings,
  type StoredTrackMappings,
  zoneBoundarySetIdForSelections,
  zoneBoundarySetsFromRouteVariant,
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
import { queueBridgeUserDataPatch, readBridgeUserData } from './lib/localBridgeStore';
import { queueCloudUserDataPatch, readCloudUserData, saveCloudTrackMapping } from './lib/cloudUserData';
import {
  buildGhostLapFromRace,
  ghostsForTrackRoute,
  loadGhostLapsFromCloud,
  mergeGhostLaps,
  playbackGhostLap,
  readStoredGhostLaps,
  syncGhostLapToCloud,
  writeStoredGhostLaps,
} from './lib/ghosts';
import { readPublicTrackMappings } from './lib/publicTrackMappings';
import {
  claimBillingReturn,
  loginAuthUser,
  logoutAuthUser,
  readCurrentAuthUser,
  registerAuthUser,
  type AuthMode,
  type AuthUser,
} from './lib/auth';
import {
  benchmarkDemoTrackId,
  createMembership,
  normalizeAccountEmail,
  readStoredMembership,
  writeStoredMembership,
  type MembershipState,
} from './lib/membership';
import { createInitialRiders } from './game/physics';
import { useRaceEngine } from './hooks/useRaceEngine';
import { useBluetoothBikes } from './hooks/useBluetoothBikes';
import { createDemoPlayers, useDemoBikes } from './hooks/useDemoBikes';
import { useMultiplayer } from './hooks/useMultiplayer';
import { useRoomVoiceChat } from './hooks/useRoomVoiceChat';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import type {
  AppMode,
  BikeProfile,
  BikeSample,
  ConnectedBikeDevice,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  GhostLapPoint,
  IntervalMode,
  LeaderboardEntry,
  LeaderboardMetric,
  MappingEditMode,
  MetricKey,
  MultiplayerRaceState,
  MultiplayerTrackVoteCandidate,
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
  TrackZone,
  TrackZoneBoundarySet,
  TrackZoneBranchSelections,
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
const connectedBikeDeviceTimeoutMs = 15000;

type BikeConnectionSource = 'bluetooth' | 'advanced' | 'demo';
type CheckoutStatus = 'idle' | 'loading' | 'error';
type SplitBranchId = TrackSplitBranch['id'];
type RaceRouteVariantId = TrackRouteVariantId;
type MappingHistoryScope = 'route' | 'zones' | 'split';
type CustomRoutePreview = {
  input: string;
  label?: string;
  point: TrackPoint;
  route: TrackRecord;
  camera: EarthCamera;
};

function isBikeConnectionSource(value: unknown): value is BikeConnectionSource {
  return value === 'bluetooth' || value === 'advanced' || value === 'demo';
}

function browserSupportsBluetoothDirect() {
  return Boolean((navigator as Navigator & { bluetooth?: unknown }).bluetooth);
}

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function requestBrowserFullscreen(element: HTMLElement | null) {
  if (!element || document.fullscreenElement || (document as FullscreenDocument).webkitFullscreenElement) {
    return;
  }

  const fullscreenElement = element as FullscreenElement;
  const requestFullscreen = fullscreenElement.requestFullscreen ?? fullscreenElement.webkitRequestFullscreen;
  if (!requestFullscreen) {
    return;
  }

  try {
    Promise.resolve(requestFullscreen.call(fullscreenElement)).catch(() => undefined);
  } catch {
    // Browsers can reject fullscreen outside a direct user gesture; CSS race view still takes over.
  }
}

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
const zoneBoundaryDuplicateMeters = 3;
const zoneEndpointSnapMeters = 8;
const maxMappingHistoryEntries = 120;

type MappingDraftSnapshot = {
  scope: MappingHistoryScope;
  draftPoints: TrackPoint[];
  draftZoneBoundarySets: TrackZoneBoundarySet[];
  draftSplitSections: TrackSplitSection[];
  draftSplitBuilder: DraftTrackSplit | null;
};

function cloneTrackPoint(point: TrackPoint): TrackPoint {
  return { lat: point.lat, lng: point.lng };
}

function cloneTrackPoints(points: TrackPoint[]) {
  return points.map(cloneTrackPoint);
}

function cloneDraftSplitBuilder(builder: DraftTrackSplit | null): DraftTrackSplit | null {
  if (!builder) {
    return null;
  }

  return {
    ...builder,
    splitPoint: builder.splitPoint ? cloneTrackPoint(builder.splitPoint) : null,
    mergePoint: builder.mergePoint ? cloneTrackPoint(builder.mergePoint) : null,
    branchA: cloneTrackPoints(builder.branchA),
    branchB: cloneTrackPoints(builder.branchB),
  };
}

function cloneTrackSplitSections(sections: TrackSplitSection[]) {
  return sections.map((section) => ({
    ...section,
    splitPoint: cloneTrackPoint(section.splitPoint),
    mergePoint: cloneTrackPoint(section.mergePoint),
    branches: section.branches.map((branch) => ({
      ...branch,
      points: cloneTrackPoints(branch.points),
    })),
  }));
}

function cloneZoneBranchSelections(selections?: TrackZoneBranchSelections): TrackZoneBranchSelections | undefined {
  return selections ? { ...selections } : undefined;
}

function cloneTrackZoneBoundarySets(boundarySets: TrackZoneBoundarySet[]) {
  return boundarySets.map((set) => ({
    ...set,
    branchSelections: cloneZoneBranchSelections(set.branchSelections),
    boundaryMeters: [...set.boundaryMeters],
  }));
}

function zoneBoundarySetsMatch(left: TrackZoneBoundarySet[], right: TrackZoneBoundarySet[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftSet, index) => {
    const rightSet = right[index];
    return Boolean(rightSet)
      && leftSet.id === rightSet.id
      && numbersMatch(leftSet.boundaryMeters, rightSet.boundaryMeters)
      && zoneBoundarySetIdForSelections(leftSet.branchSelections) === zoneBoundarySetIdForSelections(rightSet.branchSelections);
  });
}

function sortTrackZoneBoundarySets(boundarySets: TrackZoneBoundarySet[]) {
  return [...boundarySets].sort((left, right) => {
    if (left.id === defaultZoneBoundarySetId) {
      return -1;
    }
    if (right.id === defaultZoneBoundarySetId) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function numbersMatch(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) < 0.001);
}

function boundaryIntervals(boundaries: number[]) {
  const sorted = [...boundaries].sort((a, b) => a - b);
  const intervals: Array<[number, number]> = [];

  for (let index = 0; index < sorted.length - 1; index += 2) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end - start >= 3) {
      intervals.push([start, end]);
    }
  }

  return intervals;
}

function boundariesFromIntervals(intervals: Array<[number, number]>) {
  return intervals
    .filter(([start, end]) => end - start >= 3)
    .flatMap(([start, end]) => [Math.round(start), Math.round(end)])
    .sort((a, b) => a - b);
}

function splitBranchPoints(section: TrackSplitSection, branch: SplitBranchId) {
  return section.branches.find((candidate) => candidate.id === branch)?.points ?? [
    section.splitPoint,
    section.mergePoint,
  ];
}

function selectedProZoneSection(
  splitSections: TrackSplitSection[],
  selections?: TrackZoneBranchSelections,
) {
  return splitSections.find((section) => selections?.[section.id] === 'b') ?? null;
}

function routeMeterForPoint(route: TrackPoint[], point: TrackPoint) {
  return route.length > 1 ? nearestRouteMeter(route, point) : 0;
}

function proBranchZoneRange(
  route: TrackPoint[],
  section: TrackSplitSection | null,
) {
  if (!section || route.length < 2) {
    return null;
  }

  const branchPoints = splitBranchPoints(section, 'b');
  const start = routeMeterForPoint(route, section.splitPoint);
  const length = routeLengthMeters(branchPoints);
  return {
    start,
    end: start + length,
    length,
    points: branchPoints,
    section,
  };
}

function sharedIntervalsForProSet(
  points: TrackPoint[],
  splitSections: TrackSplitSection[],
  proSelections: TrackZoneBranchSelections | undefined,
  sharedBoundaries: number[],
) {
  const section = selectedProZoneSection(splitSections, proSelections);
  if (!section || sharedBoundaries.length < 2) {
    return [];
  }

  const sharedSelections = splitBranchSelectionsForChoice(splitSections, 'a');
  const sharedRoute = routeWithSplitBranchSelections(points, splitSections, sharedSelections);
  const proRoute = routeWithSplitBranchSelections(points, splitSections, proSelections);
  const sharedBranchPoints = splitBranchPoints(section, 'a');
  const proBranchPoints = splitBranchPoints(section, 'b');
  const sharedSplitStart = routeMeterForPoint(sharedRoute, section.splitPoint);
  const sharedSplitEnd = sharedSplitStart + routeLengthMeters(sharedBranchPoints);
  const proSplitStart = routeMeterForPoint(proRoute, section.splitPoint);
  const proSplitEnd = proSplitStart + routeLengthMeters(proBranchPoints);
  const beforeDelta = proSplitStart - sharedSplitStart;
  const afterDelta = proSplitEnd - sharedSplitEnd;

  return boundaryIntervals(sharedBoundaries).flatMap(([start, end]) => {
    const pieces: Array<[number, number]> = [];
    const beforeEnd = Math.min(end, sharedSplitStart);
    if (beforeEnd - start >= 3) {
      pieces.push([start + beforeDelta, beforeEnd + beforeDelta]);
    }

    const afterStart = Math.max(start, sharedSplitEnd);
    if (end - afterStart >= 3) {
      pieces.push([afterStart + afterDelta, end + afterDelta]);
    }

    return pieces;
  });
}

function mergeProBoundarySetsWithSharedZones(
  points: TrackPoint[],
  splitSections: TrackSplitSection[],
  boundarySets: TrackZoneBoundarySet[],
) {
  if (points.length < 2 || splitSections.length === 0 || boundarySets.length === 0) {
    return boundarySets;
  }

  const sharedSelections = splitBranchSelectionsForChoice(splitSections, 'a');
  const sharedSetId = zoneBoundarySetIdForSelections(sharedSelections);
  const sharedSet = boundarySets.find((set) => set.id === sharedSetId)
    ?? boundarySets.find((set) => set.id === defaultZoneBoundarySetId);

  if (!sharedSet || sharedSet.boundaryMeters.length < 2) {
    return boundarySets;
  }

  return boundarySets.map((set) => {
    const section = selectedProZoneSection(splitSections, set.branchSelections);
    if (!section) {
      return set;
    }

    const proRoute = routeWithSplitBranchSelections(points, splitSections, set.branchSelections);
    const range = proBranchZoneRange(proRoute, section);
    if (!range) {
      return set;
    }

    const proIntervals = boundaryIntervals(set.boundaryMeters).flatMap(([start, end]) => {
      const clippedStart = Math.max(start, range.start);
      const clippedEnd = Math.min(end, range.end);
      return clippedEnd - clippedStart >= 3 ? [[clippedStart, clippedEnd] as [number, number]] : [];
    });
    const sharedIntervals = sharedIntervalsForProSet(points, splitSections, set.branchSelections, sharedSet.boundaryMeters);

    return {
      ...set,
      boundaryMeters: boundariesFromIntervals([...sharedIntervals, ...proIntervals]),
    };
  });
}

function scopedHistoryIndex(stack: MappingDraftSnapshot[], scope: MappingHistoryScope) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].scope === scope) {
      return index;
    }
  }

  return -1;
}

function historyScopeForEditMode(mode: MappingEditMode): MappingHistoryScope {
  if (mode === 'zones') {
    return 'zones';
  }

  if (mode === 'split') {
    return 'split';
  }

  return 'route';
}

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

function mappingZoneMeterFromPoint(route: TrackPoint[], point: TrackPoint) {
  if (route.length < 2) {
    return null;
  }

  const routeLength = routeLengthMeters(route);
  const rawMeter = nearestRouteMeter(route, point);
  const startPoint = route[0];
  const finishPoint = route[route.length - 1];
  if (
    rawMeter <= zoneEndpointSnapMeters
    || distanceBetweenTrackPoints(point, startPoint) <= zoneEndpointSnapMeters
  ) {
    return 0;
  }

  if (
    routeLength - rawMeter <= zoneEndpointSnapMeters
    || distanceBetweenTrackPoints(point, finishPoint) <= zoneEndpointSnapMeters
  ) {
    return routeLength;
  }

  return Math.max(0, Math.min(routeLength, Math.round(rawMeter)));
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
  angle: 56,
  heading: 120,
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

function normalizeBikeName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
}

function isDefaultBikeProfileName(profile: Pick<BikeProfile, 'deviceId' | 'name'>) {
  return normalizeBikeName(profile.name).toLowerCase() === defaultBikeName(profile.deviceId).toLowerCase();
}

function connectedDeviceFromSample(sample: BikeSample): ConnectedBikeDevice {
  return {
    at: sample.at,
    connected: true,
    connectionOrigin: 'bridge-sample',
    deviceId: sample.deviceId,
    label: sample.label,
    signal: sample.signal,
    source: sample.source,
  };
}

function isLiveBikeSample(sample: BikeSample | undefined, now: number) {
  return Boolean(sample && now - sample.at <= liveBikeTimeoutMs);
}

function isSupplementalBikeDevice(device: ConnectedBikeDevice) {
  const label = device.label.toLowerCase();
  const isSpeedOrCadence = /speed\/cadence|speed cadence|\bcadence\b|\bspeed\b/.test(label);
  const isPrimaryPower = /wattbike|bicycle power|cycling power|fitness|power meter|powermeter/.test(label);
  return isSpeedOrCadence && !isPrimaryPower;
}

function isConnectedBikeDevice(device: ConnectedBikeDevice, now: number) {
  if (!device.connected) {
    return false;
  }

  if (device.connectionOrigin === 'direct-bluetooth') {
    return true;
  }

  if (device.connectionOrigin === 'bridge-status' && device.source === 'bluetooth') {
    return true;
  }

  if (device.source === 'usb') {
    return true;
  }

  return Number.isFinite(device.at) && now - Number(device.at) <= connectedBikeDeviceTimeoutMs;
}

function raceBikeDevices(devices: ConnectedBikeDevice[], now: number) {
  const connectedById = new Map<number, ConnectedBikeDevice>();
  devices.forEach((device) => {
    const deviceId = Number(device.deviceId);
    if (!Number.isFinite(deviceId) || deviceId <= 0 || !isConnectedBikeDevice(device, now)) {
      return;
    }

    const normalizedDevice = {
      ...device,
      deviceId: Math.round(deviceId),
      label: device.label || `Wattbike ${Math.round(deviceId)}`,
    };
    const previous = connectedById.get(normalizedDevice.deviceId);
    if (!previous || (normalizedDevice.at ?? 0) >= (previous.at ?? 0)) {
      connectedById.set(normalizedDevice.deviceId, normalizedDevice);
    }
  });

  const connectedDevices = [...connectedById.values()];
  const primaryDevices = connectedDevices.filter((device) => !isSupplementalBikeDevice(device));
  return (primaryDevices.length > 0 ? primaryDevices : connectedDevices)
    .sort((a, b) => a.deviceId - b.deviceId)
    .slice(0, maxPlayers);
}

function createBikeProfile(deviceId: number, index: number, name = defaultBikeName(deviceId)): BikeProfile {
  const visual = profileVisual(index);
  return {
    deviceId,
    name: normalizeBikeName(name) || defaultBikeName(deviceId),
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
  const name = normalizeBikeName(profile.name) || defaultBikeName(deviceId);

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
    if (!current) {
      byDevice.set(normalized.deviceId, normalized);
      return;
    }

    const currentHasCustomName = !isDefaultBikeProfileName(current);
    const nextHasCustomName = !isDefaultBikeProfileName(normalized);
    if (currentHasCustomName !== nextHasCustomName) {
      byDevice.set(normalized.deviceId, nextHasCustomName ? normalized : current);
    } else if (normalized.updatedAt >= current.updatedAt) {
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

function readStoredBikeConnectionSource(): BikeConnectionSource {
  try {
    const stored = window.localStorage.getItem(bikeConnectionSourceStorageKey);
    if (isBikeConnectionSource(stored) && stored !== 'demo') {
      return stored;
    }
  } catch {
    // Ignore blocked storage and fall back to the best available live path.
  }

  return browserSupportsBluetoothDirect() ? 'bluetooth' : 'advanced';
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

function isValidAccountEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAccountEmail(email));
}

export default function App() {
  const bridge = useWattbikeBridge();
  const bluetooth = useBluetoothBikes();
  const raceShellRef = useRef<HTMLDivElement | null>(null);
  const startGateTimeoutsRef = useRef<number[]>([]);
  const startGateSequenceIdRef = useRef(0);
  const capturedSampleKeysRef = useRef<Set<string>>(new Set());
  const lastRaceDebugFrameAtRef = useRef(0);
  const activeRaceSessionIdRef = useRef<string | null>(null);
  const ghostRaceStartedAtRef = useRef<number | null>(null);
  const ghostTraceRef = useRef<Map<PlayerSlot['id'], GhostLapPoint[]>>(new Map());
  const ghostTraceLastSampleAtRef = useRef<Map<PlayerSlot['id'], number>>(new Map());
  const ghostSavedSessionIdsRef = useRef<Set<string>>(new Set());
  const bridgeUserDataLoadedRef = useRef(false);
  const cloudUserDataLoadedKeyRef = useRef<string | null>(null);
  const cloudUserDataAvailableRef = useRef(false);
  const mappingBackfillProfileRef = useRef<string | null>(null);
  const roomTrackApplyRef = useRef<string | null>(null);
  const lastRoomRaceTokenRef = useRef<string | null>(null);
  const roomRaceStartTimeoutRef = useRef<number | null>(null);
  const liveRaceEntryTouchedRef = useRef(false);
  const latestRaceSyncRef = useRef<OutgoingMultiplayerRaceState | null>(null);
  const customRoutePreviewRequestIdRef = useRef(0);
  const customRoutePreviewTrackIdRef = useRef<string | null>(null);
  const initialMembershipRef = useRef<MembershipState | null>(null);
  const raceReviewSessionRef = useRef<string | null>(null);
  if (initialMembershipRef.current === null) {
    initialMembershipRef.current = readStoredMembership();
  }
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
  const storedMappingsRef = useRef(storedMappings);
  const [publicTrackMappings, setPublicTrackMappings] = useState<StoredTrackMappings>({});
  const [mappingSaveStatus, setMappingSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mappingSaveMessage, setMappingSaveMessage] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingFullscreen, setMappingFullscreen] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneBoundarySets, setDraftZoneBoundarySets] = useState<TrackZoneBoundarySet[]>([]);
  const [mappingZoneBranchChoice, setMappingZoneBranchChoice] = useState<SplitBranchId>('a');
  const [draftSplitSections, setDraftSplitSections] = useState<TrackSplitSection[]>([]);
  const [draftSplitBuilder, setDraftSplitBuilder] = useState<DraftTrackSplit | null>(null);
  const mappingUndoStackRef = useRef<MappingDraftSnapshot[]>([]);
  const mappingRedoStackRef = useRef<MappingDraftSnapshot[]>([]);
  const draftMappingStateRef = useRef({
    draftPoints: [] as TrackPoint[],
    draftZoneBoundarySets: [] as TrackZoneBoundarySet[],
    draftSplitSections: [] as TrackSplitSection[],
    draftSplitBuilder: null as DraftTrackSplit | null,
  });
  const [mappingHistoryVersion, setMappingHistoryVersion] = useState(0);
  const [mappingRestSeconds, setMappingRestSeconds] = useState(1);
  const [bikeProfiles, setBikeProfiles] = useState<BikeProfile[]>(readStoredBikeProfiles);
  const [bikeConnectionSource, setBikeConnectionSource] = useState<BikeConnectionSource>(readStoredBikeConnectionSource);
  const [connectorLaunchMessage, setConnectorLaunchMessage] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(Math.min(4, maxPlayers));
  const [demoRaceSeed, setDemoRaceSeed] = useState(() => Date.now());
  const [demoRaceStartedAt, setDemoRaceStartedAt] = useState<number | null>(null);
  const [demoSignalsStopped, setDemoSignalsStopped] = useState(false);
  const [earthCamerasByTrack, setEarthCamerasByTrack] = useState<Record<string, EarthCamera>>(readStoredEarthCameras);
  const [appMode, setAppMode] = useState<AppMode>('race');
  const [membership, setMembership] = useState<MembershipState>(() => initialMembershipRef.current ?? createMembership('visitor'));
  const [showMembershipLanding, setShowMembershipLanding] = useState(() => initialMembershipRef.current?.tier === 'visitor');
  const [checkoutBikeSeats, setCheckoutBikeSeats] = useState(() => Math.max(1, Math.min(maxPlayers, initialMembershipRef.current?.bikeSeats ?? 1)));
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus>('idle');
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'signed-out' | 'signed-in'>('loading');
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [authPasswordDraft, setAuthPasswordDraft] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileEmailDraft, setProfileEmailDraft] = useState('');
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
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
  const [liveRaceReadyDeviceIds, setLiveRaceReadyDeviceIds] = useState<number[]>([]);
  const [lockedRacePlayers, setLockedRacePlayers] = useState<PlayerSlot[] | null>(null);
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
  const [raceReviewVisible, setRaceReviewVisible] = useState(false);
  const [raceReviewRemainingSeconds, setRaceReviewRemainingSeconds] = useState(15);
  const [raceReviewPaused, setRaceReviewPaused] = useState(false);
  const [ghostLaps, setGhostLaps] = useState(readStoredGhostLaps);
  const [selectedGhostIds, setSelectedGhostIds] = useState<string[]>([]);
  const [ghostPlaybackMs, setGhostPlaybackMs] = useState(0);
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
    storedMappingsRef.current = storedMappings;
  }, [storedMappings]);

  useEffect(() => {
    let cancelled = false;
    setAuthStatus('loading');

    readCurrentAuthUser()
      .then((user) => {
        if (cancelled) {
          return;
        }

        setAuthUser(user);
        setAuthStatus(user ? 'signed-in' : 'signed-out');
        if (user) {
          setProfileNameDraft(user.name);
          setProfileEmailDraft(user.email);
          setMembership(user.membership);
          setCheckoutBikeSeats(user.membership.bikeSeats);
        }
      })
      .catch((error: Error) => {
        console.warn(`Could not restore TrackLab login: ${error.message}`);
        if (!cancelled) {
          setAuthUser(null);
          setAuthStatus('signed-out');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeStoredMembership(membership);
  }, [membership]);

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

  useEffect(() => {
    let cancelled = false;
    let loading = false;

    const refreshPublicMappings = () => {
      if (loading || cancelled) {
        return;
      }

      loading = true;
      void readPublicTrackMappings()
        .then((mappings) => {
          if (!cancelled) {
            setPublicTrackMappings((current) => mergeTrackMappingsBySavedAt(current, mappings));
          }
        })
        .catch((error: Error) => {
          console.warn(`Could not load public track mappings: ${error.message}`);
        })
        .finally(() => {
          loading = false;
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshPublicMappings();
      }
    };

    refreshPublicMappings();
    window.addEventListener('focus', refreshPublicMappings);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshPublicMappings);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    draftMappingStateRef.current = {
      draftPoints,
      draftZoneBoundarySets,
      draftSplitSections,
      draftSplitBuilder,
    };
  }, [draftPoints, draftZoneBoundarySets, draftSplitSections, draftSplitBuilder]);

  const bumpMappingHistoryVersion = useCallback(() => {
    setMappingHistoryVersion((version) => version + 1);
  }, []);

  const createMappingSnapshot = useCallback((scope: MappingHistoryScope): MappingDraftSnapshot => {
    const current = draftMappingStateRef.current;
    return {
      scope,
      draftPoints: cloneTrackPoints(current.draftPoints),
      draftZoneBoundarySets: cloneTrackZoneBoundarySets(current.draftZoneBoundarySets),
      draftSplitSections: cloneTrackSplitSections(current.draftSplitSections),
      draftSplitBuilder: cloneDraftSplitBuilder(current.draftSplitBuilder),
    };
  }, []);

  const applyMappingSnapshot = useCallback((snapshot: MappingDraftSnapshot) => {
    const nextDraftPoints = cloneTrackPoints(snapshot.draftPoints);
    const nextDraftZoneBoundarySets = cloneTrackZoneBoundarySets(snapshot.draftZoneBoundarySets);
    const nextDraftSplitSections = cloneTrackSplitSections(snapshot.draftSplitSections);
    const nextDraftSplitBuilder = cloneDraftSplitBuilder(snapshot.draftSplitBuilder);

    draftMappingStateRef.current = {
      draftPoints: nextDraftPoints,
      draftZoneBoundarySets: nextDraftZoneBoundarySets,
      draftSplitSections: nextDraftSplitSections,
      draftSplitBuilder: nextDraftSplitBuilder,
    };
    setDraftPoints(nextDraftPoints);
    setDraftZoneBoundarySets(nextDraftZoneBoundarySets);
    setDraftSplitSections(nextDraftSplitSections);
    setDraftSplitBuilder(nextDraftSplitBuilder);
  }, []);

  const clearMappingHistory = useCallback(() => {
    mappingUndoStackRef.current = [];
    mappingRedoStackRef.current = [];
    bumpMappingHistoryVersion();
  }, [bumpMappingHistoryVersion]);

  const rememberMappingEdit = useCallback((scope: MappingHistoryScope) => {
    mappingUndoStackRef.current = [
      ...mappingUndoStackRef.current,
      createMappingSnapshot(scope),
    ].slice(-maxMappingHistoryEntries);
    mappingRedoStackRef.current = [];
    bumpMappingHistoryVersion();
  }, [bumpMappingHistoryVersion, createMappingSnapshot]);

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
  useEffect(() => {
    setMappingSaveStatus('idle');
    setMappingSaveMessage(null);
  }, [selectedTrack.id]);
  const selectedTrackMapping = newestTrackMapping(
    storedMappings[selectedTrack.id],
    publicTrackMappings[selectedTrack.id],
  );
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
  const effectiveRouteLengthMeters = useMemo(() => {
    if (!effectiveTrack.centerline || effectiveTrack.centerline.length < 2) {
      return effectiveTrack.lengthMeters;
    }

    return Math.round(routeLengthWithDefaultSplitBranches(
      effectiveTrack.centerline,
      effectiveTrack.splitSections ?? [],
    ));
  }, [effectiveTrack.centerline, effectiveTrack.lengthMeters, effectiveTrack.splitSections]);
  const multiplayerVoteCandidates = useMemo<MultiplayerTrackVoteCandidate[]>(() => {
    return catalogTracks.flatMap((track) => {
      const mapping = newestTrackMapping(storedMappings[track.id], publicTrackMappings[track.id]);
      if (!mapping || mapping.centerline.length < 2) {
        return [];
      }

      const routeVariants = mapping.routeVariants ?? [];
      const zoneCount = mapping.zones.length
        + routeVariants.reduce((count, variant) => count + variant.zones.length, 0);
      if (zoneCount === 0) {
        return [];
      }

      return [{
        id: track.id,
        name: mapping.trackName || track.name,
        country: track.country,
        state: track.state,
        hasPedalZones: true,
        hasSplits: (mapping.splitSections?.length ?? 0) > 0
          || routeVariants.some((variant) => (variant.splitSections?.length ?? 0) > 0),
      }];
    });
  }, [catalogTracks, publicTrackMappings, storedMappings]);

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
  const draftZoneBranchSelections = useMemo(
    () => (draftRouteSplitSections.length > 0
      ? splitBranchSelectionsForChoice(draftRouteSplitSections, mappingZoneBranchChoice)
      : undefined),
    [draftRouteSplitSections, mappingZoneBranchChoice],
  );
  const draftZoneStorageRoutePoints = useMemo(
    () => routeWithSplitBranchSelections(draftPoints, draftRouteSplitSections, draftZoneBranchSelections),
    [draftPoints, draftRouteSplitSections, draftZoneBranchSelections],
  );
  const draftZoneProSection = useMemo(
    () => (mappingZoneBranchChoice === 'b'
      ? selectedProZoneSection(draftRouteSplitSections, draftZoneBranchSelections)
      : null),
    [draftRouteSplitSections, draftZoneBranchSelections, mappingZoneBranchChoice],
  );
  const draftZoneProRange = useMemo(
    () => proBranchZoneRange(draftZoneStorageRoutePoints, draftZoneProSection),
    [draftZoneProSection, draftZoneStorageRoutePoints],
  );
  const draftZoneBoundarySetId = useMemo(
    () => zoneBoundarySetIdForSelections(draftZoneBranchSelections),
    [draftZoneBranchSelections],
  );
  const draftRidePoints = useMemo(
    () => routeWithDefaultSplitBranches(draftPoints, draftRouteSplitSections),
    [draftPoints, draftRouteSplitSections],
  );
  const draftZoneRidePoints = useMemo(
    () => (draftZoneProRange ? draftZoneProRange.points : draftZoneStorageRoutePoints),
    [draftZoneProRange, draftZoneStorageRoutePoints],
  );
  const draftZoneStorageMeters = useMemo(
    () => draftZoneBoundarySets.find((set) => set.id === draftZoneBoundarySetId)?.boundaryMeters ?? [],
    [draftZoneBoundarySetId, draftZoneBoundarySets],
  );
  const draftZoneMeters = useMemo(
    () => {
      if (!draftZoneProRange) {
        return draftZoneStorageMeters;
      }

      return draftZoneStorageMeters
        .filter((meter) => meter >= draftZoneProRange.start - 0.5 && meter <= draftZoneProRange.end + 0.5)
        .map((meter) => Math.max(0, Math.min(draftZoneProRange.length, Math.round(meter - draftZoneProRange.start))));
    },
    [draftZoneProRange, draftZoneStorageMeters],
  );
  const draftZonePoints = useMemo(
    () => draftZoneMeters
      .map((meter) => pointAtRouteMeter(draftZoneRidePoints, meter))
      .filter((point): point is TrackPoint => point != null),
    [draftZoneMeters, draftZoneRidePoints],
  );
  const draftLengthMeters = useMemo(
    () => (draftPoints.length > 1 ? routeLengthWithDefaultSplitBranches(draftPoints, draftRouteSplitSections) : 0),
    [draftPoints, draftRouteSplitSections],
  );
  const draftZoneRouteLengthMeters = useMemo(
    () => (draftZoneRidePoints.length > 1 ? routeLengthMeters(draftZoneRidePoints) : 0),
    [draftZoneRidePoints],
  );
  const draftZoneStorageLengthMeters = useMemo(
    () => (draftZoneStorageRoutePoints.length > 1 ? routeLengthMeters(draftZoneStorageRoutePoints) : draftZoneRouteLengthMeters),
    [draftZoneRouteLengthMeters, draftZoneStorageRoutePoints],
  );
  const draftZones = useMemo(
    () => (draftZoneRouteLengthMeters > 0
      ? createTrackZones(draftZoneRouteLengthMeters, draftZoneMeters, [], mappingRestSeconds, draftZoneBranchSelections)
      : []),
    [draftZoneBranchSelections, draftZoneMeters, draftZoneRouteLengthMeters, mappingRestSeconds],
  );
  const draftReferenceZones = useMemo<TrackZone[]>(() => {
    if (!draftZoneProRange || !draftZoneProSection || draftRouteSplitSections.length === 0) {
      return [];
    }

    const sharedSelections = splitBranchSelectionsForChoice(draftRouteSplitSections, 'a');
    const sharedSetId = zoneBoundarySetIdForSelections(sharedSelections);
    const sharedSet = draftZoneBoundarySets.find((set) => set.id === sharedSetId)
      ?? draftZoneBoundarySets.find((set) => set.id === defaultZoneBoundarySetId);
    if (!sharedSet || sharedSet.boundaryMeters.length < 2) {
      return [];
    }

    const sharedRoute = routeWithSplitBranchSelections(draftPoints, draftRouteSplitSections, sharedSelections);
    const sharedSplitStart = routeMeterForPoint(sharedRoute, draftZoneProSection.splitPoint);
    const sharedSplitEnd = sharedSplitStart + routeLengthMeters(splitBranchPoints(draftZoneProSection, 'a'));
    const sharedIntervals: Array<[number, number]> = boundaryIntervals(sharedSet.boundaryMeters).flatMap(([start, end]) => {
      const pieces: Array<[number, number]> = [];
      const beforeEnd = Math.min(end, sharedSplitStart);
      if (beforeEnd - start >= 3) {
        pieces.push([start, beforeEnd]);
      }

      const afterStart = Math.max(start, sharedSplitEnd);
      if (end - afterStart >= 3) {
        pieces.push([afterStart, end]);
      }

      return pieces;
    });

    return createTrackZones(
      routeLengthMeters(sharedRoute),
      boundariesFromIntervals(sharedIntervals),
      [],
      mappingRestSeconds,
      sharedSelections,
      'shared-pedal-zone',
    );
  }, [
    draftPoints,
    draftRouteSplitSections,
    draftZoneBoundarySets,
    draftZoneProRange,
    draftZoneProSection,
    mappingRestSeconds,
  ]);
  const allDraftZones = useMemo(
    () => (draftPoints.length > 1
      ? createTrackZonesForBoundarySets(draftPoints, draftRouteSplitSections, draftZoneBoundarySets, mappingRestSeconds)
      : []),
    [draftPoints, draftRouteSplitSections, draftZoneBoundarySets, mappingRestSeconds],
  );
  const normalizeDraftZoneBoundarySetsForRoute = useCallback((
    points: TrackPoint[],
    splitSections: TrackSplitSection[],
    boundarySets: TrackZoneBoundarySet[],
  ) => {
    const mergedBoundarySets = mergeProBoundarySetsWithSharedZones(points, splitSections, boundarySets);
    return sortTrackZoneBoundarySets(mergedBoundarySets.map((set) => {
      const route = routeWithSplitBranchSelections(points, splitSections, set.branchSelections);
      return createZoneBoundarySet(
        set.branchSelections,
        set.boundaryMeters,
        splitSections,
        routeLengthMeters(route),
      );
    })
      .filter((set) => set.boundaryMeters.length > 0 || set.id === defaultZoneBoundarySetId));
  }, []);
  const updateCurrentDraftZoneMeters = useCallback((nextMeters: number[]) => {
    const storageMeters = draftZoneProRange
      ? nextMeters.map((meter) => draftZoneProRange.start + meter)
      : nextMeters;
    const nextSet = createZoneBoundarySet(
      draftZoneBranchSelections,
      storageMeters,
      draftRouteSplitSections,
      draftZoneStorageLengthMeters,
    );

    setDraftZoneBoundarySets((current) => {
      const nextRaw = [
        ...current.filter((set) => set.id !== nextSet.id),
        ...(nextSet.boundaryMeters.length > 0 || nextSet.id === defaultZoneBoundarySetId ? [nextSet] : []),
      ];
      const next = sortTrackZoneBoundarySets(mergeProBoundarySetsWithSharedZones(
        draftPoints,
        draftRouteSplitSections,
        nextRaw,
      ));
      return zoneBoundarySetsMatch(current, next) ? current : next;
    });
  }, [
    draftPoints,
    draftRouteSplitSections,
    draftZoneBranchSelections,
    draftZoneProRange,
    draftZoneStorageLengthMeters,
  ]);
  const mappingHistoryScope = historyScopeForEditMode(mappingEditMode);
  const canUndoMapping = useMemo(
    () => scopedHistoryIndex(mappingUndoStackRef.current, mappingHistoryScope) >= 0,
    [mappingHistoryScope, mappingHistoryVersion],
  );
  const canRedoMapping = useMemo(
    () => scopedHistoryIndex(mappingRedoStackRef.current, mappingHistoryScope) >= 0,
    [mappingHistoryScope, mappingHistoryVersion],
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
  const liveBikeDeviceIds = useMemo(() => {
    const deviceIds = new Set<number>();
    connectedBikeSamples.forEach((sample, deviceId) => {
      if (isLiveBikeSample(sample, now)) {
        deviceIds.add(deviceId);
      }
    });
    return deviceIds;
  }, [connectedBikeSamples, now]);
  const connectedBikeDevices = useMemo(() => {
    const devices: ConnectedBikeDevice[] = [
      ...bridge.devices,
      ...bluetooth.devices,
    ];

    connectedBikeSamples.forEach((sample) => {
      if (now - sample.at <= connectedBikeDeviceTimeoutMs) {
        devices.push(connectedDeviceFromSample(sample));
      }
    });

    return raceBikeDevices(devices, now)
      .filter((device) => liveBikeDeviceIds.has(device.deviceId));
  }, [bluetooth.devices, bridge.devices, connectedBikeSamples, liveBikeDeviceIds, now]);
  const connectedBikeDeviceById = useMemo(
    () => new Map(connectedBikeDevices.map((device) => [device.deviceId, device])),
    [connectedBikeDevices],
  );
  const connectedDeviceIds = useMemo(
    () => connectedBikeDevices.map((device) => device.deviceId),
    [connectedBikeDevices],
  );
  const profileByDevice = useMemo(
    () => new Map(bikeProfiles.map((profile) => [profile.deviceId, profile])),
    [bikeProfiles],
  );
  const sessionPlayers = useMemo(
    () => connectedDeviceIds.map((deviceId, index) => {
      const visual = profileVisual(index);
      const profile = profileByDevice.get(deviceId);
      const connectedDevice = connectedBikeDeviceById.get(deviceId);
      const sample = connectedBikeSamples.get(deviceId);

      return {
        id: visual.id,
        name: profile?.name ?? defaultBikeName(deviceId),
        colorName: profile?.colorName ?? visual.colorName,
        accent: profile?.accent ?? visual.accent,
        deviceId,
        deviceLabel: connectedDevice?.label ?? sample?.label,
        deviceSource: connectedDevice?.source ?? sample?.source,
      };
    }),
    [connectedBikeDeviceById, connectedBikeSamples, connectedDeviceIds, profileByDevice],
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
  const enteredRacePlayers = useMemo(() => {
    if (demoMode) {
      return activePlayers;
    }

    const readyDeviceIds = new Set(liveRaceReadyDeviceIds);
    return activePlayers.filter((player) => player.deviceId != null && readyDeviceIds.has(player.deviceId));
  }, [activePlayers, demoMode, liveRaceReadyDeviceIds]);
  const multiplayer = useMultiplayer({
    enabled: playMode === 'multiplayer',
    track: effectiveTrack,
    bikeCount: demoMode ? activePlayers.length : enteredRacePlayers.length,
  });
  const roomVoice = useRoomVoiceChat({
    currentRoom: multiplayer.currentRoom,
    currentUserId: multiplayer.clientId,
    voiceSignals: multiplayer.voiceSignals,
    sendVoiceSignal: multiplayer.sendVoiceSignal,
  });
  const localRaceSeatLimit = useMemo(() => {
    const raceCandidateCount = lockedRacePlayers?.length ?? (demoMode ? activePlayers.length : enteredRacePlayers.length);
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      return raceCandidateCount;
    }

    const roomMember = multiplayer.currentRoom.members.find((member) => member.id === multiplayer.clientId);
    if (roomMember?.roomRole === 'spectator') {
      return 0;
    }

    const assignedSeatCount = roomMember?.racerSeatCount ?? raceCandidateCount;
    return Math.max(0, Math.min(raceCandidateCount, assignedSeatCount));
  }, [activePlayers.length, demoMode, enteredRacePlayers.length, lockedRacePlayers?.length, multiplayer.clientId, multiplayer.currentRoom, playMode]);
  const raceCandidatePlayers = lockedRacePlayers ?? enteredRacePlayers;
  const racePlayers = useMemo(
    () => raceCandidatePlayers.slice(0, localRaceSeatLimit),
    [localRaceSeatLimit, raceCandidatePlayers],
  );
  const cloudProfileKey = authUser?.profileKey ?? multiplayer.profile.guestKey;
  const accountEmail = normalizeAccountEmail(authUser?.email ?? '');
  const accountProfileComplete = authStatus === 'signed-in' && Boolean(authUser);
  const adminProfileActive = Boolean(authUser?.admin);
  const ghostRouteVariantId = effectiveTrack.activeRouteVariantId ?? (hasDualStartRoutes ? raceRouteVariantId : undefined);
  const availableGhostLaps = useMemo(
    () => ghostsForTrackRoute(ghostLaps, effectiveTrack.id, ghostRouteVariantId),
    [effectiveTrack.id, ghostLaps, ghostRouteVariantId],
  );
  const selectedGhostLaps = useMemo(
    () => availableGhostLaps.filter((ghost) => selectedGhostIds.includes(ghost.id)),
    [availableGhostLaps, selectedGhostIds],
  );
  const selectedGhostRiders = useMemo(
    () => selectedGhostLaps
      .map((ghost, index) => playbackGhostLap(ghost, ghostPlaybackMs, index))
      .filter((ghost): ghost is NonNullable<typeof ghost> => ghost != null),
    [ghostPlaybackMs, selectedGhostLaps],
  );
  const friendGhostKeySignature = useMemo(
    () => multiplayer.social.friends.map((friend) => friend.guestKey).sort().join(','),
    [multiplayer.social.friends],
  );

  useEffect(() => {
    if (authStatus !== 'loading' && !accountProfileComplete) {
      setShowMembershipLanding(true);
    }
  }, [accountProfileComplete, authStatus]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    if (
      membership.tier !== authUser.membership.tier
      || membership.bikeSeats !== authUser.membership.bikeSeats
    ) {
      setMembership(authUser.membership);
      setCheckoutBikeSeats(authUser.membership.bikeSeats);
    }

    if (
      multiplayer.profile.guestKey !== authUser.profileKey
      || multiplayer.profile.name !== authUser.name
      || multiplayer.profile.email !== authUser.email
      || multiplayer.profile.membershipTier !== authUser.membership.tier
    ) {
      multiplayer.setProfile({
        guestKey: authUser.profileKey,
        name: authUser.name,
        email: authUser.email,
        membershipTier: authUser.membership.tier,
      });
    }
  }, [
    authUser,
    membership.bikeSeats,
    membership.tier,
    multiplayer.profile.email,
    multiplayer.profile.guestKey,
    multiplayer.profile.membershipTier,
    multiplayer.profile.name,
    multiplayer.setProfile,
  ]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') !== 'success' || params.get('tier') !== 'racer') {
      return;
    }

    const billingState = params.get('billingState') ?? '';
    const cleanUrl = new URL(window.location.href);
    ['billing', 'tier', 'bikes', 'billingState', 'checkoutId', 'orderId', 'referenceId', 'transactionId', 'profileKey']
      .forEach((key) => cleanUrl.searchParams.delete(key));
    window.history.replaceState(null, '', cleanUrl);

    if (!billingState) {
      setCheckoutStatus('error');
      setCheckoutMessage('Square returned without a TrackLab verification code. Racer access was not changed.');
      return;
    }

    claimBillingReturn(billingState)
      .then((user) => {
        if (!user) {
          return;
        }
        setAuthUser(user);
        setMembership(user.membership);
        setCheckoutBikeSeats(user.membership.bikeSeats);
        setCheckoutMessage('Racer access activated.');
      })
      .catch((error: Error) => {
        setCheckoutMessage(`Square checkout returned, but Racer access could not be saved. ${error.message}`);
      });
  }, [authUser?.id]);

  const livePlayerCount = useMemo(
    () => activePlayers.filter((player) => {
      if (player.deviceId == null) {
        return false;
      }

      return isLiveBikeSample(samplesByDevice.get(player.deviceId), now);
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
      return mappedZones;
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
    return racePlayers.reduce<Partial<Record<PlayerSlot['id'], SplitBranchId>>>((choices, player, index) => {
      choices[player.id] = branchChoicesByPlayer[player.id]
        ?? (demoMode && splitDecisionPoints.length > 0
          ? ((index + seedOffset) % 2 === 0 ? 'a' : 'b')
          : 'a');
      return choices;
    }, {});
  }, [branchChoicesByPlayer, demoMode, demoRaceSeed, racePlayers, splitDecisionPoints.length]);
  useEffect(() => {
    const roomFlow = multiplayer.currentRoom?.flow;
    const clientId = multiplayer.clientId;
    if (playMode !== 'multiplayer' || roomFlow?.phase !== 'route-select' || !clientId) {
      return;
    }

    const roomChoice = roomFlow.routeChoices[clientId] ?? 'a';
    setBranchChoicesByPlayer((current) => {
      let changed = false;
      const next = { ...current };
      racePlayers.forEach((player) => {
        if (next[player.id] !== roomChoice) {
          next[player.id] = roomChoice;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [multiplayer.clientId, multiplayer.currentRoom?.flow, playMode, racePlayers]);
  const { raceState, riders, raceSummary, startRace, resetRace } = useRaceEngine(
    racePlayers,
    samplesByDevice,
    effectiveRouteLengthMeters,
    activeBranchChoicesByPlayer,
    splitDecisionPoints,
    activeZones,
  );
  const raceViewFullscreen = startGateStatus.active || raceState === 'racing';
  const stagedRiders = useMemo(() => {
    if (!startGateStatus.active || raceState === 'racing') {
      return riders;
    }

    const liveRidersByPlayer = new Map(riders.map((rider) => [rider.playerId, rider]));
    return createInitialRiders(racePlayers, activeBranchChoicesByPlayer).map((rider) => {
      const liveRider = liveRidersByPlayer.get(rider.playerId);
      return liveRider && liveRider.distance <= 1 && !liveRider.finishedAt ? liveRider : rider;
    });
  }, [activeBranchChoicesByPlayer, racePlayers, raceState, riders, startGateStatus.active]);
  const canCancelRace = startGateStatus.active || raceState === 'racing';

  const releaseRaceFullscreen = useCallback(() => {
    releaseBrowserFullscreen();
  }, []);

  const clearStartGateSequence = useCallback(() => {
    startGateSequenceIdRef.current += 1;
    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    stopStartGateAudio();
    setStartGateStatus(idleStartGateStatus);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, []);

  useEffect(() => {
    if (multiplayer.currentRoom?.flow.phase === 'race') {
      return;
    }

    if (roomRaceStartTimeoutRef.current != null) {
      window.clearTimeout(roomRaceStartTimeoutRef.current);
      roomRaceStartTimeoutRef.current = null;
    }
  }, [multiplayer.currentRoom?.flow.phase]);

  useEffect(() => () => {
    if (roomRaceStartTimeoutRef.current != null) {
      window.clearTimeout(roomRaceStartTimeoutRef.current);
      roomRaceStartTimeoutRef.current = null;
    }
  }, []);

  const prepareForTrackSelection = useCallback((nextTrackId: string) => {
    pendingInitialTrackIdRef.current = null;
    setInitialUrlTrackPending(false);
    selectedTrackIdRef.current = nextTrackId;
    clearStartGateSequence();
    setMappingFullscreen(false);
    setRaceReviewVisible(false);
    setRaceReviewPaused(false);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setLockedRacePlayers(null);
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
      riders: racePlayers
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
  }, [effectiveTrack.id, multiplayer.currentRoom, playMode, raceCapture?.sessionId, racePlayers, raceState, raceSummary, riders, samplesByDevice]);

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
    lastRaceDebugFrameAtRef.current = 0;
    activeRaceSessionIdRef.current = sessionId;
    ghostRaceStartedAtRef.current = null;
    ghostTraceRef.current = new Map();
    ghostTraceLastSampleAtRef.current = new Map();

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
        routeLengthMeters: effectiveRouteLengthMeters,
      },
      sessionMode,
      selectedMetrics,
      players: racePlayers.map((player) => ({
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
      frames: [],
      reactionTimesByPlayer: {},
      summary: [],
    };

    setRaceCapture(capture);
  }, [activeZones, demoMode, effectiveRouteLengthMeters, effectiveTrack, racePlayers, selectedMetrics, sessionMode]);

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
    if (reactionStartAt == null || racePlayers.length === 0) {
      return;
    }

    setReactionTimesByPlayer((current) => {
      let changed = false;
      const next: ReactionTimesByPlayer = { ...current };

      racePlayers.forEach((player) => {
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
  }, [racePlayers, reactionStartAt, samplesByDevice]);

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
    setLiveRaceReadyDeviceIds((current) => {
      if (demoMode) {
        liveRaceEntryTouchedRef.current = false;
        return current.length === 0 ? current : [];
      }

      if (connectedDeviceIds.length === 0) {
        liveRaceEntryTouchedRef.current = false;
        return current.length === 0 ? current : [];
      }

      const connectedIds = new Set(connectedDeviceIds);
      const pruned = current.filter((deviceId) => connectedIds.has(deviceId));
      if (connectedDeviceIds.length > 1 && !liveRaceEntryTouchedRef.current) {
        return pruned.length === 0 ? current : [];
      }

      if (pruned.length === 0 && connectedDeviceIds.length === 1) {
        return [connectedDeviceIds[0]];
      }

      const unchanged = pruned.length === current.length
        && pruned.every((deviceId, index) => deviceId === current[index]);
      return unchanged ? current : pruned;
    });
  }, [connectedDeviceIds, demoMode]);

  useEffect(() => {
    if (bikeConnectionSource === 'demo') {
      return;
    }

    window.localStorage.setItem(bikeConnectionSourceStorageKey, bikeConnectionSource);
  }, [bikeConnectionSource]);

  useEffect(() => {
    if (!demoMode && bluetooth.connectedCount > 0 && bikeConnectionSource !== 'bluetooth') {
      setBikeConnectionSource('bluetooth');
    }
  }, [bikeConnectionSource, bluetooth.connectedCount, demoMode]);

  useEffect(() => {
    if (
      demoMode
      || bikeConnectionSource !== 'advanced'
      || membership.tier !== 'racer'
      || bridge.connection !== 'open'
      || bridge.sourceState !== 'idle'
    ) {
      return;
    }

    void bridge.startLocalBridge();
  }, [
    bikeConnectionSource,
    bridge.connection,
    bridge.sourceState,
    bridge.startLocalBridge,
    demoMode,
    membership.tier,
  ]);

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
          const next = mergeTrackMappingsBySavedAt(current, data.trackMappings);
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
    let loading = false;
    cloudUserDataLoadedKeyRef.current = null;
    cloudUserDataAvailableRef.current = false;
    setCloudUserDataStatus('loading');
    setCloudUserDataMessage('Loading cloud profile data.');

    const refreshCloudUserData = () => {
      if (loading || cancelled) {
        return;
      }

      loading = true;
      void readCloudUserData(cloudProfileKey)
        .then((data) => {
          if (cancelled) {
            return;
          }

          setStoredMappings((current) => {
            const next = mergeTrackMappingsBySavedAt(current, data.trackMappings);
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

          if (authUser && mappingBackfillProfileRef.current !== cloudProfileKey) {
            mappingBackfillProfileRef.current = cloudProfileKey;
            const unsyncedMappings = Object.values(storedMappingsRef.current).filter((localMapping) => {
              const cloudMapping = data.trackMappings[localMapping.trackId];
              return newestTrackMapping(cloudMapping, localMapping) === localMapping
                && localMapping.savedAt !== cloudMapping?.savedAt;
            });

            if (unsyncedMappings.length > 0) {
              void Promise.allSettled(unsyncedMappings.map(saveCloudTrackMapping)).then((results) => {
                if (cancelled) {
                  return;
                }

                const savedMappings: StoredTrackMappings = {};
                const publishedMappings: StoredTrackMappings = {};
                results.forEach((result) => {
                  if (result.status !== 'fulfilled') {
                    return;
                  }
                  savedMappings[result.value.mapping.trackId] = result.value.mapping;
                  if (result.value.publicMapping) {
                    publishedMappings[result.value.publicMapping.trackId] = result.value.publicMapping;
                  }
                });
                if (Object.keys(savedMappings).length > 0) {
                  setStoredMappings((current) => mergeTrackMappingsBySavedAt(current, savedMappings));
                  setPublicTrackMappings((current) => mergeTrackMappingsBySavedAt(current, publishedMappings));
                  setCloudUserDataMessage(
                    `Recovered ${Object.keys(savedMappings).length} newer local track map${Object.keys(savedMappings).length === 1 ? '' : 's'} to this profile.`,
                  );
                }
                if (results.every((result) => result.status === 'rejected')) {
                  mappingBackfillProfileRef.current = null;
                }
              });
            }
          }
        })
        .catch((error: Error) => {
          console.warn(`Could not load TrackLab cloud user data: ${error.message}`);
          if (!cancelled) {
            cloudUserDataAvailableRef.current = false;
            cloudUserDataLoadedKeyRef.current = cloudProfileKey;
            setCloudUserDataStatus('offline');
            setCloudUserDataMessage(`Cloud profile unavailable. Local browser storage is still active. ${error.message}`);
          }
        })
        .finally(() => {
          loading = false;
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshCloudUserData();
      }
    };

    refreshCloudUserData();
    window.addEventListener('focus', refreshCloudUserData);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshCloudUserData);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [authUser, cloudProfileKey]);

  useEffect(() => {
    writeStoredBikeProfiles(bikeProfiles);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
        void queueCloudUserDataPatch(cloudProfileKey, { bikeProfiles })
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

    void queueBridgeUserDataPatch({ bikeProfiles }).catch((error: Error) => {
      console.warn(`Could not save bike profiles to TrackLab bridge: ${error.message}`);
    });
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void queueCloudUserDataPatch(cloudProfileKey, { bikeProfiles })
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
        void queueCloudUserDataPatch(cloudProfileKey, { customRoutes })
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

    void queueBridgeUserDataPatch({ customRoutes }).catch((error: Error) => {
      console.warn(`Could not save custom routes to TrackLab bridge: ${error.message}`);
    });
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void queueCloudUserDataPatch(cloudProfileKey, { customRoutes })
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
      return;
    }

    void queueBridgeUserDataPatch({ trackMappings: storedMappings }).catch((error: Error) => {
      console.warn(`Could not save track mappings to TrackLab bridge: ${error.message}`);
    });
  }, [bridge.connection, storedMappings]);

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
    (window as typeof window & { __tracklabLastRaceCapture?: RaceCapture | null }).__tracklabLastRaceCapture = raceCapture;
  }, [raceCapture]);

  useEffect(() => {
    const liveDebug = {
      at: Date.now(),
      selectedTrackId: selectedTrack.id,
      effectiveTrackId: effectiveTrack.id,
      effectiveTrackName: effectiveTrack.name,
      raceState,
      raceViewFullscreen,
      trackLengthMeters: effectiveTrack.lengthMeters,
      routeLengthMeters: effectiveRouteLengthMeters,
      racePlayerCount: racePlayers.length,
      players: racePlayers.map((player) => {
        const rider = riders.find((item) => item.playerId === player.id);
        const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
        const nowMs = Date.now();

        return {
          playerId: player.id,
          riderName: player.name,
          deviceId: player.deviceId,
          sampleAt: sample?.at ?? null,
          sampleAgeMs: sample ? nowMs - sample.at : null,
          sampleSource: sample?.source ?? null,
          watts: sample?.watts ?? null,
          cadence: sample?.cadence ?? null,
          speedKph: sample?.speedKph ?? null,
          riderDistanceMeters: rider?.distance ?? null,
          riderVelocityMps: rider?.velocity ?? null,
          riderDriveSource: rider?.driveSource ?? null,
          riderDriveAllowed: rider?.driveAllowed ?? null,
          riderRawWatts: rider?.lastRawWatts ?? null,
          riderRawCadence: rider?.lastRawCadence ?? null,
          riderRawSpeedKph: rider?.lastRawSpeedKph ?? null,
          finishedAt: rider?.finishedAt ?? null,
        };
      }),
      capture: raceCapture
        ? {
          sessionId: raceCapture.sessionId,
          status: raceCapture.status,
          samples: raceCapture.samples.length,
          frames: raceCapture.frames?.length ?? 0,
        }
        : null,
    };

    (window as typeof window & { __tracklabLiveDebug?: unknown }).__tracklabLiveDebug = liveDebug;
    window.localStorage.setItem('tracklab-live-debug', JSON.stringify(liveDebug));
    document.documentElement.setAttribute('data-tracklab-live-debug', JSON.stringify(liveDebug));
  }, [
    effectiveRouteLengthMeters,
    effectiveTrack.id,
    effectiveTrack.lengthMeters,
    effectiveTrack.name,
    raceCapture,
    racePlayers,
    raceState,
    raceViewFullscreen,
    riders,
    samplesByDevice,
    selectedTrack.id,
  ]);

  useEffect(() => {
    writeStoredGhostLaps(ghostLaps);
  }, [ghostLaps]);

  useEffect(() => {
    const availableIds = new Set(availableGhostLaps.map((ghost) => ghost.id));
    setSelectedGhostIds((current) => current.filter((ghostId) => availableIds.has(ghostId)));
  }, [availableGhostLaps]);

  useEffect(() => {
    if (!cloudProfileKey || isCustomRoutePreviewId(selectedTrack.id)) {
      return undefined;
    }

    let cancelled = false;
    const friendKeys = friendGhostKeySignature
      ? friendGhostKeySignature.split(',').filter(Boolean)
      : [];

    loadGhostLapsFromCloud(selectedTrack.id, cloudProfileKey, friendKeys)
      .then((cloudGhosts) => {
        if (cancelled || cloudGhosts.length === 0) {
          return;
        }

        setGhostLaps((current) => mergeGhostLaps(current, cloudGhosts));
      })
      .catch((error: Error) => {
        console.warn(`Could not load TrackLab ghosts: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [cloudProfileKey, friendGhostKeySignature, selectedTrack.id]);

  useEffect(() => {
    if (startGateStatus.active && raceState !== 'racing') {
      setGhostPlaybackMs(0);
      return undefined;
    }

    if (raceState === 'ready') {
      setGhostPlaybackMs(0);
      return undefined;
    }

    if (raceState === 'finished') {
      const maxFinishMs = selectedGhostLaps.reduce((maxMs, ghost) => Math.max(maxMs, ghost.finishTimeMs), 0);
      setGhostPlaybackMs(maxFinishMs);
      return undefined;
    }

    if (raceState !== 'racing') {
      return undefined;
    }

    let frameId = 0;
    const tick = () => {
      const startedAt = ghostRaceStartedAtRef.current ?? raceCapture?.startedAt ?? Date.now();
      setGhostPlaybackMs(Math.max(0, Date.now() - startedAt));
      frameId = window.requestAnimationFrame(tick);
    };

    tick();
    return () => window.cancelAnimationFrame(frameId);
  }, [raceCapture?.startedAt, raceState, selectedGhostLaps, startGateStatus.active]);

  useEffect(() => {
    if (!raceCapture || (raceCapture.status !== 'armed' && raceCapture.status !== 'racing')) {
      return;
    }

    const captureStartedAt = raceCapture.startedAt ?? raceCapture.createdAt;
    const capturedSamples = racePlayers.flatMap((player) => {
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
      const capturedAt = Date.now();

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
        riderDriveSource: rider?.driveSource ?? null,
        rawWatts: rider?.lastRawWatts ?? null,
        rawCadence: rider?.lastRawCadence ?? null,
        rawSpeedKph: rider?.lastRawSpeedKph ?? null,
        sampleAgeMs: capturedAt - sample.at,
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
  }, [raceCapture, racePlayers, riders, samplesByDevice]);

  useEffect(() => {
    if (!raceCapture || (raceCapture.status !== 'armed' && raceCapture.status !== 'racing')) {
      return;
    }

    const capturedAt = Date.now();
    if (capturedAt - lastRaceDebugFrameAtRef.current < 250) {
      return;
    }
    lastRaceDebugFrameAtRef.current = capturedAt;

    const captureStartedAt = raceCapture.startedAt ?? raceCapture.createdAt;
    const frame = {
      at: capturedAt,
      elapsedMs: capturedAt - captureStartedAt,
      raceState,
      trackId: effectiveTrack.id,
      trackLengthMeters: effectiveTrack.lengthMeters,
      routeLengthMeters: effectiveRouteLengthMeters,
      riders: racePlayers.map((player) => {
        const rider = riders.find((item) => item.playerId === player.id);
        const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);

        return {
          playerId: player.id,
          riderName: player.name,
          deviceId: player.deviceId,
          distanceMeters: Number((rider?.distance ?? 0).toFixed(2)),
          velocityMps: Number((rider?.velocity ?? 0).toFixed(2)),
          driveSource: rider?.driveSource ?? 'coast',
          driveAllowed: rider?.driveAllowed ?? true,
          rawWatts: rider?.lastRawWatts ?? 0,
          rawCadence: rider?.lastRawCadence ?? 0,
          rawSpeedKph: rider?.lastRawSpeedKph ?? 0,
          sampleAgeMs: sample ? capturedAt - sample.at : null,
          wattsAgeMs: sample?.wattsAt ? capturedAt - sample.wattsAt : null,
          cadenceAgeMs: sample?.cadenceAt ? capturedAt - sample.cadenceAt : null,
          speedAgeMs: sample?.speedAt ? capturedAt - sample.speedAt : null,
        };
      }),
    };

    setRaceCapture((current) => {
      if (!current || current.sessionId !== raceCapture.sessionId) {
        return current;
      }

      return {
        ...current,
        frames: [...(current.frames ?? []), frame].slice(-1200),
      };
    });
  }, [
    effectiveRouteLengthMeters,
    effectiveTrack.id,
    effectiveTrack.lengthMeters,
    raceCapture?.createdAt,
    raceCapture?.sessionId,
    raceCapture?.startedAt,
    raceCapture?.status,
    racePlayers,
    raceState,
    riders,
    samplesByDevice,
  ]);

  useEffect(() => {
    if (raceState !== 'racing') {
      return;
    }

    const startedAt = ghostRaceStartedAtRef.current ?? raceCapture?.startedAt;
    if (!startedAt) {
      return;
    }

    const sampleAt = Date.now();
    riders.forEach((rider) => {
      const lastSampleAt = ghostTraceLastSampleAtRef.current.get(rider.playerId) ?? 0;
      if (sampleAt - lastSampleAt < 90 && rider.finishedAt == null) {
        return;
      }

      const points = ghostTraceRef.current.get(rider.playerId) ?? [];
      points.push({
        elapsedMs: Math.max(0, Math.round(sampleAt - startedAt)),
        distanceMeters: Number(Math.max(0, rider.distance).toFixed(2)),
        velocityMps: Number(Math.max(0, rider.velocity).toFixed(2)),
        phase: rider.phase,
        pitch: Number(rider.pitch.toFixed(3)),
        rank: rider.rank,
        actualBranches: { ...rider.actualBranches },
      });
      if (points.length > 900) {
        points.splice(0, points.length - 900);
      }

      ghostTraceRef.current.set(rider.playerId, points);
      ghostTraceLastSampleAtRef.current.set(rider.playerId, sampleAt);
    });
  }, [raceCapture?.startedAt, raceState, riders]);

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

  const hideRaceReview = useCallback(() => {
    setRaceReviewVisible(false);
    setRaceReviewPaused(false);
  }, []);

  const extendRaceReview = useCallback(() => {
    setRaceReviewRemainingSeconds((seconds) => seconds + 15);
  }, []);

  const toggleRaceReviewPaused = useCallback(() => {
    setRaceReviewPaused((paused) => !paused);
  }, []);

  useEffect(() => {
    if (raceState !== 'finished') {
      raceReviewSessionRef.current = null;
      hideRaceReview();
      return;
    }

    if (raceSummary.length === 0) {
      return;
    }

    const reviewSessionId = raceCapture?.sessionId
      ?? `${effectiveTrack.id}:${raceSummary.map((summary) => `${summary.playerId}-${summary.finishTimeMs ?? 'dnf'}`).join('|')}`;
    if (raceReviewSessionRef.current === reviewSessionId) {
      return;
    }

    raceReviewSessionRef.current = reviewSessionId;
    setAppMode('race');
    setRaceReviewRemainingSeconds(15);
    setRaceReviewPaused(false);
    setRaceReviewVisible(true);
  }, [effectiveTrack.id, hideRaceReview, raceCapture?.sessionId, raceState, raceSummary]);

  useEffect(() => {
    if (!raceReviewVisible || raceReviewPaused) {
      return undefined;
    }

    if (raceReviewRemainingSeconds <= 0) {
      hideRaceReview();
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setRaceReviewRemainingSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [hideRaceReview, raceReviewPaused, raceReviewRemainingSeconds, raceReviewVisible]);

  useEffect(() => {
    if (raceState !== 'finished' || raceSummary.length === 0) {
      return;
    }

    const sessionId = activeRaceSessionIdRef.current ?? raceCapture?.sessionId;
    if (!sessionId || ghostSavedSessionIdsRef.current.has(sessionId)) {
      return;
    }

    const ownerKey = cloudProfileKey || 'local';
    const ownerName = authUser?.name ?? multiplayer.profile.name ?? 'TrackLab rider';
    const savedAt = Date.now();
    const nextGhosts = raceSummary
      .map((summary) => {
        const player = racePlayers.find((slot) => slot.id === summary.playerId);
        const rider = riders.find((item) => item.playerId === summary.playerId);
        const tracePoints = [...(ghostTraceRef.current.get(summary.playerId) ?? [])];
        if (rider && summary.finishTimeMs != null) {
          tracePoints.push({
            elapsedMs: summary.finishTimeMs,
            distanceMeters: Number(Math.max(summary.distanceMeters, rider.distance).toFixed(2)),
            velocityMps: 0,
            phase: rider.phase,
            pitch: Number(rider.pitch.toFixed(3)),
            rank: summary.rank,
            actualBranches: { ...rider.actualBranches },
          });
        }

        return buildGhostLapFromRace({
          summary,
          points: tracePoints,
          trackId: effectiveTrack.id,
          trackName: effectiveTrack.name,
          routeVariantId: ghostRouteVariantId,
          ownerKey,
          ownerName,
          player,
          savedAt,
        });
      })
      .filter((ghost): ghost is NonNullable<typeof ghost> => ghost != null);

    if (nextGhosts.length === 0) {
      return;
    }

    ghostSavedSessionIdsRef.current.add(sessionId);
    setGhostLaps((current) => mergeGhostLaps(current, nextGhosts));
    nextGhosts.forEach((ghost) => {
      void syncGhostLapToCloud(ghost, ownerKey).catch((error: Error) => {
        console.warn(`Could not sync TrackLab ghost: ${error.message}`);
      });
    });
  }, [
    authUser?.name,
    cloudProfileKey,
    effectiveTrack.id,
    effectiveTrack.name,
    ghostRouteVariantId,
    multiplayer.profile.name,
    raceCapture?.sessionId,
    racePlayers,
    raceState,
    raceSummary,
    riders,
  ]);

  useEffect(() => {
    setManualZoneIds((current) => {
      const valid = current.filter((zoneId) => mappedZones.some((zone) => zone.id === zoneId));
      return valid.length > 0 ? valid : mappedZones.slice(0, 2).map((zone) => zone.id);
    });

    if (startGateStatus.active || raceState === 'racing') {
      return;
    }

    resetRace();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, [effectiveTrack.activeRouteVariantId, effectiveTrack.id, mappedZones, raceState, resetRace, startGateStatus.active]);

  const renamePlayer = useCallback((playerId: PlayerSlot['id'], name: string) => {
    const player = sessionPlayers.find((item) => item.id === playerId);
    if (!player?.deviceId) {
      return;
    }

    const deviceId = player.deviceId;
    const safeName = normalizeBikeName(name);
    if (!safeName) {
      return;
    }

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
      setDraftZoneBoundarySets([]);
      setDraftSplitSections([]);
      setDraftSplitBuilder(null);
      clearMappingHistory();
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
    setDraftZoneBoundarySets([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    clearMappingHistory();
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
    clearMappingHistory();
  }, [clearMappingHistory, selectedTrack.id]);

  useEffect(() => {
    setDraftPoints(activeMappingRoute?.centerline ?? []);
    setDraftZoneBoundarySets(activeMappingRoute ? zoneBoundarySetsFromRouteVariant(activeMappingRoute) : []);
    setDraftSplitSections(activeMappingRoute?.splitSections ?? []);
    setDraftSplitBuilder(null);
    setMappingRestSeconds(activeMappingRoute?.restAfterSeconds ?? 1);
    clearMappingHistory();
  }, [activeMappingRoute, clearMappingHistory]);

  const handleMappingModeChange = (enabled: boolean) => {
    if (enabled && draftPoints.length === 0 && activeMappingRoute) {
      setDraftPoints(activeMappingRoute.centerline);
      setDraftZoneBoundarySets(zoneBoundarySetsFromRouteVariant(activeMappingRoute));
      setDraftSplitSections(activeMappingRoute.splitSections ?? []);
      setMappingRestSeconds(activeMappingRoute.restAfterSeconds);
    }

    if (enabled) {
      clearStartGateSequence();
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(true);
      resetRace();
      releaseRaceFullscreen();
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
    rememberMappingEdit('route');
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
  }, [draftRouteSplitSections, rememberMappingEdit, snapDraftPointToSplitJunction]);

  const handleMappingPathPointMove = useCallback((index: number, point: TrackPoint) => {
    if (index < 0 || index >= draftPoints.length) {
      return;
    }

    const snappedPoint = snapDraftPointToSplitJunction(point);
    rememberMappingEdit('route');
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.map((draftPoint, draftIndex) => (draftIndex === index ? snappedPoint.point : draftPoint));
      setDraftZoneBoundarySets((currentZones) => normalizeDraftZoneBoundarySetsForRoute(next, draftRouteSplitSections, currentZones));
      return next;
    });
  }, [draftPoints.length, draftRouteSplitSections, normalizeDraftZoneBoundarySetsForRoute, rememberMappingEdit, snapDraftPointToSplitJunction]);

  const handleMappingPathPointRemove = useCallback((index: number) => {
    if (index < 0 || index >= draftPoints.length) {
      return;
    }

    rememberMappingEdit('route');
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.filter((_, draftIndex) => draftIndex !== index);
      setDraftZoneBoundarySets((currentZones) => normalizeDraftZoneBoundarySetsForRoute(next, draftRouteSplitSections, currentZones));
      return next;
    });
  }, [draftPoints.length, draftRouteSplitSections, normalizeDraftZoneBoundarySetsForRoute, rememberMappingEdit]);

  const startOrUpdateSplitBuilder = useCallback((branch: SplitBranchId = 'a') => {
    if (!draftSplitBuilder) {
      rememberMappingEdit('split');
    }

    setDraftSplitBuilder((current) => {
      if (current) {
        return { ...current, activeBranch: branch };
      }

      return createDraftTrackSplit(draftSplitSections.length + 1);
    });
    setMappingMode(true);
    setMappingEditMode('split');
  }, [draftSplitBuilder, draftSplitSections.length, rememberMappingEdit]);

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
    rememberMappingEdit('split');
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
  }, [draftSplitSections.length, rememberMappingEdit]);

  const handleMappingSplitDrawEnd = useCallback(() => {
    // Ending a drag stroke should not finish the branch. Riders need to be able
    // to add several strokes/points along a lane before switching branches.
  }, []);

  const saveDraftSplit = useCallback(() => {
    const nextSplit = draftSplitBuilder ? splitSectionFromDraft(draftSplitBuilder) : null;
    if (!nextSplit) {
      return;
    }

    rememberMappingEdit('split');
    setDraftSplitSections((sections) => [...sections, nextSplit]);
    setDraftSplitBuilder(null);
  }, [draftSplitBuilder, rememberMappingEdit]);

  const cancelDraftSplit = useCallback(() => {
    if (draftSplitBuilder) {
      rememberMappingEdit('split');
    }

    setDraftSplitBuilder(null);
  }, [draftSplitBuilder, rememberMappingEdit]);

  const removeDraftSplitSection = useCallback((splitId: string) => {
    if (!draftSplitSections.some((section) => section.id === splitId)) {
      return;
    }

    rememberMappingEdit('split');
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
  }, [draftSplitSections, rememberMappingEdit]);

  const undoMappingPoint = () => {
    const scope = historyScopeForEditMode(mappingEditMode);
    const index = scopedHistoryIndex(mappingUndoStackRef.current, scope);
    if (index < 0) {
      return;
    }

    const snapshot = mappingUndoStackRef.current[index];
    mappingUndoStackRef.current = [
      ...mappingUndoStackRef.current.slice(0, index),
      ...mappingUndoStackRef.current.slice(index + 1),
    ];
    mappingRedoStackRef.current = [
      ...mappingRedoStackRef.current,
      createMappingSnapshot(scope),
    ].slice(-maxMappingHistoryEntries);
    applyMappingSnapshot(snapshot);
    bumpMappingHistoryVersion();
  };

  const redoMappingPoint = () => {
    const scope = historyScopeForEditMode(mappingEditMode);
    const index = scopedHistoryIndex(mappingRedoStackRef.current, scope);
    if (index < 0) {
      return;
    }

    const snapshot = mappingRedoStackRef.current[index];
    mappingRedoStackRef.current = [
      ...mappingRedoStackRef.current.slice(0, index),
      ...mappingRedoStackRef.current.slice(index + 1),
    ];
    mappingUndoStackRef.current = [
      ...mappingUndoStackRef.current,
      createMappingSnapshot(scope),
    ].slice(-maxMappingHistoryEntries);
    applyMappingSnapshot(snapshot);
    bumpMappingHistoryVersion();
  };

  const clearMappingDraft = () => {
    setDraftPoints([]);
    setDraftZoneBoundarySets([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    clearMappingHistory();
  };

  const updateMappingRestSeconds = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.min(30, Number.isFinite(seconds) ? seconds : 0));
    setMappingRestSeconds(safeSeconds);
  };

  const persistTrackMapping = async (mapping: UserTrackMapping) => {
    if (!authUser) {
      setMappingSaveStatus('error');
      setMappingSaveMessage('Saved on this device only. Sign in to sync this track map across browsers.');
      return;
    }

    setMappingSaveStatus('saving');
    setMappingSaveMessage('Saving this track map to your account.');
    try {
      const saved = await saveCloudTrackMapping(mapping);
      setStoredMappings((current) => {
        const next = {
          ...current,
          [saved.mapping.trackId]: saved.mapping,
        };
        writeStoredTrackMappings(next);
        return next;
      });
      if (saved.publicMapping) {
        setPublicTrackMappings((current) => ({
          ...current,
          [saved.publicMapping!.trackId]: saved.publicMapping!,
        }));
      }
      cloudUserDataAvailableRef.current = true;
      cloudUserDataLoadedKeyRef.current = cloudProfileKey;
      setCloudUserDataStatus('online');
      setCloudUserDataMessage(saved.published
        ? 'Track map saved to your profile and published to the shared catalog.'
        : 'Track map saved to your profile for use on every signed-in device.');
      setMappingSaveStatus('saved');
      setMappingSaveMessage(saved.published
        ? 'Saved and published across browsers.'
        : 'Saved to your account across browsers.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCloudUserDataStatus('offline');
      setCloudUserDataMessage(`Could not save this track map to the cloud. ${message}`);
      setMappingSaveStatus('error');
      setMappingSaveMessage(`Cloud save failed. This browser still has a local copy. ${message}`);
      console.warn(`Could not save track mapping to TrackLab cloud: ${message}`);
    }
  };

  const saveMapping = () => {
    if (draftPoints.length < 2) {
      return;
    }

    const completedDraftSplit = draftSplitBuilder ? splitSectionFromDraft(draftSplitBuilder) : null;
    const nextSplitSections = completedDraftSplit ? [...draftSplitSections, completedDraftSplit] : draftSplitSections;
    const normalizedZoneBoundarySets = normalizeDraftZoneBoundarySetsForRoute(
      draftPoints,
      nextSplitSections,
      draftZoneBoundarySets,
    );
    const defaultZoneSelections = nextSplitSections.length > 0
      ? splitBranchSelectionsForChoice(nextSplitSections, 'a')
      : undefined;
    const defaultZoneSetId = zoneBoundarySetIdForSelections(defaultZoneSelections);
    const defaultZoneMeters = normalizedZoneBoundarySets.find((set) => set.id === defaultZoneSetId)?.boundaryMeters
      ?? normalizedZoneBoundarySets.find((set) => set.id === defaultZoneBoundarySetId)?.boundaryMeters
      ?? [];
    const mapping = createUserTrackMapping(
      selectedTrack,
      draftPoints,
      mappingRestSeconds,
      defaultZoneMeters,
      nextSplitSections,
      mappingRouteVariantId,
      selectedTrackMapping ? routeVariantsFromMapping(selectedTrackMapping) : [],
      [],
      normalizedZoneBoundarySets,
    );
    setStoredMappings((current) => {
      const next = { ...current, [selectedTrack.id]: mapping };
      writeStoredTrackMappings(next);
      return next;
    });
    void persistTrackMapping(mapping);
    if (completedDraftSplit) {
      setDraftSplitSections((current) => [...current, completedDraftSplit]);
      setDraftSplitBuilder(null);
    }
    clearMappingHistory();
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
    setDraftZoneBoundarySets([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    clearMappingHistory();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const exportMapping = () => {
    if (selectedTrackMapping) {
      downloadTrackMapping(selectedTrackMapping);
    }
  };

  const importMapping = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const mapping = {
          ...parseUserTrackMapping(String(reader.result ?? '')),
          savedAt: new Date().toISOString(),
        };
        setStoredMappings((current) => {
          const next = { ...current, [mapping.trackId]: mapping };
          writeStoredTrackMappings(next);
          return next;
        });
        void persistTrackMapping(mapping);

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
        setDraftZoneBoundarySets(zoneBoundarySetsFromRouteVariant(importedRoute));
        setDraftSplitSections(importedRoute.splitSections ?? []);
        setDraftSplitBuilder(null);
        clearMappingHistory();
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
    if (draftZoneRidePoints.length < 2) {
      return;
    }

    const meter = mappingZoneMeterFromPoint(draftZoneRidePoints, point);
    if (meter == null) {
      return;
    }

    const existingBoundaryIndex = draftZoneMeters.findIndex((boundary) => (
      Math.abs(boundary - meter) < zoneBoundaryDuplicateMeters
    ));
    let nextZoneMeters = draftZoneMeters;
    if (draftZoneMeters.length === 0 && meter > zoneBoundaryDuplicateMeters) {
      nextZoneMeters = [0, meter].sort((a, b) => a - b);
    } else if (existingBoundaryIndex >= 0) {
      const exactEndpoint = meter === 0 || meter === draftZoneRouteLengthMeters;
      if (!exactEndpoint) {
        return;
      }

      nextZoneMeters = draftZoneMeters
        .map((boundary, boundaryIndex) => (boundaryIndex === existingBoundaryIndex ? meter : boundary))
        .sort((a, b) => a - b);
    } else {
      nextZoneMeters = [...draftZoneMeters, meter].sort((a, b) => a - b);
    }

    if (numbersMatch(draftZoneMeters, nextZoneMeters)) {
      return;
    }

    rememberMappingEdit('zones');
    updateCurrentDraftZoneMeters(nextZoneMeters);
  }, [draftZoneMeters, draftZoneRidePoints, draftZoneRouteLengthMeters, rememberMappingEdit, updateCurrentDraftZoneMeters]);

  const handleMappingZonePointMove = useCallback((index: number, point: TrackPoint) => {
    if (draftZoneRidePoints.length < 2 || index < 0 || index >= draftZoneMeters.length) {
      return;
    }

    const mappedMeter = mappingZoneMeterFromPoint(draftZoneRidePoints, point);
    if (mappedMeter == null) {
      return;
    }
    const meter = index === 0 ? 0 : mappedMeter;

    const nextZoneMeters = draftZoneMeters
      .map((boundary, boundaryIndex) => (boundaryIndex === index ? meter : boundary))
      .filter((boundary, boundaryIndex, boundaries) => (
        boundaryIndex === boundaries.findIndex((candidate) => Math.abs(candidate - boundary) < zoneBoundaryDuplicateMeters)
      ))
      .sort((a, b) => a - b);
    if (numbersMatch(draftZoneMeters, nextZoneMeters)) {
      return;
    }

    rememberMappingEdit('zones');
    updateCurrentDraftZoneMeters(nextZoneMeters);
  }, [draftZoneMeters, draftZoneRidePoints, rememberMappingEdit, updateCurrentDraftZoneMeters]);

  const handleMappingZonePointRemove = useCallback((index: number) => {
    if (index < 0 || index >= draftZoneMeters.length) {
      return;
    }

    rememberMappingEdit('zones');
    updateCurrentDraftZoneMeters(draftZoneMeters.filter((_, zoneIndex) => zoneIndex !== index));
  }, [draftZoneMeters, rememberMappingEdit, updateCurrentDraftZoneMeters]);

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

  const toggleLiveRaceEntry = useCallback((deviceId: number) => {
    if (startGateStatus.active || raceState === 'racing') {
      return;
    }

    liveRaceEntryTouchedRef.current = true;
    setLockedRacePlayers(null);
    setLiveRaceReadyDeviceIds((current) => (
      current.includes(deviceId)
        ? current.filter((id) => id !== deviceId)
        : [...current, deviceId].slice(0, maxPlayers)
    ));
  }, [raceState, startGateStatus.active]);

  const enterAllLiveRaceBikes = useCallback(() => {
    if (startGateStatus.active || raceState === 'racing') {
      return;
    }

    liveRaceEntryTouchedRef.current = true;
    setLockedRacePlayers(null);
    setLiveRaceReadyDeviceIds(connectedDeviceIds.slice(0, maxPlayers));
  }, [connectedDeviceIds, raceState, startGateStatus.active]);

  const clearLiveRaceEntries = useCallback(() => {
    if (startGateStatus.active || raceState === 'racing') {
      return;
    }

    liveRaceEntryTouchedRef.current = true;
    setLockedRacePlayers(null);
    setLiveRaceReadyDeviceIds([]);
  }, [raceState, startGateStatus.active]);

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
    const armedAt = Date.now();
    setReactionStartAt(armedAt);
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
    ghostRaceStartedAtRef.current = gateDropAt;
    ghostTraceRef.current = new Map();
    ghostTraceLastSampleAtRef.current = new Map();
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
    startRace(gateDropAt);
    scheduleStartGateStep(420, () => setStartGateStatus(idleStartGateStatus));
  }, [appendRaceCaptureEvent, bridge, demoMode, scheduleStartGateStep, startRace]);

  const handleDemoModeChange = (enabled: boolean, nextSource: BikeConnectionSource = enabled ? 'demo' : 'bluetooth') => {
    clearStartGateSequence();
    setLockedRacePlayers(null);
    setBikeConnectionSource(nextSource);
    setDemoMode(enabled);
    setDemoRaceSeed(Date.now());
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const handleBikeConnectionSourceChange = (source: BikeConnectionSource) => {
    if (!accountProfileComplete) {
      setProfileFormError('Create an account or sign in before connecting Wattbikes.');
      setCheckoutMessage(null);
      setShowMembershipLanding(true);
      return;
    }

    if (source !== 'demo' && membership.tier !== 'racer') {
      setCheckoutMessage('Racer membership is required to connect live Wattbikes.');
      setCheckoutStatus('idle');
      setShowMembershipLanding(true);
      return;
    }

    if (source === 'demo') {
      handleDemoModeChange(true, 'demo');
      return;
    }

    if (demoMode) {
      handleDemoModeChange(false, source);
      return;
    }

    setLockedRacePlayers(null);
    setBikeConnectionSource(source);
  };

  const handleDemoBikeCountChange = (count: number) => {
    clearStartGateSequence();
    setLockedRacePlayers(null);
    setDemoBikeCount(Math.max(1, Math.min(maxPlayers, Math.round(count))));
    setDemoRaceSeed(Date.now() + count);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const requireAccountProfile = useCallback((message = 'Create an account or sign in before entering TrackLab.') => {
    if (accountProfileComplete) {
      return true;
    }

    setProfileFormError(message);
    setCheckoutMessage(null);
    setShowMembershipLanding(true);
    return false;
  }, [accountProfileComplete]);

  const saveRequiredProfile = useCallback(async () => {
    const name = profileNameDraft.trim().replace(/\s+/g, ' ').slice(0, 64);
    const email = normalizeAccountEmail(profileEmailDraft);

    if (authMode === 'register' && !name) {
      setProfileFormError('Enter your name or studio name.');
      return false;
    }

    if (!isValidAccountEmail(email)) {
      setProfileFormError('Enter a valid email address.');
      return false;
    }

    if (authPasswordDraft.length < 8) {
      setProfileFormError('Password must be at least 8 characters.');
      return false;
    }

    setAuthStatus('loading');
    setProfileFormError(null);
    setCheckoutMessage(null);

    try {
      const user = authMode === 'register'
        ? await registerAuthUser(name, email, authPasswordDraft)
        : await loginAuthUser(email, authPasswordDraft);

      if (!user) {
        throw new Error('TrackLab did not return an account.');
      }

      setAuthUser(user);
      setAuthStatus('signed-in');
      setMembership(user.membership);
      setCheckoutBikeSeats(user.membership.bikeSeats);
      setProfileNameDraft(user.name);
      setProfileEmailDraft(user.email);
      setAuthPasswordDraft('');
      setCheckoutStatus('idle');
      setCheckoutMessage(user.admin ? 'Administrator racer access unlocked.' : null);
      setShowMembershipLanding(false);
      setPlayMode('multiplayer');
      setAppMode('race');
      return true;
    } catch (error) {
      setAuthUser(null);
      setAuthStatus('signed-out');
      setProfileFormError(error instanceof Error ? error.message : 'Could not sign in.');
      return false;
    }
  }, [authMode, authPasswordDraft, profileEmailDraft, profileNameDraft]);

  const handleSignOut = useCallback(async () => {
    clearStartGateSequence();
    setCheckoutMessage(null);
    setProfileFormError(null);
    setAuthPasswordDraft('');
    setAuthStatus('loading');

    try {
      await logoutAuthUser();
    } catch (error) {
      console.warn(`Could not clear TrackLab session: ${error instanceof Error ? error.message : error}`);
    }

    const visitorMembership = createMembership('visitor');
    setAuthUser(null);
    setAuthStatus('signed-out');
    setMembership(visitorMembership);
    setCheckoutBikeSeats(1);
    setPlayMode('local');
    setBikeConnectionSource('bluetooth');
    setDemoMode(false);
    setShowMembershipLanding(true);
  }, [clearStartGateSequence]);

  const openFreeSpectatorAccess = useCallback(() => {
    if (!requireAccountProfile()) {
      return;
    }

    const nextMembership = adminProfileActive
      ? createMembership('racer', maxPlayers)
      : createMembership('spectator', 1);
    setMembership(nextMembership);
    multiplayer.setProfile({ membershipTier: nextMembership.tier });
    setCheckoutMessage(null);
    setCheckoutStatus('idle');
    setShowMembershipLanding(false);
    setPlayMode('multiplayer');
    setAppMode('race');
  }, [adminProfileActive, multiplayer, requireAccountProfile]);

  const startBenchmarkDemo = useCallback(() => {
    if (!requireAccountProfile('Create an account or sign in before starting demo mode.')) {
      return;
    }

    const nextMembership = membership.tier === 'visitor' ? createMembership('spectator', 1) : membership;
    setMembership(nextMembership);
    multiplayer.setProfile({ membershipTier: nextMembership.tier });
    setCheckoutMessage(null);
    setCheckoutStatus('idle');
    setShowMembershipLanding(false);
    setPlayMode('multiplayer');
    handleTrackChange(benchmarkDemoTrackId);
    handleDemoBikeCountChange(Math.min(4, maxPlayers));
    handleDemoModeChange(true, 'demo');
    setAppMode('race');
  }, [membership, multiplayer, requireAccountProfile]);

  const openRaceDashboard = useCallback(() => {
    if (!requireAccountProfile()) {
      return;
    }

    if (membership.tier === 'visitor') {
      const nextMembership = createMembership('spectator', 1);
      setMembership(nextMembership);
      multiplayer.setProfile({ membershipTier: nextMembership.tier });
    }
    setCheckoutMessage(null);
    setCheckoutStatus('idle');
    setShowMembershipLanding(false);
    setAppMode('race');
  }, [membership.tier, multiplayer, requireAccountProfile]);

  const handleCheckoutBikeSeatsChange = useCallback((bikeSeats: number) => {
    setCheckoutBikeSeats(Math.max(1, Math.min(maxPlayers, Math.round(bikeSeats))));
    setCheckoutMessage(null);
    setCheckoutStatus('idle');
  }, []);

  const startSquareCheckout = useCallback(async () => {
    if (!requireAccountProfile('Create an account or sign in before upgrading to Racer.')) {
      return;
    }

    setCheckoutStatus('loading');
    setCheckoutMessage(null);

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bikeSeats: checkoutBikeSeats }),
      });
      const payload = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error ?? `Checkout request returned ${response.status}`);
      }

      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      setCheckoutStatus('error');
      setCheckoutMessage(
        error instanceof Error
          ? error.message
          : 'Square checkout is not available right now.',
      );
    }
  }, [checkoutBikeSeats, requireAccountProfile]);

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
    setLockedRacePlayers(null);
    setMappingFullscreen(false);
    hideRaceReview();
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
    setLockedRacePlayers(null);
    setMappingFullscreen(false);
    hideRaceReview();

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

  const startRoomTrackVote = useCallback(() => {
    if (!multiplayer.currentRoom) {
      return;
    }

    const pool = [...multiplayerVoteCandidates];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }

    const candidates = pool.slice(0, 3);
    if (candidates.length < 3) {
      setChatMessages((current) => [
        ...current,
        {
          id: Date.now(),
          author: 'TrackLab',
          text: 'Track voting needs at least three mapped tracks with pedaling zones.',
          at: formatClock(),
        },
      ].slice(-6));
      return;
    }

    multiplayer.startTrackVote(candidates);
  }, [multiplayer, multiplayerVoteCandidates]);

  const handleRoomRouteChoice = useCallback((choice: SplitBranchId) => {
    setBranchChoicesByPlayer((current) => {
      const next = { ...current };
      racePlayers.forEach((player) => {
        next[player.id] = choice;
      });
      return next;
    });
    multiplayer.chooseRoomRoute(choice);
  }, [multiplayer, racePlayers]);

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

  const toggleGhostLap = useCallback((ghostId: string) => {
    setSelectedGhostIds((current) => {
      if (current.includes(ghostId)) {
        return current.filter((id) => id !== ghostId);
      }

      return [...current, ghostId].slice(-maxPlayers);
    });
  }, []);

  const clearSelectedGhosts = useCallback(() => {
    setSelectedGhostIds([]);
  }, []);

  const handleStart = async () => {
    const startingRacePlayers = racePlayers;
    if (
      effectiveTrack.routeStatus !== 'user-mapped'
      || startingRacePlayers.length === 0
      || startGateStatus.active
      || raceState === 'racing'
    ) {
      return;
    }

    const startingTrackId = effectiveTrack.id;
    if (selectedTrackIdRef.current !== startingTrackId) {
      return;
    }

    setLockedRacePlayers(startingRacePlayers);
    clearStartGateSequence();
    const sequenceId = startGateSequenceIdRef.current;
    setMappingMode(false);
    setMappingFullscreen(false);
    hideRaceReview();
    setDemoSignalsStopped(false);
    createRaceCapture();
    requestBrowserFullscreen(raceShellRef.current);
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

  useEffect(() => {
    const roomFlow = multiplayer.currentRoom?.flow;
    const raceToken = roomFlow?.raceToken;
    if (
      playMode !== 'multiplayer'
      || roomFlow?.phase !== 'race'
      || !raceToken
      || lastRoomRaceTokenRef.current === raceToken
      || (roomFlow.selectedTrackId && roomFlow.selectedTrackId !== effectiveTrack.id)
    ) {
      return;
    }

    lastRoomRaceTokenRef.current = raceToken;
    if (roomRaceStartTimeoutRef.current != null) {
      window.clearTimeout(roomRaceStartTimeoutRef.current);
      roomRaceStartTimeoutRef.current = null;
    }

    const serverRaceStartAt = Number(roomFlow.raceStartAt);
    const localRaceStartAt = Number.isFinite(serverRaceStartAt)
      ? serverRaceStartAt - multiplayer.latency.clockOffsetMs
      : Date.now();
    const delayMs = Math.max(0, localRaceStartAt - Date.now());
    roomRaceStartTimeoutRef.current = window.setTimeout(() => {
      roomRaceStartTimeoutRef.current = null;
      void handleStart();
    }, delayMs);
  }, [effectiveTrack.id, multiplayer.currentRoom?.flow, multiplayer.latency.clockOffsetMs, playMode]);

  const connectionLabel = (() => {
    if (demoMode) {
      return 'Demo race source online';
    }

    if (bikeConnectionSource === 'bluetooth') {
      if (!bluetooth.supported) {
        return 'Bluetooth Direct unavailable';
      }

      return activePlayers.length > 0 ? 'Bluetooth Direct online' : 'Bluetooth Direct ready';
    }

    if (activePlayers.some((player) => player.deviceSource === 'bluetooth') && bridge.connection === 'open') {
      return 'ANT+ / Bluetooth inputs online';
    }

    if (activePlayers.some((player) => player.deviceSource === 'bluetooth')) {
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

    if (activePlayers.length > 0) {
      return livePlayerCount > 0
        ? `${livePlayerCount}/${activePlayers.length} bike${activePlayers.length === 1 ? '' : 's'} live`
        : `${activePlayers.length} bike${activePlayers.length === 1 ? '' : 's'} connected`;
    }

    return `${bridge.mode.toString().toUpperCase()} connector scanning`;
  })();
  const connectionStatus = (() => {
    if (demoMode) {
      return `Simulating ${demoBikeCount} bike${demoBikeCount === 1 ? '' : 's'} with ${demo.variableCount} race variables.`;
    }

    if (bikeConnectionSource === 'bluetooth') {
      if (!bluetooth.supported) {
        return bluetooth.status;
      }

      return activePlayers.length > 0
        ? `${activePlayers.length} live Bluetooth bike${activePlayers.length === 1 ? '' : 's'} connected.`
        : 'Press Connect Wattbike, choose the bike from the browser Bluetooth prompt, then pedal to confirm live data.';
    }

    const bridgeControlStatus = bridge.controlStatus ? ` ${bridge.controlStatus}` : '';

    if (activePlayers.some((player) => player.deviceSource === 'bluetooth')) {
      return `${bluetooth.status} ${bridge.connection === 'open' ? bridge.status : bridge.error ?? bridge.status}${bridgeControlStatus}`;
    }

    return `${bridge.error ?? `${bridge.status} ${bluetooth.status}`}${bridgeControlStatus}`;
  })();
  const bridgeBusy = bridge.sourceState === 'starting' || bridge.sourceState === 'stopping';
  const bridgeRunning = bridge.sourceState === 'running';
  const liveBikeAccessLocked = membership.tier !== 'racer';
  const showLiveBikeUpgrade = () => {
    setCheckoutMessage('Upgrade to Racer to connect live Wattbikes.');
    setCheckoutStatus('idle');
    setShowMembershipLanding(true);
  };
  const bridgeButtonDisabled = liveBikeAccessLocked || demoMode || bikeConnectionSource !== 'advanced' || bridge.connection !== 'open' || bridgeBusy;
  const bridgeButtonLabel = bridgeBusy
    ? bridge.sourceState === 'stopping' ? 'Stopping Connector' : 'Starting Connector'
    : bridgeRunning ? 'Stop Connector' : 'Start Connector';
  const openMacConnector = () => {
    setConnectorLaunchMessage('Opening TrackLab Bike Connector. If macOS asks, allow it, then return here while the connector starts.');
    window.location.assign('tracklab-bmx://start');
  };
  const bridgePrompt = (() => {
    if (demoMode) {
      return 'Demo mode is generating bike data.';
    }

    if (bikeConnectionSource === 'bluetooth') {
      return bluetooth.supported
        ? 'No connector needed. Browser Bluetooth feeds the same BMX gear logic, race engine, monitor, and summaries.'
        : bluetooth.status;
    }

    if (bridge.connection !== 'open') {
      return connectorLaunchMessage ?? 'Open TrackLab Bike Connector on this computer. It runs locally in the background while you ride.';
    }

    if (bridge.sourceState === 'idle') {
      return 'Press Start Connector, then put each Wattbike in Just Ride at resistance level 1.';
    }

    if (bridge.sourceState === 'running' && activePlayers.length === 0) {
      return 'Waiting for bike signal. Put each Wattbike in Just Ride at level 1 and pedal for a few seconds.';
    }

    if (activePlayers.length > 0) {
      return 'Bike connected. Pedal to verify live watts, cadence, speed, and race movement.';
    }

    return bridge.status;
  })();
  const connectionState = demoMode || activePlayers.length > 0
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
      ? 'Start Advanced Connector, put each Wattbike in Just Ride at resistance level 1, then pedal for Bluetooth/ANT+/USB discovery.'
      : bluetooth.supported
        ? 'Press Connect Wattbike to pair Bluetooth bikes. Riders appear only after a bike is connected.'
        : bluetooth.status;
  const pairingDeviceLabel = bikeConnectionSource === 'advanced' ? 'Bike connector device' : 'Bluetooth bike';
  const membershipLabel = membership.tier === 'racer'
    ? `Racer / ${membership.bikeSeats} bike${membership.bikeSeats === 1 ? '' : 's'}`
    : membership.tier === 'spectator'
      ? 'Free spectator'
      : 'Visitor';
  const connectedBikeDisplayCount = demoMode ? demoBikeCount : activePlayers.length;
  const workflowConnectionReady = demoMode || activePlayers.length > 0;
  const workflowRaceEntryReady = demoMode || racePlayers.length > 0;
  const workflowMapReady = effectiveTrack.routeStatus === 'user-mapped';
  const workflowRaceReady = workflowConnectionReady && workflowRaceEntryReady && workflowMapReady && !startGateStatus.active && raceState !== 'racing';
  const hasStartHereSplitChoices = racePlayers.length > 0 && (effectiveTrack.splitSections?.length ?? 0) > 0;
  const canChooseStartHereSplitLine = raceState !== 'racing' && !startGateStatus.active;
  const canEditLiveRaceEntry = !demoMode && raceState !== 'racing' && !startGateStatus.active;
  const workflowSteps = [
    {
      label: 'Connect',
      detail: demoMode
        ? `${demoBikeCount} demo rider${demoBikeCount === 1 ? '' : 's'}`
        : activePlayers.length > 0
          ? `${activePlayers.length} connected bike${activePlayers.length === 1 ? '' : 's'}`
          : bikeConnectionSource === 'advanced'
            ? 'Open Connector'
            : 'Pair bike',
      state: workflowConnectionReady ? 'complete' : 'next',
      onClick: () => {
        setAppMode('race');
      },
    },
    {
      label: 'Pick Track',
      detail: selectedTrack.name,
      state: 'complete',
      onClick: () => {
        setAppMode('race');
      },
    },
    {
      label: 'Map Zones',
      detail: workflowMapReady
        ? `${effectiveTrack.zones.length} pedal zone${effectiveTrack.zones.length === 1 ? '' : 's'}`
        : 'Needs layout',
      state: workflowMapReady ? 'complete' : 'next',
      onClick: () => {
        setAppMode('race');
        handleMappingModeChange(true);
        setMappingEditMode(workflowMapReady ? 'zones' : 'draw');
      },
    },
    {
      label: workflowRaceReady
        ? raceState === 'finished'
          ? 'Race Again'
          : demoMode ? 'Start Demo Race' : 'Start Live Race'
        : 'Race',
      detail: workflowRaceReady
        ? 'Ready'
        : !workflowMapReady
          ? 'Map first'
          : !workflowConnectionReady
            ? 'Connect bike'
            : !workflowRaceEntryReady
              ? 'Choose racer'
            : raceState === 'racing'
              ? 'In progress'
              : 'Ready soon',
      state: workflowRaceReady ? 'next' : raceState === 'racing' ? 'complete' : 'idle',
      primaryAction: workflowRaceReady,
      onPointerDown: workflowRaceReady ? primeAudioCues : undefined,
      onClick: () => {
        setAppMode('race');
        if (workflowRaceReady) {
          void handleStart();
        }
      },
    },
  ];

  if (showMembershipLanding || !accountProfileComplete) {
    return (
      <MembershipLanding
        membership={membership}
        bikeSeats={checkoutBikeSeats}
        checkoutStatus={checkoutStatus}
        checkoutMessage={checkoutMessage}
        authMode={authMode}
        authLoading={authStatus === 'loading'}
        profileName={profileNameDraft}
        profileEmail={profileEmailDraft}
        profilePassword={authPasswordDraft}
        profileComplete={accountProfileComplete}
        profileError={profileFormError}
        isAdminProfile={adminProfileActive}
        onlineRiderCount={multiplayer.onlineRiders.length}
        liveRoomCount={multiplayer.rooms.length}
        onAuthModeChange={(mode) => {
          setAuthMode(mode);
          setProfileFormError(null);
        }}
        onProfileNameChange={(name) => {
          setProfileNameDraft(name);
          setProfileFormError(null);
        }}
        onProfileEmailChange={(email) => {
          setProfileEmailDraft(email);
          setProfileFormError(null);
        }}
        onProfilePasswordChange={(password) => {
          setAuthPasswordDraft(password);
          setProfileFormError(null);
        }}
        onProfileSubmit={saveRequiredProfile}
        onSignOut={handleSignOut}
        onJoinFree={openFreeSpectatorAccess}
        onEnterApp={openRaceDashboard}
        onStartDemo={startBenchmarkDemo}
        onBikeSeatsChange={handleCheckoutBikeSeatsChange}
        onCheckout={startSquareCheckout}
      />
    );
  }

  return (
    <div
      className={`platform-shell${raceViewFullscreen ? ' race-fullscreen' : ''}${mappingFullscreen ? ' map-fullscreen' : ''}${raceReviewVisible ? ' race-review-mode' : ''}`}
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
              <span>{connectedBikeDisplayCount} / {maxPlayers} bikes connected</span>
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
              <span>Bluetooth</span>
            </button>
            <button
              className={bikeConnectionSource === 'advanced' && !demoMode ? 'selected' : ''}
              type="button"
              aria-label="Advanced Connector"
              onClick={() => handleBikeConnectionSourceChange('advanced')}
            >
              <Usb size={15} />
              <span>Connector</span>
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
              onClick={liveBikeAccessLocked ? showLiveBikeUpgrade : bluetooth.connectBike}
              disabled={!bluetooth.supported}
            >
              <Bluetooth size={16} />
              <span>{liveBikeAccessLocked ? 'Upgrade to Connect' : bluetooth.connectedCount > 0 ? 'Connect Another Wattbike' : 'Connect Wattbike'}</span>
            </button>
          )}
          {bikeConnectionSource === 'advanced' && !demoMode && (
            <div className="bridge-controls">
              {bridge.connection !== 'open' ? (
                <button
                  className="bridge-control-button start"
                  type="button"
                  aria-label={liveBikeAccessLocked ? 'Upgrade to Connect' : 'Open Mac Connector'}
                  onClick={liveBikeAccessLocked ? showLiveBikeUpgrade : openMacConnector}
                  disabled={demoMode}
                >
                  <Usb size={16} />
                  <span>{liveBikeAccessLocked ? 'Upgrade to Connect' : 'Open Connector'}</span>
                </button>
              ) : (
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
              )}
              <span className={`bridge-live-pill ${activePlayers.length > 0 ? 'live' : bridgeRunning ? 'waiting' : ''}`}>
                {activePlayers.length > 0 ? 'Bike connected' : bridgeRunning ? 'Scanning' : 'Idle'}
              </span>
            </div>
          )}
          <div className="bridge-prompt">{bridgePrompt}</div>
        </section>

        <section className="sidebar-workflow" aria-label="Race setup workflow">
          <div className="workflow-heading">
            <span>Start Here</span>
            <small>Normal session order</small>
          </div>
          <div className="workflow-list">
            {workflowSteps.map((step, index) => (
              <button
                className={`workflow-step ${step.state}${step.primaryAction ? ' primary-action' : ''}`}
                type="button"
                onPointerDown={step.onPointerDown}
                onClick={step.onClick}
                key={`${index}-${step.label}`}
              >
                <span className="workflow-index">{index + 1}</span>
                <span className="workflow-copy">
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
              </button>
            ))}
          </div>
          {!demoMode && activePlayers.length > 0 && (
            <div className="workflow-race-entry" aria-label="Live race entry">
              <div className="workflow-race-entry-heading">
                <span>Race Entry</span>
                <small>{racePlayers.length} entered / {activePlayers.length} connected</small>
              </div>
              <div className="workflow-race-entry-list">
                {activePlayers.map((player) => {
                  const deviceId = player.deviceId;
                  const entered = deviceId != null && liveRaceReadyDeviceIds.includes(deviceId);

                  return (
                    <button
                      className={`race-entry-row ${entered ? 'entered' : ''}`}
                      type="button"
                      key={deviceId ?? player.id}
                      onClick={() => {
                        if (deviceId != null) {
                          toggleLiveRaceEntry(deviceId);
                        }
                      }}
                      disabled={!canEditLiveRaceEntry || deviceId == null}
                      aria-pressed={entered}
                      aria-label={`${entered ? 'Remove' : 'Enter'} ${player.name} ${entered ? 'from' : 'in'} live race`}
                    >
                      <span
                        className="player-chip"
                        style={{ '--player-color': player.accent } as CSSProperties}
                      >
                        P{player.id}
                      </span>
                      <span className="race-entry-copy">
                        <strong>{player.name}</strong>
                        <small>{deviceId != null ? `Monitor ID ${deviceId}` : 'No monitor ID'}</small>
                      </span>
                      <span className={`race-entry-status ${entered ? 'entered' : ''}`}>
                        {entered ? 'Entered' : 'Standby'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="race-entry-actions">
                <button
                  type="button"
                  onClick={enterAllLiveRaceBikes}
                  disabled={!canEditLiveRaceEntry || connectedDeviceIds.length === 0}
                >
                  Enter all
                </button>
                <button
                  type="button"
                  onClick={clearLiveRaceEntries}
                  disabled={!canEditLiveRaceEntry || liveRaceReadyDeviceIds.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {hasStartHereSplitChoices && (
            <div className="workflow-split-choice" aria-label="Start Here rider race line choices">
              <div className="workflow-split-choice-heading">
                <span>Race Line</span>
                <small>Pro Set needs 26+ mph at split</small>
              </div>
              <div className="workflow-split-choice-list">
                {racePlayers.map((player) => {
                  const branchChoice = activeBranchChoicesByPlayer[player.id] ?? 'a';
                  return (
                    <div className="workflow-split-choice-row" key={player.id}>
                      <div className="workflow-split-choice-rider">
                        <span
                          className="player-chip"
                          style={{ '--player-color': player.accent } as CSSProperties}
                        >
                          P{player.id}
                        </span>
                        <strong>{player.name}</strong>
                      </div>
                      <div className="workflow-split-choice-buttons" aria-label={`${player.name} split line`}>
                        <button
                          className={branchChoice === 'a' ? 'selected' : ''}
                          type="button"
                          onClick={() => handleBranchChoiceChange(player.id, 'a')}
                          disabled={!canChooseStartHereSplitLine}
                        >
                          Amateur
                        </button>
                        <button
                          className={branchChoice === 'b' ? 'selected' : ''}
                          type="button"
                          onClick={() => handleBranchChoiceChange(player.id, 'b')}
                          disabled={!canChooseStartHereSplitLine}
                        >
                          Pro Set
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <nav className="side-nav" aria-label="Primary">
          <span className="nav-section-title">Workspace</span>
          <button type="button" onClick={() => setShowMembershipLanding(true)}>
            <Globe2 size={17} />
            Community
          </button>
          <button className={appMode === 'race' ? 'selected' : ''} type="button" onClick={() => setAppMode('race')}>
            <Activity size={17} />
            Race Dashboard
          </button>
          <button className={appMode === 'monitor' ? 'selected' : ''} type="button" onClick={() => setAppMode('monitor')}>
            <Gauge size={17} />
            Live Monitor
          </button>
          <button className={appMode === 'diagnostics' ? 'selected' : ''} type="button" onClick={() => setAppMode('diagnostics')}>
            <Settings size={17} />
            Bike Check
          </button>
          <button
            className={mappingMode ? 'selected' : ''}
            type="button"
            onClick={() => {
              setAppMode('race');
              handleMappingModeChange(true);
            }}
          >
            <Route size={17} />
            Tracks & Maps
          </button>
          <button
            type="button"
            onClick={() => {
              setAppMode('race');
              window.setTimeout(() => document.querySelector('.analytics-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
            }}
          >
            <BarChart3 size={17} />
            Results
          </button>
          <button
            type="button"
            onClick={() => {
              window.setTimeout(() => document.querySelector('.pairing-rail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
            }}
          >
            <Users size={17} />
            Riders
          </button>
        </nav>

        <section className="membership-mini-card">
          <span className="eyebrow">Membership</span>
          <strong>{membershipLabel}</strong>
          <p>{membership.tier === 'racer' ? 'Live Wattbike racing unlocked.' : 'Demo and live viewing access.'}</p>
          <small>{authUser ? `${authUser.name} / ${authUser.email}` : 'Signed out'}</small>
          <button type="button" onClick={() => setShowMembershipLanding(true)}>
            {membership.tier === 'racer' ? 'Manage Access' : 'Upgrade'}
          </button>
          <button type="button" onClick={handleSignOut}>
            Sign Out
          </button>
        </section>

        <PairingRail
          players={pairingPlayers}
          samplesByDevice={samplesByDevice}
          devices={demoMode ? undefined : connectedBikeDevices}
          onAssign={demoMode ? () => undefined : assignDevice}
          onAutoAssign={demoMode ? () => undefined : autoAssign}
          onRename={demoMode ? undefined : renamePlayer}
          onBluetoothConnect={showBluetoothPairing && !liveBikeAccessLocked ? bluetooth.connectBike : undefined}
          bluetoothSupported={bluetooth.supported}
          bluetoothStatus={bluetooth.status}
          bluetoothDeviceCount={bluetooth.connectedCount}
          title={demoMode ? 'Demo Riders' : 'Connected Bikes'}
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

        {raceReviewVisible ? (
          <section className="race-review-screen">
            <div className="race-review-map">
              <EarthTrackView
                track={effectiveTrack}
                riders={stagedRiders}
                ghostRiders={selectedGhostRiders}
                remoteRaceStates={remoteRaceStates}
                players={racePlayers}
                samplesByDevice={samplesByDevice}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                raceState={raceState}
                raceViewFullscreen={false}
                startGateActive={false}
                startGateLightIndex={null}
                reactionTimesByPlayer={reactionTimesByPlayer}
                earthAngle={earthAngle}
                earthHeading={earthHeading}
                earthCenter={earthCenter}
                earthZoom={earthZoom}
                activeZones={activeZones}
                canCancelRace={false}
                mappingMode={false}
                mappingFullscreen={false}
                mappingEditMode={mappingEditMode}
                mappingRouteVariantId={mappingRouteVariantId}
                draftPoints={draftPoints}
                draftZoneRoutePoints={draftZoneRidePoints}
                draftZoneMeters={draftZoneMeters}
                draftZonePoints={draftZonePoints}
                draftReferenceZones={draftReferenceZones}
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
            </div>

            <RaceReviewPanel
              track={effectiveTrack}
              players={racePlayers}
              raceSummary={raceSummary}
              raceCapture={raceCapture}
              activeZones={activeZones}
              reactionTimesByPlayer={reactionTimesByPlayer}
              speedUnit={speedUnit}
              distanceUnit={distanceUnit}
              remainingSeconds={raceReviewRemainingSeconds}
              paused={raceReviewPaused}
              onExtend={extendRaceReview}
              onPauseToggle={toggleRaceReviewPaused}
              onReturnToDashboard={hideRaceReview}
            />
          </section>
        ) : appMode === 'monitor' ? (
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
                ghostRiders={selectedGhostRiders}
                remoteRaceStates={remoteRaceStates}
                players={racePlayers}
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
                mappingRouteVariantId={mappingRouteVariantId}
                draftPoints={draftPoints}
                draftZoneRoutePoints={draftZoneRidePoints}
                draftZoneMeters={draftZoneMeters}
                draftZonePoints={draftZonePoints}
                draftReferenceZones={draftReferenceZones}
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
                players={racePlayers}
                branchChoicesByPlayer={activeBranchChoicesByPlayer}
                mappingRouteVariantId={mappingRouteVariantId}
                mappingZoneBranchChoice={mappingZoneBranchChoice}
                raceRouteVariantId={raceRouteVariantId}
                savedRouteVariantIds={savedRouteVariantIds}
                hasDualStartRoutes={hasDualStartRoutes}
                raceState={raceState}
                activeBikeCount={racePlayers.length}
                maxPlayers={maxPlayers}
                demoMode={demoMode}
                demoBikeCount={demoBikeCount}
                demoVariableCount={demo.variableCount}
                mappingMode={mappingMode}
                mappingFullscreen={mappingFullscreen}
                mappingEditMode={mappingEditMode}
                draftPointCount={draftPoints.length}
                draftZonePinCount={draftZoneMeters.length}
                draftZoneCount={allDraftZones.length}
                draftZones={draftZones}
                draftLengthMeters={draftLengthMeters}
                draftSplitSections={draftSplitSections}
                draftSplitBuilder={draftSplitBuilder}
                draftSplitBuilderStatus={draftSplitBuilderStatus}
                canSaveDraftSplit={canSaveDraftSplit}
                hasSavedMapping={Boolean(selectedTrackMapping)}
                mappingSaveStatus={mappingSaveStatus}
                mappingSaveMessage={mappingSaveMessage}
                mappingRestSeconds={mappingRestSeconds}
                startCadenceMode={startCadenceMode}
                countdownSeconds={countdownSeconds}
                startGateActive={startGateStatus.active}
                startGateLabel={startGateStatus.label}
                startGateDetail={startGateStatus.detail}
                ghostLaps={availableGhostLaps}
                selectedGhostIds={selectedGhostIds}
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
                onMappingZoneBranchChange={setMappingZoneBranchChoice}
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
                canUndoMapping={canUndoMapping}
                canRedoMapping={canRedoMapping}
                onMappingUndoPoint={undoMappingPoint}
                onMappingRedoPoint={redoMappingPoint}
                onMappingClearDraft={clearMappingDraft}
                onMappingSave={saveMapping}
                onMappingRemove={removeMapping}
                onMappingExport={exportMapping}
                onMappingImport={importMapping}
                onGhostToggle={toggleGhostLap}
                onGhostClear={clearSelectedGhosts}
                onPrimeAudio={primeAudioCues}
                onStart={handleStart}
                onCancel={handleCancel}
                onReset={handleReset}
              />
            </div>

            <div className="lower-grid">
              <AnalyticsPanel
                track={effectiveTrack}
                players={racePlayers}
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
                incomingMatchInvites={multiplayer.incomingMatchInvites}
                social={multiplayer.social}
                inviteUrl={multiplayer.inviteUrl}
                track={effectiveTrack}
                players={activePlayers}
                maxPlayers={maxPlayers}
                riders={riders}
                samplesByDevice={samplesByDevice}
                chatMessages={chatMessages}
                roomMessages={multiplayer.roomMessages}
                remoteRaceStates={remoteRaceStates}
                latency={multiplayer.latency}
                chatDraft={chatDraft}
                onPlayModeChange={setPlayMode}
                onProfileKeyChange={(profileKey) => multiplayer.setProfile({ guestKey: profileKey })}
                onProfileKeyCopy={copyMultiplayerProfileKey}
                onRiderNameChange={(name) => multiplayer.setProfile({ name })}
                onRiderAvailableChange={(available) => multiplayer.setProfile({ available })}
                onCreatePrivateRoom={multiplayer.createPrivateRoom}
                onCreateMatch={multiplayer.createMatch}
                onRespondToMatchInvite={multiplayer.respondToMatchInvite}
                onJoinRoom={multiplayer.joinRoom}
                onLeaveRoom={multiplayer.leaveRoom}
                onShareInvite={shareMultiplayerInvite}
                onRandomTrack={chooseRandomRoomTrack}
                onStartTrackVote={startRoomTrackVote}
                onVoteTrack={multiplayer.submitTrackVote}
                onRoomRouteChoice={handleRoomRouteChoice}
                onResetRoomFlow={multiplayer.resetRoomFlow}
                onQuickMatch={multiplayer.quickMatch}
                onChallengeRider={multiplayer.challengeRider}
                onAcceptChallenge={(challengeId) => multiplayer.respondToChallenge(challengeId, true)}
                onDeclineChallenge={(challengeId) => multiplayer.respondToChallenge(challengeId, false)}
                onSendFriendRequest={multiplayer.sendFriendRequest}
                onRespondToFriendRequest={multiplayer.respondToFriendRequest}
                onCreateGroup={multiplayer.createGroup}
                onInviteToGroup={multiplayer.inviteToGroup}
                onRespondToGroupInvite={multiplayer.respondToGroupInvite}
                onChatDraftChange={setChatDraft}
                onChatSend={sendChatMessage}
                trackVoteCandidates={multiplayerVoteCandidates}
                voiceEnabled={roomVoice.enabled}
                voiceSupported={roomVoice.supported}
                voiceStatus={roomVoice.status}
                voiceRemoteCount={roomVoice.remoteCount}
                onVoiceStart={roomVoice.start}
                onVoiceStop={roomVoice.stop}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
