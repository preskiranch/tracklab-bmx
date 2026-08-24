import {
  lazy,
  Suspense,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  BarChart3,
  Bike,
  Bluetooth,
  Compass,
  Gauge,
  LogOut,
  MapPinned,
  Radio,
  RefreshCcw,
  Route,
  Settings,
  TabletSmartphone,
  Usb,
  UserCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import type { CloudUserDataStatus } from './components/DiagnosticsPanel';
import type { ChatMessage } from './components/MultiplayerPanel';
import type {
  MonitorSprintArm,
  MonitorSprintArmCancellation,
  MonitorSprintCancellation,
  MonitorSprintCompleteResult,
  MonitorSprintHistoryStatus,
  MonitorSprintSession,
  MonitorStudioHeartRateControl,
} from './components/MonitorView';
import { PairingRail } from './components/PairingRail';
import { StudioRaceEntry } from './components/StudioRaceEntry';
import { RiderAvatar } from './components/RiderAvatar';
import {
  bikeConnectionSourceStorageKey,
  bikeProfilesStorageKey,
  customRoutesStorageKey,
  defaultPlayerSlots,
  earthCameraStorageKey,
  liveBikeTimeoutMs,
  maxPlayers,
  raceCaptureStorageKey,
  storageKey,
} from './data';
import { countriesForCatalog, statesForCountry, trackCatalog, tracksForLocation } from './data/trackCatalog';
import {
  playStartGateTone,
  playUciRandomStartVoice,
  primeAudioCues,
  startBmxEventAmbience,
  stopBmxEventAmbience,
  stopRaceAudioKeepAlive,
  stopStartGateAudio,
  uciVoiceWatchGateOffsetMs,
} from './lib/audioCues';
import {
  primeBikeRaceAudio,
  stopBikeRaceAudio,
  updateBikeRaceAudio,
} from './lib/bikeRaceAudio';
import { safeSetLocalStorage } from './lib/browserStorage';
import {
  bootstrapNativeBluetooth,
  getNativeBluetoothBootstrapStatus,
  NATIVE_BLUETOOTH_STATUS_EVENT,
  type NativeBluetoothBootstrapStatus,
} from './lib/nativeBluetoothBootstrap';
import {
  clearRaceCaptureAtIdentityBoundary,
  clearStoredRaceCaptureAtIdentityBoundary,
} from './lib/raceCapturePrivacy';
import { acceptedRaceCapture } from './lib/raceCaptureSanity';
import { supportsDragStripGameArena } from './lib/dragStripGameArena';
import {
  bikeSampleHasDriveSignalSince,
  bmxCStartBackoffMeters,
  bmxCStartReleaseMs,
  latestBikeDriveSignalAt,
  type CStartOffsetsByPlayer,
} from './lib/bmxGateStart';
import {
  appendProSetZoneBoundaryMeter,
  applyUserTrackMapping,
  captureZoneBoundaryAnchors,
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
  proSplitMinimumMph,
  draftRouteFromMapping,
  readStoredTrackMappings,
  repeatTrackZonesForLaps,
  routeIsClosedLoop,
  routeLengthWithDefaultSplitBranches,
  routeLengthMeters,
  routeVariantsFromMapping,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
  reprojectZoneBoundaryAnchors,
  splitBranchLabels,
  splitBranchSelectionsForChoice,
  splitDecisionPointsForRoute,
  writeStoredTrackMappings,
  type StoredTrackMappings,
  type TrackZoneBoundaryAnchorSet,
  zoneBoundarySetIdForSelections,
  zoneBoundarySetsFromRouteVariant,
  zoneBoundariesFromRouteVariant,
} from './lib/trackMapping';
import { playerVisualForSlot } from './lib/playerIdentity';
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
import {
  flushCloudUserDataPatches,
  queueCloudUserDataPatch,
  readCloudUserData,
  saveCloudTrackMapping,
} from './lib/cloudUserData';
import {
  applyGlobalRaceViewPreferences,
  readGlobalRaceViewPreferences,
  saveGlobalRaceViewPreferences,
} from './lib/globalRaceView';
import {
  buildGhostLapFromRace,
  ghostsForTrackRoute,
  legacyRacePersistencePlan,
  loadGhostLapsFromCloud,
  mergeGhostLaps,
  playbackGhostLap,
  readStoredGhostLaps,
  sanitizeGhostLap,
  syncGhostLapToCloud,
  writeStoredGhostLaps,
} from './lib/ghosts';
import {
  personalRecordAchievements,
  previousPersonalBestTimes,
  type PreviousPersonalBestTimes,
} from './lib/personalRecords';
import { readPublicTrackCatalog } from './lib/publicTrackMappings';
import {
  normalizeStraightSprintAirSetting,
  normalizeStraightSprintDistance,
  straightSprintCameraPreferenceKey,
  straightSprintFeetToMeters,
  straightSprintMaximumFeet,
} from './lib/straightSprint';
import { buildRaceZoneResults, raceSummaryWithCapturedMetrics } from './lib/raceReview';
import {
  countdownSeconds,
  detectFalseStart,
  falseStartResetCountdownMs,
  raceFinishCountdownMs,
  shouldHoldStraightSprintForGhost,
  type FalseStartDetection,
} from './lib/raceLifecycle';
import {
  canControlRaceStagingCountdown,
  liveRaceStagingSeconds,
} from './lib/raceStartSequence';
import {
  uciRandomDelayMaxMs,
  uciRandomDelayMinMs,
  uciStartToneIntervalMs,
} from './lib/uciStartGate';
import {
  mergeRaceViewPreferences,
  normalizeRaceViewPreferences,
  normalizeRaceCommentaryPreferences,
  raceViewPreferencesMatch,
  readStoredRaceViewPreferences,
  writeStoredRaceViewPreferences,
} from './lib/raceViewPreferences';
import {
  customBikeDisplayName,
  monitorBikeName,
  reconcileClonedBikeProfileNames,
} from './lib/bikeProfileIdentity';
import {
  bikeSampleIsLive,
  connectedDeviceFromBikeSample,
  selectRaceBikeDevices,
} from './lib/liveBikeRegistry';
import {
  activeStudioRiders,
  applyStudioRiderAssignments,
  assignStudioRider,
  createStudioRider,
  mergeStudioRiders,
  removeStudioRider,
  renameStudioRider,
  updateStudioRiderPhoto,
} from './lib/studioRiders';
import {
  readStoredStudioRidersForProfile,
  writeStoredStudioRidersForProfile,
} from './lib/studioRiderStorage';
import { normalizeRiderPhotoDataUrl } from './lib/riderPhotos';
import { resolveExploreRecentRouteHistoryScope } from './lib/exploreRecentRoutes';
import {
  clearQueuedFriendRequests,
  createFriendsApi,
  subscribeToFriendNetworkEvents,
  type FriendGhostPreview,
  type FriendProfile,
} from './lib/friends';
import {
  localeRegionCode,
  mergeUnitPreferences,
  migrateLegacyUnitPreferences,
  readStoredUnitPreferences,
  regionalUnitPreferences,
  unitPreferencesMatch,
  writeStoredUnitPreferences,
} from './lib/unitPreferences';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from './units';
import {
  clubConnectRequestIsCurrent,
  loadClubConnect,
  type ClubAthleteMembership,
  type OwnedClub,
} from './lib/clubConnect';
import type { ClubTrainingSelection } from './lib/trainingHistory';
import type { ClubOwnerTrainingCoordinatorEntry } from './lib/clubOwnerTrainingCoordinator';
import type { ClubLiveAccess } from './lib/clubLive';
import type { GetPulledLiveState, GetPulledResult } from './lib/getPulled';
import {
  clearStoredClubTabletDevice,
  clearStoredClubTabletSession,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  storeClubTabletSession,
  type ClubTabletDeviceCredential,
  type ClubTabletRoster,
  type ClubTabletSessionCredential,
} from './lib/clubTabletStorage';
import type {
  ClubLiveActivityState,
  ClubLiveExploreState,
} from './components/ClubLiveAthleteBridge';
import { authenticatedRacerBikeSeatLimit, shouldStopAdvancedConnector } from './lib/advancedConnectorPolicy';
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
  clampBillingBikeSeats,
  createMembership,
  isAdminAccountEmail,
  normalizeAccountEmail,
  readStoredMembership,
  writeStoredMembership,
  type MembershipState,
} from './lib/membership';
import { createInitialRiders } from './game/physics';
import { useRaceEngine } from './hooks/useRaceEngine';
import { useRaceCommentary } from './hooks/useRaceCommentary';
import { useBluetoothBikes } from './hooks/useBluetoothBikes';
import { createDemoPlayers, useDemoBikes } from './hooks/useDemoBikes';
import { useMultiplayer, type MultiplayerIdentityOverride } from './hooks/useMultiplayer';
import { useRoomVoiceChat } from './hooks/useRoomVoiceChat';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import { useHeartRate } from './hooks/useHeartRate';
import {
  mapHeartRateMeasurementsToActiveClock,
  summarizeHeartRate,
  summarizeHeartRateZones,
} from './lib/heartRate';
import type {
  HeartRateActivityType,
  HeartRateAccountBlockStatus,
  HeartRateLiveEvent,
  HeartRateStudioInvitation,
  HeartRateStudioBlockStatus,
  HeartRateStudioInviteUrlDisposition,
  HeartRateStudioRelayClaim,
} from './lib/heartRateCloud';
import type {
  AuthorizedClubMonitorSprint,
  ClubMonitorHeartRateSaveStatus,
  ClubMonitorSprintBinding,
  ClubMonitorSprintReservation,
} from './lib/clubMonitorHistory';
import type { LiveHeartRateByPlayer } from './components/RaceRiderOverlay';
import type {
  AccountProfile,
  AppMode,
  BikeProfile,
  BikeSample,
  ConnectedBikeDevice,
  DemoRiderNames,
  DemoRiderPhotos,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  ExploreRider,
  ExploreRideCompleteEvent,
  ExploreRoute,
  GhostLapPoint,
  MappingEditMode,
  MetricKey,
  MultiplayerRaceState,
  MultiplayerTrackVoteCandidate,
  PlayerId,
  PlayerSlot,
  PrivateHeartRateCapture,
  PlayMode,
  RaceCapture,
  RaceCommentaryPreferences,
  RaceRiderOverlayLayout,
  RaceViewPreferences,
  ReactionTimesByPlayer,
  SpeedUnit,
  StudioRider,
  StudioRiderAssignments,
  TrackPoint,
  TrackRaceViewMode,
  TrackRecord,
  TrackRouteVariantId,
  TrackZone,
  TrackZoneBoundarySet,
  TrackZoneBranchSelections,
  TrackSplitBranch,
  TrackSplitSection,
  UnitPreferences,
  UserTrackMapping,
} from './types';

const BluetoothPairingDialog = lazy(() => import('./components/BluetoothPairingDialog').then((module) => ({
  default: module.BluetoothPairingDialog,
})));
const MembershipLanding = lazy(() => import('./components/MembershipLanding').then((module) => ({
  default: module.MembershipLanding,
})));

const loadSessionControlPanel = () => import('./components/SessionControlPanel')
  .then((module) => ({ default: module.SessionControlPanel }));
const SessionControlPanel = lazy(loadSessionControlPanel);
const loadAnalyticsPanel = () => import('./components/AnalyticsPanel')
  .then((module) => ({ default: module.AnalyticsPanel }));
const AnalyticsPanel = lazy(loadAnalyticsPanel);
const loadClubOwnerUtilityMode = () => import('./components/ClubOwnerUtilityMode')
  .then((module) => ({ default: module.ClubOwnerUtilityMode }));
const ClubOwnerUtilityMode = lazy(loadClubOwnerUtilityMode);
const loadMonitorView = () => import('./components/MonitorView')
  .then((module) => ({ default: module.MonitorView }));
const MonitorView = lazy(loadMonitorView);
const loadAccountProfileView = () => import('./components/AccountProfileView')
  .then((module) => ({ default: module.AccountProfileView }));
const AccountProfileView = lazy(loadAccountProfileView);
const loadAppSettingsView = () => import('./components/AppSettingsView')
  .then((module) => ({ default: module.AppSettingsView }));
const AppSettingsView = lazy(loadAppSettingsView);
const HeartRateSettingsCard = lazy(() => import('./components/HeartRateSettingsCard')
  .then((module) => ({ default: module.HeartRateSettingsCard })));
const HeartRateAccountBlockCoordinator = lazy(() => import('./components/HeartRateAccountBlockCoordinator')
  .then((module) => ({ default: module.HeartRateAccountBlockCoordinator })));
const WatchConnectCoordinator = lazy(() => import('./components/WatchConnectCoordinator')
  .then((module) => ({ default: module.WatchConnectCoordinator })));
const RecoveryAlertCoordinator = lazy(() => import('./components/RecoveryAlertCoordinator'));
const clearNativeRecoveryBoundary = () => import('./lib/nativeRecoveryAlerts')
  .then(({ nativeRecoveryAlerts }) => nativeRecoveryAlerts.clearAllEpisodes())
  .catch(() => undefined);
const HeartRateStudioInviteDialog = lazy(() => import('./components/HeartRateStudioInviteDialog')
  .then((module) => ({ default: module.HeartRateStudioInviteDialog })));
const StudioHeartRateBlockOverlay = lazy(() => import('./components/StudioHeartRateBlockOverlay')
  .then((module) => ({ default: module.StudioHeartRateBlockOverlay })));
const ClubOwnerTrainingPreparationDialog = lazy(() => import('./components/ClubOwnerTrainingPreparationDialog')
  .then((module) => ({ default: module.ClubOwnerTrainingPreparationDialog })));
const loadFriendsView = () => import('./components/FriendsView');
const FriendsView = lazy(() => loadFriendsView().then((module) => ({ default: module.FriendsView })));
const DiagnosticsPanel = lazy(() => import('./components/DiagnosticsPanel')
  .then((module) => ({ default: module.DiagnosticsPanel })));
const DeveloperToolsPanel = lazy(() => import('./components/DeveloperToolsPanel')
  .then((module) => ({ default: module.DeveloperToolsPanel })));
const ClubLiveMonitor = lazy(() => import('./components/ClubLiveMonitor'));
const ClubLiveAthleteBridge = lazy(() => import('./components/ClubLiveAthleteBridge'));
const ClubLiveAccessNotice = lazy(() => import('./components/ClubLiveAccessNotice'));
const ClubTabletMode = lazy(() => import('./components/ClubTabletMode'));
const ClubTabletRuntime = lazy(() => import('./components/ClubTabletRuntime'));
const loadEarthTrackView = () => import('./components/EarthTrackView').then((module) => ({
  default: module.EarthTrackView,
}));
const EarthTrackView = lazy(loadEarthTrackView);
const loadMultiplayerPanel = () => import('./components/MultiplayerPanel').then((module) => ({
  default: module.MultiplayerPanel,
}));
const MultiplayerPanel = lazy(loadMultiplayerPanel);

const defaultTrack = trackCatalog.find((track) => track.id === 'chula-vista-elite-bmx') ?? trackCatalog[0];
const customRouteInitialZoom = 18;
const customRouteInitialAngle = 0;
const customRouteInitialHeading = 0;
const connectedBikeDeviceTimeoutMs = 15000;
const sideNavCountStyle: CSSProperties = {
  display: 'inline-grid',
  minWidth: 20,
  height: 20,
  marginLeft: 'auto',
  padding: '0 6px',
  placeItems: 'center',
  borderRadius: 999,
  background: '#e3524f',
  color: '#fff',
  fontSize: 10,
  fontWeight: 900,
  lineHeight: 1,
};

type BikeConnectionSource = 'bluetooth' | 'advanced' | 'demo';
type CheckoutStatus = 'idle' | 'loading' | 'error';
type SplitBranchId = TrackSplitBranch['id'];
type RaceRouteVariantId = TrackRouteVariantId;
type MappingHistoryScope = 'route' | 'zones' | 'split';
type RaceWorkflowStep = {
  kind: 'action';
  label: string;
  detail: string;
  state: string;
  primaryAction?: boolean;
  onPointerDown?: () => void;
  onClick: () => void;
} | {
  kind: 'laps';
  state: string;
};
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

function browserHasFriendInvite() {
  const url = new URL(window.location.href);
  return Boolean(
    url.searchParams.get('friendInvite')?.trim()
    || (url.pathname === '/friends/invite' && url.searchParams.get('token')?.trim()),
  );
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
const loopRouteSnapMeters = 12;
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

const currentSearchParam = (name: string) => new URLSearchParams(location.search).get(name);

function readRequestedTrackId() {
  return currentSearchParam('track')?.trim() || null;
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
  safeSetLocalStorage(customRoutesStorageKey, JSON.stringify(routes));
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
    updatedAt: Number.isFinite(camera.updatedAt) ? Number(camera.updatedAt) : 0,
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
  const playerId = ((index % defaultPlayerSlots.length) + 1) as PlayerSlot['id'];
  return playerVisualForSlot(playerId);
}

function isPlayerColorName(value: unknown): value is PlayerSlot['colorName'] {
  return value === 'lime' || value === 'red' || value === 'blue' || value === 'yellow';
}

function defaultBikeName(deviceId: number) {
  return monitorBikeName(deviceId);
}

function normalizeBikeName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
}

function isDefaultBikeProfileName(profile: Pick<BikeProfile, 'deviceId' | 'name'>) {
  const name = normalizeBikeName(profile.name).toLowerCase();
  return name === defaultBikeName(profile.deviceId).toLowerCase()
    || name === `bike ${profile.deviceId}`.toLowerCase();
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
  const storedName = normalizeBikeName(profile.name);
  const name = !storedName || isDefaultBikeProfileName({ deviceId, name: storedName })
    ? defaultBikeName(deviceId)
    : storedName;

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
  safeSetLocalStorage(bikeProfilesStorageKey, JSON.stringify(dedupeBikeProfiles(profiles)));
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
    if (parsed?.version !== 1) {
      return null;
    }

    // A browser refresh cannot resume the original race clock or gate state.
    // Never restore an interrupted capture as live, otherwise standby demo or
    // bike telemetry will make the dashboard sample count continue climbing.
    if (parsed.status === 'armed' || parsed.status === 'racing') {
      window.localStorage.removeItem(raceCaptureStorageKey);
      return null;
    }

    const accepted = acceptedRaceCapture(parsed);
    if (!accepted) window.localStorage.removeItem(raceCaptureStorageKey);
    return accepted;
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
    'cadenceRpm',
    'speedKph',
    'speedSource',
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
    sample.cadence,
    sample.speedKph,
    sample.speedSource,
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
  ]);

  return [headers, ...rows, ...summaryRows].map((row) => row.map(csvValue).join(',')).join('\n');
}

function formatClock() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type StartGateStatus = {
  active: boolean;
  phase: 'idle' | 'staging' | 'cadence' | 'false-start' | 'go';
  label: string;
  detail: string;
  lightIndex: 0 | 1 | 2 | 3 | null;
};

type OutgoingMultiplayerRaceState = Omit<MultiplayerRaceState, 'clientId' | 'riderName' | 'roomId' | 'at'>;

const idleStartGateStatus: StartGateStatus = {
  active: false,
  phase: 'idle',
  label: '',
  detail: '',
  lightIndex: null,
};

const startTreeLabels = ['RED', 'YELLOW 1', 'YELLOW 2', 'GREEN'] as const;

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

const heartRateStudioInviteParameter = 'heartRateStudioInvite';

function normalizedHeartRateStudioInviteCode(value: unknown) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[2-9A-HJ-NP-Z]{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : '';
}

function parsedHeartRateStudioInviteHref(href: string) {
  try {
    const url = new URL(href, 'https://tracklab.invalid/');
    return {
      present: url.searchParams.has(heartRateStudioInviteParameter),
      inviteCode: normalizedHeartRateStudioInviteCode(url.searchParams.get(heartRateStudioInviteParameter)),
    };
  } catch {
    return { present: false, inviteCode: '' };
  }
}

function monitorHeartRateInviteHandoffHref(currentHref: string, inviteCode: string) {
  try {
    const current = new URL(currentHref, 'https://tracklab.invalid/');
    const normalizedCode = normalizedHeartRateStudioInviteCode(inviteCode);
    if (!normalizedCode) return '';
    current.search = '';
    current.hash = '';
    current.searchParams.set(heartRateStudioInviteParameter, normalizedCode);
    return current.toString();
  } catch {
    return '';
  }
}

function applyMonitorHeartRateInviteDisposition(disposition: HeartRateStudioInviteUrlDisposition) {
  if (disposition !== 'remove' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(heartRateStudioInviteParameter)) return;
  url.searchParams.delete(heartRateStudioInviteParameter);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

type ClubMonitorSprintAuthorizationEntry = {
  reservation: ClubMonitorSprintReservation;
  authorization: Promise<AuthorizedClubMonitorSprint>;
  activation: Promise<AuthorizedClubMonitorSprint> | null;
};

type MonitorHeartRateInvitationSecret = Readonly<{
  invitationId: string;
  inviteCode: string;
  claimUrl: string;
}>;

type MonitorHeartRateActionState = Readonly<{
  phase: 'inviting' | 'error';
  detail?: string;
}>;

type ClubOwnerRacePreparationState = Readonly<{
  phase: 'idle' | 'authorizing' | 'ready' | 'activating' | 'active' | 'saving' | 'saved' | 'error';
  sessionId: string | null;
  playerIds: readonly PlayerSlot['id'][];
  detail: string;
  failureStage?: 'prepare' | 'activate' | 'complete';
}>;

const idleClubOwnerRacePreparation: ClubOwnerRacePreparationState = {
  phase: 'idle',
  sessionId: null,
  playerIds: [],
  detail: '',
};

type PersonalHeartRateFinalizeOutcome = 'account-block' | 'queued' | 'waiting' | 'not-recording';

export function nativeHeartRateWorkoutBelongsToAccount(
  workoutSessionId: string | null | undefined,
  accountId: string | null | undefined,
  knownPairingIds: ReadonlySet<string>,
) {
  if (!workoutSessionId || !accountId) return false;
  if (workoutSessionId.startsWith(`watch-block:${accountId}:`)) return true;
  const pairing = /^watch-(?:account|studio)-block:(.+)$/.exec(workoutSessionId);
  return Boolean(pairing && knownPairingIds.has(pairing[1]));
}

export function personalMonitorSavedStatus(
  heartRateOutcome: PersonalHeartRateFinalizeOutcome,
): MonitorSprintHistoryStatus {
  if (heartRateOutcome === 'account-block') {
    return {
      state: 'saved',
      label: 'Session saved · HR linking',
      detail: 'Sprint metrics are saved. The private account Watch block will attach this exact session window.',
    };
  }
  if (heartRateOutcome === 'queued') {
    return {
      state: 'saved',
      label: 'Session saved · HR syncing',
      detail: 'Sprint metrics are saved. Private Apple Watch heart rate is queued for TrackLab Cloud sync.',
    };
  }
  if (heartRateOutcome === 'waiting') {
    return {
      state: 'saved',
      label: 'Session saved · HR waiting',
      detail: 'Sprint metrics are saved, but Apple Watch heart rate still needs to finish syncing.',
    };
  }
  return {
    state: 'saved',
    label: 'Session saved · No Watch HR',
    detail: 'Sprint metrics are saved. No private Apple Watch relay was recording for this sprint.',
  };
}

export function clubMonitorSavedStatus(
  heartRateStatus: ClubMonitorHeartRateSaveStatus,
): MonitorSprintHistoryStatus {
  if (heartRateStatus === 'created' || heartRateStatus === 'updated') {
    return {
      state: 'saved',
      label: 'Athlete + HR linked',
      detail: 'The sprint is saved to the athlete and its consented Watch heart-rate segment is attached.',
    };
  }
  if (heartRateStatus === 'pending') {
    return {
      state: 'saved',
      label: 'Athlete saved · HR syncing',
      detail: 'The sprint is saved and linked. Watch heart rate will attach when the athlete’s private relay syncs.',
    };
  }
  if (heartRateStatus === 'conflict') {
    return {
      state: 'saved',
      label: 'Athlete saved · HR needs review',
      detail: 'The sprint is saved, but TrackLab could not safely attach the Watch segment to this exact sprint.',
    };
  }
  return {
    state: 'saved',
    label: heartRateStatus === 'unknown'
      ? 'Athlete saved · HR unconfirmed'
      : 'Athlete saved · No Watch HR',
    detail: heartRateStatus === 'unknown'
      ? 'The sprint is saved, but this server did not confirm a Watch heart-rate result.'
      : 'The sprint is saved. No consented Watch heart-rate stream was attached.',
  };
}

/**
 * Monitor can emit cancellation and a replacement arm in one render pass.
 * Keep every server mutation for an exact Wattbike ordered even when a prior
 * reserve/activate request rejects.
 */
export function queueClubMonitorBikeOperation<T>(
  chains: Map<number, Promise<void>>,
  bikeDeviceId: number,
  operation: () => Promise<T>,
) {
  const previous = chains.get(bikeDeviceId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  chains.set(bikeDeviceId, tail);
  void tail.finally(() => {
    if (chains.get(bikeDeviceId) === tail) chains.delete(bikeDeviceId);
  });
  return result;
}

export function activeMonitorHeartRateInvitation(
  invitations: HeartRateStudioInvitation[],
  clubId: string,
  studioRiderId: string,
  now = Date.now(),
) {
  return invitations
    .filter((invitation) => (
      invitation.clubId === clubId
      && invitation.studioRiderId === studioRiderId
      && invitation.relayScope === 'studio-block'
      && invitation.revokedAt == null
      // A claimed invitation is only a one-time handoff receipt. Readiness and
      // terminal lifecycle come from its studio block; never let an old claimed
      // invitation strand the owner in “waiting for athlete.”
      && invitation.claimedAt == null
      && invitation.expiresAt > now
    ))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

export function activeMonitorHeartRateBlock(
  blocks: HeartRateStudioBlockStatus[],
  clubId: string,
  studioRiderId: string,
) {
  return blocks
    .filter((block) => (
      block.clubId === clubId
      && block.studioRiderId === studioRiderId
      && block.relayScope === 'studio-block'
      && !['ended', 'expired', 'stopped'].includes(block.state)
    ))
    .sort((left, right) => (
      (right.blockExpiresAt ?? right.pairCodeExpiresAt ?? right.invitationExpiresAt)
      - (left.blockExpiresAt ?? left.pairCodeExpiresAt ?? left.invitationExpiresAt)
    ))[0] ?? null;
}

export default function App() {
  const bridge = useWattbikeBridge();
  const raceShellRef = useRef<HTMLDivElement | null>(null);
  const startGateTimeoutsRef = useRef<number[]>([]);
  const startGateSequenceIdRef = useRef(0);
  const stagingCountdownEndsAtRef = useRef(0);
  const stagingCountdownRemainingMsRef = useRef(0);
  const stagingCountdownTrackIdRef = useRef<string | null>(null);
  const cadenceStartedAtRef = useRef(0);
  const redLightAtRef = useRef(0);
  const cStartTriggeredPlayerIdsRef = useRef<Set<PlayerId>>(new Set());
  const cStartOffsetsByPlayerRef = useRef<CStartOffsetsByPlayer>({});
  const falseStartActiveRef = useRef(false);
  const lastFinishToneSecondRef = useRef<number | null>(null);
  const capturedSampleKeysRef = useRef<Set<string>>(new Set());
  const lastRaceDebugFrameAtRef = useRef(0);
  const activeRaceSessionIdRef = useRef<string | null>(null);
  const activeHeartRateRelaySessionRef = useRef<string | null>(null);
  const activeHeartRatePairingIdRef = useRef<string | null>(null);
  const heartRateRelayStartPromisesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const heartRatePairingIdsBySessionRef = useRef<Map<string, string>>(new Map());
  const heartRateKnownPairingIdsRef = useRef<Set<string>>(new Set());
  const heartRateAccountBlocksRef = useRef<HeartRateAccountBlockStatus[]>([]);
  const activeHeartRateAccountBlockRef = useRef<HeartRateAccountBlockStatus | null>(null);
  const heartRateAccountBlockCoversSessionsRef = useRef(false);
  // Fail closed during lazy capability/account hydration so an older
  // per-program relay cannot race a remembered Watch Connect session.
  const watchConnectSuppressLegacyRelayRef = useRef(true);
  const heartRateAccountBlockCoveredSessionIdsRef = useRef<Set<string>>(new Set());
  const heartRateAccountBlockObservedRelayIdsRef = useRef<Set<string>>(new Set());
  const heartRateAccountBlockActionPromiseRef = useRef<Promise<void> | null>(null);
  const watchConnectActionPromisesRef = useRef<Set<Promise<void>>>(new Set());
  const heartRateAccountHydrationRef = useRef<{
    accountId: string;
    promise: Promise<boolean>;
  } | null>(null);
  const heartRateAccountHydrationGenerationRef = useRef(0);
  const cancelledHeartRateRelaySessionsRef = useRef<Set<string>>(new Set());
  const finalizedHeartRateRelaySessionsRef = useRef<Set<string>>(new Set());
  const heartRateConsentUpdateRevisionRef = useRef(0);
  const clubMonitorSprintAuthorizationsRef = useRef<Map<string, ClubMonitorSprintAuthorizationEntry>>(new Map());
  const clubMonitorSaveChainsByDeviceRef = useRef<Map<number, Promise<void>>>(new Map());
  const monitorHeartRateInvitationSecretsRef = useRef<Map<string, MonitorHeartRateInvitationSecret>>(new Map());
  const monitorHeartRateBusyRidersRef = useRef<Set<string>>(new Set());
  const monitorStoppedHeartRateInvitationIdsRef = useRef<Set<string>>(new Set());
  const clubOwnerTrainingGroupRef = useRef<ClubOwnerTrainingCoordinatorEntry | null>(null);
  const clubOwnerTrainingPreparePromiseRef = useRef<Promise<void> | null>(null);
  const clubOwnerTrainingGenerationRef = useRef(0);
  const clubOwnerTrainingCompletionStartedRef = useRef<Set<string>>(new Set());
  const clubOwnerTrainingAuthorizedPlayersRef = useRef<Map<string, Set<PlayerSlot['id']>>>(new Map());
  const clubOwnerTrainingCheckpointScopeRef = useRef<string | null>(null);
  const clubOwnerTrainingRecoveryScopeRef = useRef<string | null>(null);
  const clubOwnerUtilityStartedAtRef = useRef<{ sessionId: string; startedAt: number } | null>(null);
  const clubOwnerUtilityCompletionRef = useRef<GetPulledResult | ExploreRideCompleteEvent | null>(null);
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
  const racePhotoSyncPendingRef = useRef(true);
  const racePhotoSignatureRef = useRef('');
  const friendInviteAutoOpenedRef = useRef(false);
  const customRoutePreviewRequestIdRef = useRef(0);
  const customRoutePreviewTrackIdRef = useRef<string | null>(null);
  const initialMembershipRef = useRef<MembershipState | null>(null);
  if (initialMembershipRef.current === null) {
    initialMembershipRef.current = readStoredMembership();
  }
  const [initialRequestedTrackId] = useState(readRequestedTrackId);
  const [initialCustomRoutes] = useState<TrackRecord[]>(readStoredCustomRoutes);
  const pendingInitialTrackIdRef = useRef(initialRequestedTrackId);
  const [initialUrlTrackPending, setInitialUrlTrackPending] = useState(initialRequestedTrackId !== null);
  const [initialTrack] = useState(() => findInitialTrack(initialRequestedTrackId, initialCustomRoutes));
  const selectedTrackIdRef = useRef(initialTrack.id);
  const lastBmxTrackIdRef = useRef(initialTrack.countryCode === 'CUSTOM' ? defaultTrack.id : initialTrack.id);
  const lastStraightSprintTrackIdRef = useRef<string | null>(
    initialTrack.countryCode === 'CUSTOM' ? initialTrack.id : null,
  );
  const [baseCatalogTracks, setBaseCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [catalogDatabaseReady, setCatalogDatabaseReady] = useState(false);
  const [customRoutes, setCustomRoutes] = useState<TrackRecord[]>(initialCustomRoutes);
  const [publicCustomRoutes, setPublicCustomRoutes] = useState<TrackRecord[]>([]);
  const [storedMappings, setStoredMappings] = useState<StoredTrackMappings>(readStoredTrackMappings);
  const storedMappingsRef = useRef(storedMappings);
  const [publicTrackMappings, setPublicTrackMappings] = useState<StoredTrackMappings>({});
  const [mappingSaveStatus, setMappingSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mappingSaveMessage, setMappingSaveMessage] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingFullscreen, setMappingFullscreen] = useState(false);
  const [exploreRideFullscreen, setExploreRideFullscreen] = useState(false);
  const [utilityFullscreen, setUtilityFullscreen] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [mappingObstacleView3D, setMappingObstacleView3D] = useState(false);
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneBoundarySets, setDraftZoneBoundarySets] = useState<TrackZoneBoundarySet[]>([]);
  const [preservedZoneAnchorSets, setPreservedZoneAnchorSets] = useState<TrackZoneBoundaryAnchorSet[]>([]);
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
  const [mappingRaceViewMode, setMappingRaceViewMode] = useState<TrackRaceViewMode>('satellite');
  const [straightSprintViewMode, setStraightSprintViewMode] = useState<TrackRaceViewMode>('satellite');
  const [bikeProfiles, setBikeProfiles] = useState<BikeProfile[]>(readStoredBikeProfiles);
  const [studioRiders, setStudioRiders] = useState<StudioRider[]>([]);
  const [studioRidersProfileKey, setStudioRidersProfileKey] = useState<string | null>(null);
  const studioRidersProfileKeyRef = useRef<string | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfile>({ updatedAt: 0 });
  const [trainingHistoryRevision, setTrainingHistoryRevision] = useState(0);
  const [clubTrainingMemberships, setClubTrainingMemberships] = useState<ClubAthleteMembership[]>([]);
  const [ownedClub, setOwnedClub] = useState<OwnedClub | null>(null);
  const [clubTrainingMembershipProfileKey, setClubTrainingMembershipProfileKey] = useState<string | null>(null);
  const [clubRosterManagementProfileKey, setClubRosterManagementProfileKey] = useState<string | null>(null);
  const [clubTrainingSelection, setClubTrainingSelection] = useState<ClubTrainingSelection | null>(null);
  const [clubTrainingStatus, setClubTrainingStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [clubLiveAccess, setClubLiveAccess] = useState<(ClubLiveAccess & {
    profileKey: string;
    studioRiderId: string;
  }) | null>(null);
  const [clubLiveAccessStatus, setClubLiveAccessStatus] = useState<'idle' | 'checking' | 'active' | 'inactive' | 'error'>('idle');
  const [exploreClubLiveState, setExploreClubLiveState] = useState<ClubLiveExploreState | null>(null);
  const [getPulledLiveState, setGetPulledLiveState] = useState<GetPulledLiveState | null>(null);
  const initialClubTabletDeviceRef = useRef(readStoredClubTabletDevice());
  const [clubTabletDevice, setClubTabletDevice] = useState<ClubTabletDeviceCredential | null>(
    initialClubTabletDeviceRef.current,
  );
  const [clubTabletRoster, setClubTabletRoster] = useState<ClubTabletRoster | null>(null);
  const [clubTabletSession, setClubTabletSession] = useState<ClubTabletSessionCredential | null>(
    readStoredClubTabletSession,
  );
  const [clubTabletDeviceStatus, setClubTabletDeviceStatus] = useState<'idle' | 'checking' | 'active' | 'error' | 'revoked'>(
    initialClubTabletDeviceRef.current ? 'checking' : 'idle',
  );
  const [clubTabletAuthorizationRevision, setClubTabletAuthorizationRevision] = useState(0);
  const [nativeBluetoothStatus, setNativeBluetoothStatus] = useState<NativeBluetoothBootstrapStatus>(
    getNativeBluetoothBootstrapStatus,
  );
  const clubTabletEmergencyExitRef = useRef<() => void>(() => undefined);
  const clubTabletAutoSignOutStartedRef = useRef(false);
  const clubTrainingRequestGenerationRef = useRef(0);
  const activeClubProfileKeyRef = useRef<string | null>(null);
  const [studioRiderAssignments, setStudioRiderAssignments] = useState<StudioRiderAssignments>({});
  const [bikeConnectionSource, setBikeConnectionSource] = useState<BikeConnectionSource>(readStoredBikeConnectionSource);
  const [connectorLaunchMessage, setConnectorLaunchMessage] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [bluetoothPairingOpen, setBluetoothPairingOpen] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(Math.min(4, maxPlayers));
  const [selectedDemoPlayerIds, setSelectedDemoPlayerIds] = useState<PlayerSlot['id'][]>(
    () => defaultPlayerSlots.slice(0, maxPlayers).map((player) => player.id),
  );
  const [demoRiderNames, setDemoRiderNames] = useState<DemoRiderNames>({});
  const [demoRiderPhotos, setDemoRiderPhotos] = useState<DemoRiderPhotos>({});
  const [demoRaceSeed, setDemoRaceSeed] = useState(() => Date.now());
  const [demoRaceStartedAt, setDemoRaceStartedAt] = useState<number | null>(null);
  const [demoSignalsStopped, setDemoSignalsStopped] = useState(false);
  const [earthCamerasByTrack, setEarthCamerasByTrack] = useState<Record<string, EarthCamera>>(readStoredEarthCameras);
  const [raceCameraLocked, setRaceCameraLocked] = useState(false);
  const [riderOverlaysByTrack, setRiderOverlaysByTrack] = useState<Record<string, RaceRiderOverlayLayout>>({});
  const raceViewPreferencesRef = useRef<RaceViewPreferences>(
    normalizeRaceViewPreferences(null, earthCamerasByTrack),
  );
  const [raceCommentaryPreferences, setRaceCommentaryPreferences] = useState<RaceCommentaryPreferences>(
    () => raceViewPreferencesRef.current.commentary,
  );
  const [appMode, setAppMode] = useState<AppMode>(
    initialClubTabletDeviceRef.current
      ? 'club-tablet'
      : initialTrack.countryCode === 'CUSTOM' ? 'straight-sprint' : 'race',
  );
  const lastRaceWasSprintRef = useRef(false);
  const raceWorkspaceActive = appMode === 'race' || appMode === 'straight-sprint';
  if (raceWorkspaceActive) {
    lastRaceWasSprintRef.current = appMode === 'straight-sprint';
  }
  const resultsMode = appMode === 'results';
  const settingsMode = appMode === 'settings';
  const raceWorkspaceMode = appMode === 'straight-sprint'
    || (resultsMode && lastRaceWasSprintRef.current) ? 'straight-sprint' : 'race';
  const [membership, setMembership] = useState<MembershipState>(() => initialMembershipRef.current ?? createMembership('visitor'));
  const [showMembershipLanding, setShowMembershipLanding] = useState(
    () => !initialClubTabletDeviceRef.current && (
      initialMembershipRef.current?.tier === 'visitor'
      || currentSearchParam('locator') != null
    ),
  );
  const [checkoutBikeSeats, setCheckoutBikeSeats] = useState(() => clampBillingBikeSeats(initialMembershipRef.current?.bikeSeats ?? 1));
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus>('idle');
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'signed-out' | 'signed-in'>('loading');
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [authPasswordDraft, setAuthPasswordDraft] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileEmailDraft, setProfileEmailDraft] = useState('');
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
  const [heartRateStudioInviteCode, setHeartRateStudioInviteCode] = useState(() => (
    typeof window === 'undefined' ? '' : parsedHeartRateStudioInviteHref(window.location.href).inviteCode
  ));
  const [heartRateStudioInviteOpen, setHeartRateStudioInviteOpen] = useState(() => (
    typeof window !== 'undefined' && Boolean(parsedHeartRateStudioInviteHref(window.location.href).inviteCode)
  ));
  const [heartRateMessage, setHeartRateMessage] = useState('');
  const [watchConnectCapable, setWatchConnectCapable] = useState<boolean | null>(null);
  const [ownerWatchConnectStatusByRider, setOwnerWatchConnectStatusByRider] = useState<Record<string, string>>({});
  const [heartRateAccountBlockPresent, setHeartRateAccountBlockPresent] = useState(false);
  const [heartRateHydratedAccountId, setHeartRateHydratedAccountId] = useState<string | null>(null);
  const [heartRateStudioConsent, setHeartRateStudioConsent] = useState({
    live: false,
    session: false,
  });
  const [liveHeartRateByRider, setLiveHeartRateByRider] = useState<Record<string, HeartRateLiveEvent>>({});
  const [watchConnectAccountHeartRate, setWatchConnectAccountHeartRate] = useState<HeartRateLiveEvent | null>();
  const [monitorHistoryStatusByPlayer, setMonitorHistoryStatusByPlayer] = useState<Partial<Record<
    PlayerSlot['id'],
    MonitorSprintHistoryStatus
  >>>({});
  const [monitorReservedSessionByPlayer, setMonitorReservedSessionByPlayer] = useState<Partial<Record<
    PlayerSlot['id'],
    string
  >>>({});
  const [monitorHeartRateInvitations, setMonitorHeartRateInvitations] = useState<HeartRateStudioInvitation[]>([]);
  const [monitorHeartRateBlocks, setMonitorHeartRateBlocks] = useState<HeartRateStudioBlockStatus[]>([]);
  const [monitorHeartRateActionByRider, setMonitorHeartRateActionByRider] = useState<Record<
    string,
    MonitorHeartRateActionState
  >>({});
  const [monitorHeartRateOverlayPlayerId, setMonitorHeartRateOverlayPlayerId] = useState<PlayerSlot['id'] | null>(null);
  const [clubOwnerRacePreparation, setClubOwnerRacePreparation] = useState<ClubOwnerRacePreparationState>(
    idleClubOwnerRacePreparation,
  );

  useEffect(() => {
    // Reload recovery restores the active pairing's server consent. Changing
    // club navigation must not visually reset that still-active authorization.
    if (activeHeartRatePairingIdRef.current) return;
    heartRateConsentUpdateRevisionRef.current += 1;
    setHeartRateStudioConsent({ live: false, session: false });
  }, [clubTrainingSelection?.clubId, clubTrainingSelection?.studioRiderId]);

  const [pendingFriendRequestCount, setPendingFriendRequestCount] = useState(0);
  const [friendGraphRevision, setFriendGraphRevision] = useState(0);
  const [friendNetworkRefreshRevision, setFriendNetworkRefreshRevision] = useState(0);
  const friendCountRef = useRef<number | null>(null);
  const [unitPreferences, setUnitPreferences] = useState<UnitPreferences>(() => regionalUnitPreferences());
  const unitPreferencesRef = useRef(unitPreferences);
  const { speedUnit, distanceUnit } = unitPreferences;
  const [now, setNow] = useState(Date.now());
  const [selectedCountry, setSelectedCountry] = useState(initialTrack.country);
  const [selectedState, setSelectedState] = useState(initialTrack.state);
  const [selectedTrackId, setSelectedTrackId] = useState(initialTrack.id);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['cadence', 'speed', 'reaction']);
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
  const [startGateStatus, setStartGateStatus] = useState<StartGateStatus>(idleStartGateStatus);
  const [startCountdownPaused, setStartCountdownPaused] = useState(false);
  const [cStartOffsetsByPlayer, setCStartOffsetsByPlayer] = useState<CStartOffsetsByPlayer>({});
  const [reactionStartAt, setReactionStartAt] = useState<number | null>(null);
  const [reactionTimesByPlayer, setReactionTimesByPlayer] = useState<ReactionTimesByPlayer>({});
  const [raceCapture, setRaceCapture] = useState<RaceCapture | null>(() => {
    if (initialClubTabletDeviceRef.current) {
      clearStoredRaceCaptureAtIdentityBoundary();
      return null;
    }
    return readStoredRaceCapture();
  });
  const [raceHeartRateByPlayer, setRaceHeartRateByPlayer] = useState<Partial<Record<PlayerSlot['id'], PrivateHeartRateCapture>>>({});
  const clearRaceCaptureForClubTablet = useCallback(() => {
    clearRaceCaptureAtIdentityBoundary({
      capturedSampleKeysRef,
      lastRaceDebugFrameAtRef,
      activeRaceSessionIdRef,
      ghostRaceStartedAtRef,
      ghostTraceRef,
      ghostTraceLastSampleAtRef,
    }, () => setRaceCapture(null));
  }, []);
  const [ghostLaps, setGhostLaps] = useState(readStoredGhostLaps);
  const [selectedGhostIds, setSelectedGhostIds] = useState<string[]>([]);
  const [friendGhostRaceTarget, setFriendGhostRaceTarget] = useState<(FriendGhostPreview & { profileId: string }) | null>(null);
  const friendGhostAutoSelectPendingRef = useRef(false);
  const [ghostPlaybackMs, setGhostPlaybackMs] = useState(0);
  const [previousRaceBestTimes, setPreviousRaceBestTimes] = useState<PreviousPersonalBestTimes>({});
  const [lapCount, setLapCount] = useState(1);
  const [straightSprintDistanceFeet, setStraightSprintDistanceFeet] = useState(100);
  const [straightSprintAirSetting, setStraightSprintAirSetting] = useState(1);
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [cloudUserDataStatus, setCloudUserDataStatus] = useState<CloudUserDataStatus>('loading');
  const [cloudUserDataMessage, setCloudUserDataMessage] = useState('Loading cloud profile data.');
  const [unitPreferencesSyncStatus, setUnitPreferencesSyncStatus] = useState<CloudUserDataStatus>('loading');
  const [unitPreferencesSyncMessage, setUnitPreferencesSyncMessage] = useState('Loading saved display units.');
  const [chatDraft, setChatDraft] = useState('');
  const [sidebarMoreOpen, setSidebarMoreOpen] = useState(false);
  const [regularUserPreview, setRegularUserPreview] = useState(false);
  const clubTabletKioskMode = Boolean(clubTabletDevice);
  const heartRate = useHeartRate({
    enabled: Boolean(authUser || heartRateStudioInviteCode) && !clubTabletKioskMode,
  });
  const heartRateNativeSupported = heartRate.availability?.supported ?? null;
  const heartRateRelayStateReady = heartRate.relayState != null;
  const friendsApi = useMemo(() => createFriendsApi(), [authUser?.id]);
  const handleLegacyRelaySuppressionChange = useCallback((suppressed: boolean) => {
    watchConnectSuppressLegacyRelayRef.current = suppressed;
  }, []);
  const clubTabletDeviceActive = Boolean(
    clubTabletDevice
    && clubTabletDeviceStatus === 'active'
    && clubTabletRoster?.device.id === clubTabletDevice.device.id,
  );
  const clubTabletSessionActive = Boolean(
    clubTabletDeviceActive
    && clubTabletSession
    && clubTabletSession.session.expiresAt > now
    && clubTabletSession.session.clubId === clubTabletDevice?.device.clubId,
  );
  const clubTabletProfileKey = clubTabletDevice ? `club-tablet:${clubTabletDevice.device.id}` : '';
  const accountEmail = normalizeAccountEmail(authUser?.email ?? '');
  const accountProfileComplete = authStatus === 'signed-in' && Boolean(authUser);
  const adminProfileActive = !clubTabletKioskMode && Boolean(authUser?.admin);
  const canManageStudioRiders = adminProfileActive || Boolean(
    authUser && clubRosterManagementProfileKey === authUser.profileKey,
  );
  const clubOwnerActive = Boolean(
    !clubTabletKioskMode && authUser && clubRosterManagementProfileKey === authUser.profileKey,
  );
  const studioRidersLoadedForActiveProfile = Boolean(
    authUser && studioRidersProfileKey === authUser.profileKey,
  );
  const activeProfileStudioRiders = useMemo(
    () => (studioRidersLoadedForActiveProfile ? studioRiders : []),
    [studioRiders, studioRidersLoadedForActiveProfile],
  );
  const canManageActiveStudioRiders = canManageStudioRiders
    && studioRidersLoadedForActiveProfile;

  useEffect(() => {
    const generation = ++heartRateAccountHydrationGenerationRef.current;
    const accountId = authStatus === 'signed-in' && authUser?.id && !clubTabletKioskMode
      ? authUser.id
      : null;
    let disposed = false;

    setHeartRateHydratedAccountId(null);
    heartRateAccountHydrationRef.current = null;
    activeHeartRateRelaySessionRef.current = null;
    activeHeartRatePairingIdRef.current = null;
    heartRatePairingIdsBySessionRef.current.clear();
    heartRateKnownPairingIdsRef.current.clear();
    heartRateAccountBlocksRef.current = [];
    activeHeartRateAccountBlockRef.current = null;
    heartRateAccountBlockCoversSessionsRef.current = false;
    heartRateAccountBlockCoveredSessionIdsRef.current.clear();
    heartRateAccountBlockObservedRelayIdsRef.current.clear();
    cancelledHeartRateRelaySessionsRef.current.clear();
    finalizedHeartRateRelaySessionsRef.current.clear();
    heartRateConsentUpdateRevisionRef.current += 1;
    setHeartRateStudioConsent({ live: false, session: false });

    if (!accountId) return undefined;
    if (heartRateNativeSupported == null) return undefined;
    if (heartRateNativeSupported && !heartRateRelayStateReady) return undefined;

    const hydration = (async () => {
      try {
        const [{ loadHeartRatePairings }, { reconcileHeartRateRelayAccount }] = await Promise.all([
          import('./lib/heartRateCloud'),
          import('./lib/heartRateRelayRecovery'),
        ]);
        const pairings = await loadHeartRatePairings();
        const reconciliation = reconcileHeartRateRelayAccount({
          accountId,
          pairings,
          relayState: heartRate.relayState,
        });
        if (
          disposed
          || heartRateAccountHydrationGenerationRef.current !== generation
        ) return false;

        reconciliation.pairingIdsBySession.forEach(([sessionId, pairingId]) => {
          heartRatePairingIdsBySessionRef.current.set(sessionId, pairingId);
        });
        reconciliation.knownPairingIds.forEach((pairingId) => {
          heartRateKnownPairingIdsRef.current.add(pairingId);
        });
        activeHeartRateRelaySessionRef.current = reconciliation.activeSessionId;
        activeHeartRatePairingIdRef.current = reconciliation.activePairing?.id ?? null;
        if (reconciliation.activePairing?.relayScope === 'account-block') {
          heartRateAccountBlockCoversSessionsRef.current = true;
          if (reconciliation.activeSessionId) {
            heartRateAccountBlockObservedRelayIdsRef.current.add(reconciliation.activeSessionId);
          }
          setHeartRateMessage('Restored private Apple Watch coverage.');
        } else if (reconciliation.activePairing) {
          setHeartRateStudioConsent({
            live: reconciliation.activePairing.liveStudioConsent,
            session: reconciliation.activePairing.sessionStudioConsent,
          });
        }

        const clearedAccountBoundarySessions = await Promise.all(
          reconciliation.orphanActiveSessionIds.map(async (sessionId) => {
            const cleared = await heartRate.clearRelay({ sessionId }).catch(() => null);
            return cleared && !cleared.configured ? sessionId : null;
          }),
        );
        if (
          disposed
          || heartRateAccountHydrationGenerationRef.current !== generation
        ) return false;

        setHeartRateHydratedAccountId(accountId);
        if (reconciliation.activeSessionId && reconciliation.activePairing?.relayScope !== 'account-block') {
          setHeartRateMessage('Restored this session’s private Watch relay.');
        } else if (clearedAccountBoundarySessions.some(Boolean)) {
          setHeartRateMessage('Removed a Watch relay that did not match this account.');
        } else if (reconciliation.foreignQueuedSessionCount > 0) {
          setHeartRateMessage('Another account’s Watch data is finishing its private sync.');
        }
        return true;
      } catch (error) {
        if (
          !disposed
          && heartRateAccountHydrationGenerationRef.current === generation
        ) {
          setHeartRateMessage(`Apple Watch relay recovery could not verify this account. ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      }
    })();
    heartRateAccountHydrationRef.current = { accountId, promise: hydration };

    return () => {
      disposed = true;
    };
  }, [
    authStatus,
    authUser?.id,
    clubTabletKioskMode,
    heartRate.clearRelay,
    heartRateNativeSupported,
    heartRateRelayStateReady,
  ]);

  useEffect(() => {
    if (
      !authUser
      || clubTabletKioskMode
      || friendInviteAutoOpenedRef.current
      || !browserHasFriendInvite()
    ) {
      return;
    }

    friendInviteAutoOpenedRef.current = true;
    setMappingMode(false);
    setAppMode('friends');
  }, [authUser, clubTabletKioskMode]);

  const handleFriendNetworkChange = useCallback(() => {
    friendCountRef.current = null;
    setFriendGraphRevision((current) => current + 1);
    setFriendNetworkRefreshRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || clubTabletKioskMode) return undefined;
    return subscribeToFriendNetworkEvents(handleFriendNetworkChange);
  }, [authStatus, authUser?.id, clubTabletKioskMode, handleFriendNetworkChange]);

  useEffect(() => {
    if (
      !['monitor', 'race', 'straight-sprint', 'get-pulled', 'explore'].includes(appMode)
      || authStatus !== 'signed-in'
      || !authUser?.id
      || clubTabletKioskMode
      || !ownedClub?.id
    ) return undefined;

    let disposed = false;
    let requestActive = false;
    const heartRateCloudApi = import('./lib/heartRateCloud');
    const refresh = async () => {
      if (requestActive) return;
      requestActive = true;
      try {
        const { loadHeartRateStudioBlocks, loadHeartRateStudioInvitations } = await heartRateCloudApi;
        const [invitations, blocks] = await Promise.all([
          loadHeartRateStudioInvitations(),
          loadHeartRateStudioBlocks(ownedClub.id),
        ]);
        if (disposed) return;
        const relevant = invitations.filter((invitation) => (
          invitation.clubId === ownedClub.id
          && invitation.relayScope === 'studio-block'
          && invitation.revokedAt == null
          && !monitorStoppedHeartRateInvitationIdsRef.current.has(invitation.id)
        ));
        const relevantBlocks = blocks.filter((block) => (
          block.clubId === ownedClub.id
          && block.relayScope === 'studio-block'
          && !monitorStoppedHeartRateInvitationIdsRef.current.has(block.invitationId)
        ));
        relevantBlocks.forEach((block) => {
          if (block.state !== 'waiting-athlete') {
            monitorHeartRateInvitationSecretsRef.current.delete(block.studioRiderId);
          }
        });
        setMonitorHeartRateInvitations(relevant);
        setMonitorHeartRateBlocks(relevantBlocks);
      } catch (error) {
        if (!disposed) {
          console.warn(`Could not refresh studio Apple Watch invitations: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        requestActive = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [appMode, authStatus, authUser?.id, clubTabletKioskMode, ownedClub?.id]);

  useEffect(() => {
    if (heartRate.status?.state !== 'ended') return;
    const activeSessionId = activeHeartRateRelaySessionRef.current;
    if (!activeSessionId) return;
    const finalizedStudioBlock = heartRate.relayState?.sessions.find((session) => (
      session.sessionId === activeSessionId
      && session.scope === 'studio-block'
      && session.finalized
    ));
    if (!finalizedStudioBlock) return;
    activeHeartRateRelaySessionRef.current = null;
    activeHeartRatePairingIdRef.current = null;
    heartRatePairingIdsBySessionRef.current.delete(activeSessionId);
    heartRateConsentUpdateRevisionRef.current += 1;
    setHeartRateStudioConsent({ live: false, session: false });
    setHeartRateMessage('Apple Watch ended the studio workout. Its heart-rate block is queued for private TrackLab Cloud sync.');
  }, [heartRate.relayState, heartRate.status?.state]);

  const handleHeartRateStudioInviteClose = useCallback((
    disposition: HeartRateStudioInviteUrlDisposition,
  ) => {
    applyMonitorHeartRateInviteDisposition(disposition);
    if (disposition === 'remove') setHeartRateStudioInviteCode('');
    setHeartRateStudioInviteOpen(false);
  }, []);

  const handleHeartRateStudioInviteSignIn = useCallback(() => {
    setHeartRateStudioInviteOpen(false);
    setAuthMode('login');
    setProfileFormError(null);
    setCheckoutMessage('Sign in as the athlete named in the Apple Watch studio invitation.');
    setShowMembershipLanding(true);
  }, []);

  const handleHeartRateAccountBlockSignIn = useCallback(() => {
    setAuthMode('login');
    setProfileFormError(null);
    setCheckoutMessage('Sign in to the same personal TrackLab account that created this private Apple Watch handoff.');
    setShowMembershipLanding(true);
  }, []);

  const handleHeartRateAccountBlockOpenSettings = useCallback((watch?: unknown) => {
    setShowMembershipLanding(false);
    setAppMode('settings');
    setSidebarMoreOpen(false);
    if (watch === true) location.hash = 'watch';
  }, []);

  const handleHeartRateStudioRelayConfigure = useCallback(async (
    claim: HeartRateStudioRelayClaim,
  ) => {
    if (heartRate.availability?.platform !== 'iphone' || heartRate.availability.supported !== true) {
      throw new Error(
        heartRate.availability?.reason
          || 'Open this invitation in the native TrackLab iPhone app paired with the athlete’s Apple Watch.',
      );
    }

    const workoutSessionId = `watch-studio-block:${claim.pairing.id}`;
    let workoutState = heartRate.status;
    const existingWorkoutCanSettle = workoutState?.state === 'active'
      || workoutState?.state === 'paused'
      || workoutState?.state === 'launching'
      || workoutState?.state === 'connecting';
    if (!existingWorkoutCanSettle) {
      workoutState = await heartRate.startWorkout(workoutSessionId);
    }
    if (!workoutState) {
      throw new Error('Apple Watch did not return a TrackLab workout state.');
    }
    const [{ waitForHeartRateAccountBlockWorkout }, { nativeHeartRate }] = await Promise.all([
      import('./lib/heartRateAccountBlock'),
      import('./lib/nativeHeartRate'),
    ]);
    workoutState = await waitForHeartRateAccountBlockWorkout({
      sessionId: workoutSessionId,
      initialStatus: workoutState,
      getState: nativeHeartRate.getState,
      addStatusListener: nativeHeartRate.addStatusListener,
    });
    if (workoutState.state === 'paused') {
      workoutState = await heartRate.resumeWorkout();
      workoutState = await waitForHeartRateAccountBlockWorkout({
        sessionId: workoutSessionId,
        initialStatus: workoutState,
        getState: nativeHeartRate.getState,
        addStatusListener: nativeHeartRate.addStatusListener,
      });
    }
    if (workoutState.state !== 'active' || workoutState.sessionId !== workoutSessionId) {
      throw new Error(workoutState.message || 'Apple Watch did not start the TrackLab indoor-cycling workout.');
    }

    const relay = await heartRate.configureRelay({
      baseUrl: window.location.origin,
      ingestToken: claim.ingestToken,
      sessionId: claim.pairing.sessionId,
      startedAt: Date.now(),
      scope: 'studio-block',
    });
    if (!relay.configured || relay.sessionId !== claim.pairing.sessionId) {
      throw new Error(relay.reason || 'The private studio heart-rate relay could not start.');
    }

    activeHeartRateRelaySessionRef.current = claim.pairing.sessionId;
    activeHeartRatePairingIdRef.current = claim.pairing.id;
    heartRatePairingIdsBySessionRef.current.set(claim.pairing.sessionId, claim.pairing.id);
    heartRateKnownPairingIdsRef.current.add(claim.pairing.id);
    setHeartRateStudioConsent({
      live: claim.pairing.liveStudioConsent,
      session: claim.pairing.sessionStudioConsent,
    });
    setHeartRateMessage('Apple Watch is connected for this studio block.');
  }, [heartRate]);

  const handleHeartRateStudioConsentChange = useCallback((
    field: 'live' | 'session',
    enabled: boolean,
  ) => {
    const pairingId = activeHeartRatePairingIdRef.current;
    if (!pairingId) {
      setHeartRateMessage('Reconnect Apple Watch before changing studio sharing. No consent changed.');
      return;
    }
    const previous = heartRateStudioConsent;
    const next = { ...previous, [field]: enabled };
    const revision = ++heartRateConsentUpdateRevisionRef.current;
    setHeartRateStudioConsent(next);
    void import('./lib/heartRateCloud').then(({ updateHeartRatePairingConsent }) => (
      updateHeartRatePairingConsent(pairingId, {
        liveStudioConsent: next.live,
        sessionStudioConsent: next.session,
      })
    )).then(() => {
      if (heartRateConsentUpdateRevisionRef.current === revision) {
        setHeartRateMessage('Studio heart-rate sharing updated for this session.');
      }
    }).catch((error: unknown) => {
      if (heartRateConsentUpdateRevisionRef.current !== revision) return;
      setHeartRateStudioConsent(previous);
      setHeartRateMessage(`Studio heart-rate sharing was not changed. ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [heartRateStudioConsent]);

  const beginHeartRateRelay = useCallback(({
    sessionId,
    activityType,
    riderId,
    playerId,
    startedAt,
  }: {
    sessionId: string;
    activityType: HeartRateActivityType;
    riderId: string | undefined;
    playerId: PlayerSlot['id'];
    startedAt: number;
  }) => {
    const existingStart = heartRateRelayStartPromisesRef.current.get(sessionId);
    if (existingStart) return existingStart;

    cancelledHeartRateRelaySessionsRef.current.delete(sessionId);
    const startOperation = import('./lib/personalHeartRateSessionActions')
      .then(({ startPersonalHeartRateSession }) => startPersonalHeartRateSession({
        sessionId,
        activityType,
        riderId,
        playerId,
        startedAt,
        accountId: authUser?.id ?? null,
        accountHydration: heartRateAccountHydrationRef.current,
        accountBlockCoversSessions: heartRateAccountBlockCoversSessionsRef.current
          || watchConnectSuppressLegacyRelayRef.current,
        accountBlockCoveredSessionIds: heartRateAccountBlockCoveredSessionIdsRef.current,
        clubTrainingSelection,
        studioConsent: heartRateStudioConsent,
        heartRate,
        activeSessionRef: activeHeartRateRelaySessionRef,
        activePairingRef: activeHeartRatePairingIdRef,
        pairingIdsBySession: heartRatePairingIdsBySessionRef.current,
        knownPairingIds: heartRateKnownPairingIdsRef.current,
        cancelledSessionIds: cancelledHeartRateRelaySessionsRef.current,
        finalizedSessionIds: finalizedHeartRateRelaySessionsRef.current,
        baseUrl: window.location.origin,
        onMessage: setHeartRateMessage,
      })).finally(() => {
        if (heartRateRelayStartPromisesRef.current.get(sessionId) === startOperation) {
          heartRateRelayStartPromisesRef.current.delete(sessionId);
        }
      });
    heartRateRelayStartPromisesRef.current.set(sessionId, startOperation);
    return startOperation;
  }, [authUser, clubTrainingSelection, heartRate, heartRateStudioConsent.live, heartRateStudioConsent.session]);

  const finalizeHeartRateRelay = useCallback(async ({
    sessionId,
    endedAt,
    activeDurationMs,
    zones,
  }: {
    sessionId: string;
    endedAt: number;
    activeDurationMs: number;
    zones?: Array<{
      zoneId: string;
      zoneName?: string;
      startElapsedMs: number;
      endElapsedMs: number;
    }>;
  }) => {
    if (
      heartRateAccountBlockCoveredSessionIdsRef.current.delete(sessionId)
      || heartRateAccountBlockCoversSessionsRef.current
      || watchConnectSuppressLegacyRelayRef.current
    ) return 'account-block' as const;
    return import('./lib/personalHeartRateSessionActions')
      .then(({ finalizePersonalHeartRateSession }) => finalizePersonalHeartRateSession({
        sessionId,
        endedAt,
        activeDurationMs,
        ...(zones ? { zones } : {}),
        pendingStart: heartRateRelayStartPromisesRef.current.get(sessionId) ?? null,
        heartRate,
        activeSessionRef: activeHeartRateRelaySessionRef,
        activePairingRef: activeHeartRatePairingIdRef,
        pairingIdsBySession: heartRatePairingIdsBySessionRef.current,
        cancelledSessionIds: cancelledHeartRateRelaySessionsRef.current,
        finalizedSessionIds: finalizedHeartRateRelaySessionsRef.current,
        onStudioConsentReset: () => {
          heartRateConsentUpdateRevisionRef.current += 1;
          setHeartRateStudioConsent({ live: false, session: false });
        },
        onMessage: setHeartRateMessage,
      }));
  }, [heartRate]);

  const clearHeartRateRelay = useCallback((sessionId: string) => {
    if (
      heartRateAccountBlockCoveredSessionIdsRef.current.delete(sessionId)
      || heartRateAccountBlockCoversSessionsRef.current
      || watchConnectSuppressLegacyRelayRef.current
    ) return;
    cancelledHeartRateRelaySessionsRef.current.add(sessionId);
    const pendingStart = heartRateRelayStartPromisesRef.current.get(sessionId);
    void import('./lib/personalHeartRateSessionActions')
      .then(({ clearPersonalHeartRateSession }) => clearPersonalHeartRateSession({
        sessionId,
        pendingStart: pendingStart ?? null,
        heartRate,
        activeSessionRef: activeHeartRateRelaySessionRef,
        activePairingRef: activeHeartRatePairingIdRef,
        pairingIdsBySession: heartRatePairingIdsBySessionRef.current,
        knownPairingIds: heartRateKnownPairingIdsRef.current,
        cancelledSessionIds: cancelledHeartRateRelaySessionsRef.current,
        finalizedSessionIds: finalizedHeartRateRelaySessionsRef.current,
        onStudioConsentReset: () => {
          heartRateConsentUpdateRevisionRef.current += 1;
          setHeartRateStudioConsent({ live: false, session: false });
        },
      }));
  }, [heartRate]);

  useEffect(() => {
    if (!authUser || clubTabletKioskMode) {
      setPendingFriendRequestCount(0);
      friendCountRef.current = null;
      return undefined;
    }

    let cancelled = false;
    const refreshPendingRequests = () => {
      void loadFriendsView()
        .then(({ preloadFriendsView }) => preloadFriendsView(authUser.id, friendsApi, true))
        .then(({ pendingTotal, friendPage }) => {
          if (cancelled) return;
          setPendingFriendRequestCount(pendingTotal);
          if (friendCountRef.current != null && friendCountRef.current !== friendPage.total) {
            setFriendGraphRevision((current) => current + 1);
          }
          friendCountRef.current = friendPage.total;
        })
        .catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPendingRequests();
    };

    refreshPendingRequests();
    window.addEventListener('focus', refreshPendingRequests);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(refreshPendingRequests, 45_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshPendingRequests);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [authUser, clubTabletKioskMode, friendNetworkRefreshRevision, friendsApi]);

  useEffect(() => {
    if (!authUser || clubTabletKioskMode) return undefined;
    const timerId = window.setTimeout(() => { void Promise.allSettled([
      loadAccountProfileView(), loadAppSettingsView(), loadEarthTrackView(), loadAnalyticsPanel(),
      loadSessionControlPanel(), loadMultiplayerPanel(), loadClubOwnerUtilityMode(), loadMonitorView(),
    ]); }, 500);
    return () => window.clearTimeout(timerId);
  }, [authUser, clubTabletKioskMode]);

  const mergeStudioRidersForProfile = useCallback((
    profileKey: string,
    incomingRiders: StudioRider[],
  ) => {
    const preserveCurrentRiders = studioRidersProfileKeyRef.current === profileKey;
    studioRidersProfileKeyRef.current = profileKey;
    setStudioRidersProfileKey(profileKey);
    setStudioRiders((current) => mergeStudioRiders(
      preserveCurrentRiders ? current : [],
      incomingRiders,
    ));
  }, []);
  const activeClubTrainingMemberships = authUser
    && clubTrainingMembershipProfileKey === authUser.profileKey
    ? clubTrainingMemberships
    : [];
  const selectedClubTrainingMembershipActive = Boolean(
    clubTrainingSelection && (
      activeClubTrainingMemberships.some((membership) => (
        membership.clubId === clubTrainingSelection.clubId
        && membership.studioRiderId === clubTrainingSelection.studioRiderId
      ))
      || (clubTabletSessionActive
        && clubTabletSession?.session.clubId === clubTrainingSelection.clubId
        && clubTabletSession.session.studioRiderId === clubTrainingSelection.studioRiderId)
    ),
  );
  const selectedHeartRateClubName = clubTrainingSelection
    ? activeClubTrainingMemberships.find((membership) => (
      membership.clubId === clubTrainingSelection.clubId
      && membership.studioRiderId === clubTrainingSelection.studioRiderId
    ))?.clubName ?? null
    : null;
  const watchConnectStudioMembership = clubTrainingSelection
    ? activeClubTrainingMemberships.find((membership) => (
      membership.clubId === clubTrainingSelection.clubId
      && membership.studioRiderId === clubTrainingSelection.studioRiderId
    )) ?? null
    : !ownedClub && activeClubTrainingMemberships.length === 1
      ? activeClubTrainingMemberships[0]
      : null;

  useEffect(() => {
    if (watchConnectCapable !== true || !clubOwnerActive || !ownedClub) {
      setOwnerWatchConnectStatusByRider({});
      return undefined;
    }
    let cancelled = false;
    const { id: requestedClubId, members } = ownedClub;
    const refresh = () => {
      void Promise.all([
        import('./lib/watchConnectCloud'),
        import('./lib/studioWatchConnectSelection'),
      ]).then(async ([cloud, selection]) => {
        const projections = await cloud.loadStudioWatchConnect(requestedClubId);
        if (cancelled) return;
        const next: Record<string, string> = {};
        members.forEach((member) => {
          const state = selection.studioWatchConnectSelectionState({
            clubId: requestedClubId,
            studioRiderId: member.studioRiderId,
            claimed: member.status === 'claimed',
            projections,
          });
          next[member.studioRiderId] = selection.studioWatchConnectOwnerLabel(state);
        });
        setOwnerWatchConnectStatusByRider(next);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [clubOwnerActive, ownedClub, watchConnectCapable]);

  useEffect(() => {
    // Health sharing is session-scoped and always returns to private when the
    // rider changes training ownership or signs into a different club.
    setHeartRateStudioConsent({ live: false, session: false });
  }, [clubTrainingSelection?.clubId, clubTrainingSelection?.studioRiderId]);
  const clubLiveProfileKey = clubTabletSessionActive ? clubTabletProfileKey : authUser?.profileKey ?? '';
  const clubLiveAccessActive = Boolean(
    clubTrainingSelection
    && selectedClubTrainingMembershipActive
    && clubLiveAccess?.profileKey === clubLiveProfileKey
    && clubLiveAccess.clubId === clubTrainingSelection.clubId
    && clubLiveAccess.studioRiderId === clubTrainingSelection.studioRiderId
    && clubLiveAccess.active
    && clubLiveAccess.expiresAt > now,
  );
  const authenticatedRacerAccess = authStatus === 'signed-in'
    && authUser?.membership.tier === 'racer'
    && !clubTabletKioskMode;
  const authenticatedBikeSeatLimit = authenticatedRacerBikeSeatLimit(
    authStatus,
    authUser?.membership.tier,
    authUser?.membership.bikeSeats,
    maxPlayers,
  );
  const clubMonitorReleasesLocalBikes = appMode === 'club-monitor';
  const bluetoothAccessGranted = !clubMonitorReleasesLocalBikes
    && (authenticatedRacerAccess || clubLiveAccessActive || clubTabletDeviceActive);
  const bluetooth = useBluetoothBikes({
    enabled: bluetoothAccessGranted,
    maxDevices: clubTabletKioskMode ? 1 : authenticatedBikeSeatLimit || 1,
  });
  const liveBikeSeatLimit = clubMonitorReleasesLocalBikes
    ? 0
    : clubTabletKioskMode
      ? clubTabletDeviceActive ? 1 : 0
      : authenticatedRacerAccess
      ? authenticatedBikeSeatLimit
      : clubLiveAccessActive ? 1 : 0;
  const liveBikeAccessLocked = !bluetoothAccessGranted;
  const developerUiActive = !clubTabletKioskMode && adminProfileActive && !regularUserPreview;
  const developerRaceLayoutActive = !clubTabletKioskMode && isAdminAccountEmail(accountEmail);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 1, author: 'System', text: "Private room opened for today's session.", at: '10:25 AM' },
  ]);
  const demo = useDemoBikes({
    enabled: demoMode,
    bikeCount: maxPlayers,
    raceSeed: demoRaceSeed,
    raceStartedAt: demoRaceStartedAt,
    signalState: demoSignalsStopped ? 'stopped' : demoRaceStartedAt == null ? 'ready' : 'racing',
  });

  activeClubProfileKeyRef.current = authUser?.profileKey ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleNativeBluetoothStatus = (event: Event) => {
      const status = (event as CustomEvent<NativeBluetoothBootstrapStatus>).detail;
      if (status?.state) setNativeBluetoothStatus(status);
    };
    window.addEventListener(NATIVE_BLUETOOTH_STATUS_EVENT, handleNativeBluetoothStatus);
    return () => window.removeEventListener(NATIVE_BLUETOOTH_STATUS_EVENT, handleNativeBluetoothStatus);
  }, []);

  useEffect(() => {
    if (clubTabletKioskMode) clearRaceCaptureForClubTablet();
  }, [clearRaceCaptureForClubTablet, clubTabletKioskMode]);

  useEffect(() => {
    if (!clubTabletSessionActive || !clubTabletSession) return;
    const { clubId, studioRiderId, bikeDeviceId } = clubTabletSession.session;
    setClubTrainingSelection({ clubId, studioRiderId });
    setBikeConnectionSource('bluetooth');
    setStudioRiderAssignments({ [bikeDeviceId]: studioRiderId });
    setLiveRaceReadyDeviceIds([bikeDeviceId]);
  }, [clubTabletSessionActive, clubTabletSession?.sessionToken]);

  useEffect(() => {
    if (clubTabletKioskMode && !clubTabletSessionActive && appMode !== 'club-tablet') {
      setAppMode('club-tablet');
    }
  }, [appMode, clubTabletKioskMode, clubTabletSessionActive]);

  useEffect(() => {
    storedMappingsRef.current = storedMappings;
  }, [storedMappings]);

  const refreshClubTrainingMemberships = useCallback(async () => {
    const requestedProfileKey = authUser?.profileKey ?? null;
    if (requestedProfileKey !== activeClubProfileKeyRef.current) {
      return;
    }
    const requestGeneration = ++clubTrainingRequestGenerationRef.current;
    setClubTrainingMemberships([]);
    setOwnedClub(null);
    setClubTrainingMembershipProfileKey(null);
    setClubRosterManagementProfileKey(null);
    if (!clubTabletSessionActive) setClubTrainingSelection(null);

    if (!requestedProfileKey) {
      setClubTrainingStatus('idle');
      return;
    }
    setClubTrainingStatus('loading');
    try {
      const state = await loadClubConnect();
      if (!clubConnectRequestIsCurrent(
        requestedProfileKey,
        requestGeneration,
        activeClubProfileKeyRef.current,
        clubTrainingRequestGenerationRef.current,
      )) {
        return;
      }
      setClubTrainingMemberships(state.memberships);
      setOwnedClub(state.ownedClub);
      setClubTrainingMembershipProfileKey(requestedProfileKey);
      setClubRosterManagementProfileKey(state.canManageClub ? requestedProfileKey : null);
      setClubTrainingStatus('ready');
    } catch (error) {
      if (!clubConnectRequestIsCurrent(
        requestedProfileKey,
        requestGeneration,
        activeClubProfileKeyRef.current,
        clubTrainingRequestGenerationRef.current,
      )) {
        return;
      }
      console.warn(`Could not load Club Session choices: ${error instanceof Error ? error.message : error}`);
      setClubTrainingMemberships([]);
      setOwnedClub(null);
      setClubTrainingMembershipProfileKey(null);
      setClubRosterManagementProfileKey(null);
      if (!clubTabletSessionActive) setClubTrainingSelection(null);
      setClubTrainingStatus('error');
    }
  }, [authUser, clubTabletSessionActive]);

  useEffect(() => {
    void refreshClubTrainingMemberships();
  }, [refreshClubTrainingMemberships]);

  useEffect(() => {
    if (clubMonitorReleasesLocalBikes && clubTrainingStatus !== 'loading' && !clubOwnerActive) {
      setAppMode('profile');
    }
  }, [appMode, clubOwnerActive, clubTrainingStatus]);

  useEffect(() => {
    let cancelled = false;
    setAuthStatus('loading');

    readCurrentAuthUser()
      .then(async (user) => {
        if (cancelled) {
          return;
        }

        if (!user) {
          // An authoritative signed-out bootstrap must remove a prior native
          // account restored before the server session check completed.
          await clearNativeRecoveryBoundary();
          if (cancelled) return;
        }

        setAuthUser(user);
        setAuthStatus(user ? 'signed-in' : 'signed-out');
        if (user) {
          setProfileNameDraft(user.name);
          setProfileEmailDraft(user.email);
          setMembership(user.membership);
          setCheckoutBikeSeats(user.membership.bikeSeats);
        } else {
          const visitorMembership = createMembership('visitor');
          setMembership(visitorMembership);
          setCheckoutBikeSeats(1);
        }
      })
      .catch(async (error: Error) => {
        console.warn(`Could not restore TrackLab login: ${error.message}`);
        await clearNativeRecoveryBoundary();
        if (!cancelled) {
          setAuthUser(null);
          setAuthStatus('signed-out');
          setMembership(createMembership('visitor'));
          setCheckoutBikeSeats(1);
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
    if (currentSearchParam('room') != null) {
      setPlayMode('multiplayer');
    }
  }, []);

  useEffect(() => {
    const hasClubInvite = currentSearchParam('clubInvite') != null
      || new URLSearchParams(window.location.hash.replace(/^#/, '')).has('clubInvite');
    if (authUser && hasClubInvite) {
      setShowMembershipLanding(false);
      setAppMode('profile');
    }
  }, [authUser]);

  useEffect(() => {
    const syncHeartRateStudioInvitation = () => {
      const parsed = parsedHeartRateStudioInviteHref(window.location.href);
      if (!parsed.present) return;
      if (!parsed.inviteCode) {
        applyMonitorHeartRateInviteDisposition('remove');
        setHeartRateStudioInviteCode('');
        setHeartRateStudioInviteOpen(false);
        return;
      }
      setHeartRateStudioInviteCode(parsed.inviteCode);
      setHeartRateStudioInviteOpen(true);
    };
    syncHeartRateStudioInvitation();
    window.addEventListener('popstate', syncHeartRateStudioInvitation);
    return () => window.removeEventListener('popstate', syncHeartRateStudioInvitation);
  }, []);

  useEffect(() => {
    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    void import('./lib/nativeAppLinks')
      .then(({ listenForHeartRateStudioInviteAppLinks }) => (
        listenForHeartRateStudioInviteAppLinks((inviteCode) => {
          if (disposed) return;
          const handoffHref = monitorHeartRateInviteHandoffHref(window.location.href, inviteCode);
          window.history.replaceState(window.history.state, '', handoffHref);
          setHeartRateStudioInviteCode(inviteCode);
          setHeartRateStudioInviteOpen(true);
        }, { onTrackLocator: () => !disposed && setShowMembershipLanding(true) })
      )).then((handle) => {
        listener = handle;
        if (disposed) void handle.remove();
      }).catch((error: unknown) => {
        console.warn(`Native link listener failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  useEffect(() => {
    if (authUser && heartRateStudioInviteCode) {
      setHeartRateStudioInviteOpen(true);
    }
  }, [authUser, heartRateStudioInviteCode]);

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
      void readPublicTrackCatalog()
        .then(({ trackMappings: mappings, customRoutes: routes }) => {
          if (!cancelled) {
            setPublicTrackMappings((current) => mergeTrackMappingsBySavedAt(current, mappings));
            setPublicCustomRoutes((current) => mergeCustomRoutes(current, routes));
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

  const availableCustomRoutes = useMemo(
    () => mergeCustomRoutes(publicCustomRoutes, customRoutes),
    [customRoutes, publicCustomRoutes],
  );
  const persistentCatalogTracks = useMemo(
    () => [...baseCatalogTracks, ...availableCustomRoutes],
    [availableCustomRoutes, baseCatalogTracks],
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
        if (requestedTrack.countryCode === 'CUSTOM') {
          setAppMode('straight-sprint');
        }

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
    if (initialUrlTrackPending || currentSearchParam('locator') != null) {
      return;
    }

    if (isCustomRoutePreviewId(selectedTrackId)) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('track', selectedTrackId);
    window.history.replaceState(null, '', url);
  }, [initialUrlTrackPending, selectedTrackId]);

  const countries = useMemo(() => countriesForCatalog(baseCatalogTracks), [baseCatalogTracks]);
  const states = useMemo(() => statesForCountry(selectedCountry, baseCatalogTracks), [baseCatalogTracks, selectedCountry]);
  const availableTracks = useMemo(
    () => tracksForLocation(selectedCountry, selectedState, baseCatalogTracks),
    [baseCatalogTracks, selectedCountry, selectedState],
  );
  const selectedTrack = useMemo(
    () => catalogTracks.find((track) => track.id === selectedTrackId) ?? availableTracks[0] ?? defaultTrack,
    [availableTracks, catalogTracks, selectedTrackId],
  );
  const raceCameraPreferenceKey = raceWorkspaceMode === 'straight-sprint'
    ? straightSprintCameraPreferenceKey(selectedTrack.id, straightSprintDistanceFeet)
    : selectedTrack.id;
  useEffect(() => {
    selectedTrackIdRef.current = selectedTrack.id;
    if (selectedTrack.countryCode === 'CUSTOM') {
      if (!isCustomRoutePreviewId(selectedTrack.id)) {
        lastStraightSprintTrackIdRef.current = selectedTrack.id;
      }
    } else {
      lastBmxTrackIdRef.current = selectedTrack.id;
    }
  }, [selectedTrack.countryCode, selectedTrack.id]);
  useEffect(() => {
    setMappingSaveStatus('idle');
    setMappingSaveMessage(null);
  }, [selectedTrack.id]);
  const selectedTrackMapping = newestTrackMapping(
    developerUiActive ? storedMappings[selectedTrack.id] : undefined,
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
    () => (selectedTrackMapping
      ? draftRouteFromMapping(selectedTrackMapping, mappingRouteVariantId)
      : null),
    [mappingRouteVariantId, selectedTrackMapping],
  );
  useEffect(() => {
    const savedCamera = earthCamerasByTrack[raceCameraPreferenceKey]
      ?? earthCamerasByTrack[selectedTrack.id];
    const isCustomRoute = selectedTrack.countryCode === 'CUSTOM';
    const fallbackCenter = isCustomRoute ? trackCenter(selectedTrack) : null;
    const fallbackZoom = isCustomRoute ? customRouteInitialZoom : null;
    setEarthAngle(savedCamera?.angle ?? (isCustomRoute ? customRouteInitialAngle : defaultEarthCamera.angle));
    setEarthHeading(savedCamera?.heading ?? (isCustomRoute ? customRouteInitialHeading : defaultEarthCamera.heading));
    setEarthCenter(savedCamera?.center ?? fallbackCenter);
    setEarthZoom(savedCamera?.zoom ?? fallbackZoom);
  }, [
    earthCamerasByTrack,
    raceCameraPreferenceKey,
    selectedTrack.countryCode,
    selectedTrack.id,
    selectedTrack.latitude,
    selectedTrack.longitude,
  ]);
  const satelliteEffectiveTrack = useMemo(
    () => (selectedTrackMapping
      ? applyUserTrackMapping(selectedTrack, selectedTrackMapping, hasDualStartRoutes ? raceRouteVariantId : undefined)
      : selectedTrack),
    [hasDualStartRoutes, raceRouteVariantId, selectedTrack, selectedTrackMapping],
  );
  const bmxRaceViewMode: TrackRaceViewMode = selectedTrackMapping?.raceViewMode === '3d' ? '3d' : 'satellite';
  const effectiveTrack = satelliteEffectiveTrack;
  const straightSprintGameArenaAvailable = supportsDragStripGameArena(effectiveTrack);
  useEffect(() => {
    setStraightSprintViewMode(selectedTrackMapping?.raceViewMode === '3d' ? '3d' : 'satellite');
  }, [selectedTrack.id, selectedTrackMapping?.raceViewMode]);
  const baseRouteLengthMeters = useMemo(() => {
    if (!effectiveTrack.centerline || effectiveTrack.centerline.length < 2) {
      return effectiveTrack.lengthMeters;
    }

    return Math.round(routeLengthWithDefaultSplitBranches(
      effectiveTrack.centerline,
      effectiveTrack.splitSections ?? [],
    ));
  }, [effectiveTrack.centerline, effectiveTrack.lengthMeters, effectiveTrack.splitSections]);
  const isLoopTrack = useMemo(
    () => routeIsClosedLoop(effectiveTrack.centerline ?? []),
    [effectiveTrack.centerline],
  );
  const straightSprintMappedRouteLengthMeters = effectiveTrack.centerline && effectiveTrack.centerline.length >= 2
    ? baseRouteLengthMeters
    : 0;
  const straightSprintMappedFeet = Math.round(straightSprintMappedRouteLengthMeters / 0.3048);
  const straightSprintDistanceMeters = straightSprintFeetToMeters(straightSprintDistanceFeet);
  const straightSprintRouteReady = raceWorkspaceMode !== 'straight-sprint'
    || straightSprintMappedRouteLengthMeters + 0.5 >= straightSprintDistanceMeters;
  const straightSprintMaximumRouteReady = raceWorkspaceMode !== 'straight-sprint'
    || straightSprintMappedRouteLengthMeters + 0.5 >= straightSprintFeetToMeters(straightSprintMaximumFeet);
  const effectiveRouteLengthMeters = raceWorkspaceMode === 'straight-sprint'
    ? straightSprintDistanceMeters
    : baseRouteLengthMeters * (isLoopTrack ? lapCount : 1);

  useEffect(() => {
    setLapCount(1);
  }, [selectedTrack.id, raceRouteVariantId]);
  const multiplayerVoteCandidates = useMemo<MultiplayerTrackVoteCandidate[]>(() => {
    return catalogTracks.flatMap((track) => {
      const mapping = newestTrackMapping(
        developerUiActive ? storedMappings[track.id] : undefined,
        publicTrackMappings[track.id],
      );
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
  }, [catalogTracks, developerUiActive, publicTrackMappings, storedMappings]);

  useEffect(() => {
    if (!hasDualStartRoutes && raceRouteVariantId !== 'amateur') {
      setRaceRouteVariantId('amateur');
    }
  }, [hasDualStartRoutes, raceRouteVariantId, selectedTrack.id]);

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
  useEffect(() => {
    if (preservedZoneAnchorSets.length === 0 || draftPoints.length < 2) {
      return;
    }

    const nextBoundarySets = normalizeDraftZoneBoundarySetsForRoute(
      draftPoints,
      draftRouteSplitSections,
      reprojectZoneBoundaryAnchors(draftPoints, draftRouteSplitSections, preservedZoneAnchorSets),
    );

    setDraftZoneBoundarySets((current) => (
      zoneBoundarySetsMatch(current, nextBoundarySets) ? current : nextBoundarySets
    ));
  }, [draftPoints, draftRouteSplitSections, normalizeDraftZoneBoundarySetsForRoute, preservedZoneAnchorSets]);

  const updateCurrentDraftZoneMeters = useCallback((nextMeters: number[]) => {
    setPreservedZoneAnchorSets([]);
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
      // Keep an unpaired Pro Set pin in its branch-only draft form. Merging
      // shared zones is safe once the end pin completes the pair.
      const hasPendingProBoundary = Boolean(draftZoneProRange && nextMeters.length % 2 === 1);
      const next = sortTrackZoneBoundarySets(hasPendingProBoundary
        ? nextRaw
        : mergeProBoundarySetsWithSharedZones(
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
  const exploreDemoCandidates = useMemo(
    () => createDemoPlayers(maxPlayers, demoRiderNames, demoRiderPhotos),
    [demoRiderNames, demoRiderPhotos],
  );
  const demoPlayers = exploreDemoCandidates.filter((player) => selectedDemoPlayerIds.includes(player.id));
  const connectedBikeSamples = useMemo(() => {
    // A temporary Club Live Monitor grant authorizes one direct-Bluetooth studio
    // bike only. Connector data remains a Racer feature and must never leak into
    // the temporary club seat when a connector happens to be running locally.
    const next = authenticatedRacerAccess
      ? new Map(bridge.samplesByDevice)
      : new Map<number, BikeSample>();
    bluetooth.samplesByDevice.forEach((sample, deviceId) => {
      next.set(deviceId, sample);
    });
    return next;
  }, [authenticatedRacerAccess, bluetooth.samplesByDevice, bridge.samplesByDevice]);
  const clubTabletBikeActivityAt = useMemo(() => {
    if (!clubTabletSessionActive || !clubTabletSession) return 0;
    const sample = connectedBikeSamples.get(clubTabletSession.session.bikeDeviceId);
    return latestBikeDriveSignalAt(sample);
  }, [clubTabletSession, clubTabletSessionActive, connectedBikeSamples]);
  const samplesByDevice = demoMode ? demo.samplesByDevice : connectedBikeSamples;
  const liveBikeDeviceIds = useMemo(() => {
    const deviceIds = new Set<number>();
    connectedBikeSamples.forEach((sample, deviceId) => {
      if (bikeSampleIsLive(sample, now, liveBikeTimeoutMs)) {
        deviceIds.add(deviceId);
      }
    });
    return deviceIds;
  }, [connectedBikeSamples, now]);
  const connectedBikeDevices = useMemo(() => {
    const devices: ConnectedBikeDevice[] = [
      ...(clubTabletKioskMode ? [] : bridge.devices),
      ...bluetooth.devices,
    ];

    connectedBikeSamples.forEach((sample) => {
      if (now - sample.at <= connectedBikeDeviceTimeoutMs) {
        devices.push(connectedDeviceFromBikeSample(sample));
      }
    });

    return selectRaceBikeDevices(devices, now, {
      deviceTimeoutMs: connectedBikeDeviceTimeoutMs,
      maxDevices: liveBikeSeatLimit,
    })
      .filter((device) => liveBikeDeviceIds.has(device.deviceId));
  }, [bluetooth.devices, bridge.devices, clubTabletKioskMode, connectedBikeSamples, liveBikeDeviceIds, liveBikeSeatLimit, now]);
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
  const sessionPlayers = useMemo<PlayerSlot[]>(
    () => connectedDeviceIds.map((deviceId, index) => {
      const visual = profileVisual(index);
      const profile = profileByDevice.get(deviceId);
      const connectedDevice = connectedBikeDeviceById.get(deviceId);
      const sample = connectedBikeSamples.get(deviceId);
      const deviceLabel = connectedDevice?.label ?? sample?.label;
      const customProfileName = profile && customBikeDisplayName(profile);

      return {
        id: visual.id,
        name: customProfileName ?? monitorBikeName(deviceId, deviceLabel),
        colorName: visual.colorName,
        accent: visual.accent,
        deviceId,
        deviceLabel,
        deviceSource: connectedDevice?.source ?? sample?.source,
      };
    }),
    [connectedBikeDeviceById, connectedBikeSamples, connectedDeviceIds, profileByDevice],
  );
  const activePlayers = demoMode ? demoPlayers : sessionPlayers;
  const accountRider = useMemo<StudioRider | null>(() => (
    authUser
      ? {
        id: `account:${authUser.id}`,
        name: authUser.name,
        ...(accountProfile.photoUrl ? { photoUrl: accountProfile.photoUrl } : {}),
        createdAt: 1,
        updatedAt: accountProfile.updatedAt,
      }
      : null
  ), [accountProfile.photoUrl, accountProfile.updatedAt, authUser]);
  const clubTabletRider = useMemo<StudioRider | null>(() => {
    if (!clubTabletSessionActive || !clubTabletSession) return null;
    const athlete = clubTabletRoster?.athletes.find(
      (candidate) => candidate.studioRiderId === clubTabletSession.session.studioRiderId,
    );
    return {
      id: clubTabletSession.session.studioRiderId,
      name: athlete?.athleteName || athlete?.riderName || clubTabletSession.session.athleteName || clubTabletSession.session.riderName,
      ...(athlete?.photoUrl || clubTabletSession.session.photoUrl
        ? { photoUrl: athlete?.photoUrl ?? clubTabletSession.session.photoUrl }
        : {}),
      createdAt: 1,
      updatedAt: 1,
    };
  }, [clubTabletRoster?.athletes, clubTabletSession, clubTabletSessionActive]);
  const availableStudioRiders = useMemo(
    () => clubTabletRider
      ? [clubTabletRider]
      : [
        ...(accountRider ? [accountRider] : []),
        ...(canManageActiveStudioRiders
          ? activeStudioRiders(activeProfileStudioRiders).filter((rider) => rider.id !== accountRider?.id)
          : []),
      ],
    [accountRider, activeProfileStudioRiders, canManageActiveStudioRiders, clubTabletRider],
  );
  const explorePlayers = useMemo(
    () => (
      demoMode
        ? demoPlayers
        : applyStudioRiderAssignments(activePlayers, availableStudioRiders, studioRiderAssignments)
    ),
    [
      activePlayers,
      demoMode,
      demoPlayers,
      studioRiderAssignments,
      availableStudioRiders,
    ],
  );
  const enteredRacePlayers = useMemo(() => {
    if (demoMode) {
      return activePlayers;
    }

    const readyDeviceIds = new Set(liveRaceReadyDeviceIds);
    const enteredPlayers = activePlayers.filter(
      (player) => player.deviceId != null && readyDeviceIds.has(player.deviceId),
    );
    return applyStudioRiderAssignments(enteredPlayers, availableStudioRiders, studioRiderAssignments);
  }, [activePlayers, availableStudioRiders, demoMode, liveRaceReadyDeviceIds, studioRiderAssignments]);
  const multiplayerIdentityOverride = useMemo<MultiplayerIdentityOverride | null>(() => {
    if (!clubTabletKioskMode || !clubTabletDevice) return null;
    if (!clubTabletSessionActive || !clubTabletSession) {
      return {
        scopeKey: `club-tablet:${clubTabletDevice.device.id}:picker`,
        guestKey: `club-tablet:${clubTabletDevice.device.id}:picker`,
        name: 'Choose an athlete',
        available: false,
        membershipTier: 'visitor',
        readOnly: true,
      };
    }
    const athleteName = clubTabletRider?.name
      || clubTabletSession.session.athleteName
      || clubTabletSession.session.riderName;
    return {
      // The token is used only as a local React scope generation. It is never
      // persisted or sent as the public multiplayer profile key.
      scopeKey: `club-tablet-session:${clubTabletSession.sessionToken}`,
      guestKey: `club-tablet:${clubTabletDevice.device.id}:${clubTabletSession.session.studioRiderId}`,
      name: athleteName,
      available: true,
      membershipTier: 'racer',
      readOnly: true,
    };
  }, [
    clubTabletDevice,
    clubTabletKioskMode,
    clubTabletRider?.name,
    clubTabletSession,
    clubTabletSessionActive,
  ]);
  const multiplayer = useMultiplayer({
    enabled: playMode === 'multiplayer' && (!clubTabletKioskMode || clubTabletSessionActive),
    track: effectiveTrack,
    bikeCount: appMode === 'explore'
      ? explorePlayers.length
      : demoMode
        ? activePlayers.length
        : enteredRacePlayers.length,
    identityOverride: multiplayerIdentityOverride,
    clubTabletSession: clubTabletSessionActive ? clubTabletSession : null,
    onFriendNetworkChange: authUser && !clubTabletKioskMode
      ? handleFriendNetworkChange
      : undefined,
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
  const localExploreSeatLimit = useMemo(() => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      return explorePlayers.length;
    }

    const roomMember = multiplayer.currentRoom.members.find(
      (member) => member.id === multiplayer.clientId,
    );
    if (roomMember?.roomRole === 'spectator') {
      return 0;
    }

    return Math.max(
      0,
      Math.min(
        explorePlayers.length,
        roomMember?.racerSeatCount ?? explorePlayers.length,
      ),
    );
  }, [explorePlayers.length, multiplayer.clientId, multiplayer.currentRoom, playMode]);
  const raceCandidatePlayers = lockedRacePlayers ?? enteredRacePlayers;
  const racePlayers = useMemo(
    () => raceCandidatePlayers.slice(0, localRaceSeatLimit),
    [localRaceSeatLimit, raceCandidatePlayers],
  );
  const cancelActiveClubOwnerTrainingGroup = useCallback((options: {
    keepalive?: boolean;
    preserveStatus?: boolean;
  } = {}) => {
    clubOwnerTrainingGenerationRef.current += 1;
    const entry = clubOwnerTrainingGroupRef.current;
    const preparation = clubOwnerTrainingPreparePromiseRef.current;
    const checkpointScope = clubOwnerTrainingCheckpointScopeRef.current;
    if (!options.preserveStatus) setClubOwnerRacePreparation(idleClubOwnerRacePreparation);
    return (async () => {
      if (entry) {
        const coordinator = await import('./lib/clubOwnerTrainingCoordinator');
        await coordinator.cancelClubOwnerTrainingGroup(entry, { keepalive: options.keepalive });
        if (clubOwnerTrainingGroupRef.current === entry) clubOwnerTrainingGroupRef.current = null;
        clubOwnerTrainingAuthorizedPlayersRef.current.delete(entry.request.sessionId);
        clubOwnerTrainingCompletionStartedRef.current.delete(entry.request.sessionId);
        if (clubOwnerUtilityStartedAtRef.current?.sessionId === entry.request.sessionId) {
          clubOwnerUtilityStartedAtRef.current = null;
        }
        if (
          (clubOwnerUtilityCompletionRef.current as { id?: string; sessionId?: string } | null)?.id === entry.request.sessionId
          || (clubOwnerUtilityCompletionRef.current as { id?: string; sessionId?: string } | null)?.sessionId === entry.request.sessionId
        ) {
          clubOwnerUtilityCompletionRef.current = null;
        }
        if (checkpointScope) coordinator.clearClubOwnerTrainingCheckpoint(checkpointScope);
      }
      if (preparation) await preparation.catch(() => undefined);
      if (entry && clubOwnerTrainingCheckpointScopeRef.current === checkpointScope) {
        clubOwnerTrainingCheckpointScopeRef.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    const entry = clubOwnerTrainingGroupRef.current;
    if (!entry) return;
    const expectedActivity = appMode === 'race'
      ? 'bmx-race'
      : appMode === 'straight-sprint' || appMode === 'get-pulled' || appMode === 'explore'
        ? appMode
        : null;
    const connected = new Set(connectedDeviceIds);
    const modePlayers = raceWorkspaceActive
      ? lockedRacePlayers ?? []
      : appMode === 'explore' || appMode === 'get-pulled' ? explorePlayers : activePlayers;
    const lockedByPlayer = new Map(modePlayers.map((player) => [player.id, player]));
    const finishedRecoveryMatches = raceCapture?.status === 'finished'
      && raceCapture.sessionId === entry.request.sessionId;
    const bindingMatches = entry.request.clubId === ownedClub?.id
      && entry.request.activityType === expectedActivity
      && (expectedActivity === 'bmx-race' || expectedActivity === 'straight-sprint'
        ? entry.request.sessionId === activeRaceSessionIdRef.current
        : true)
      && (finishedRecoveryMatches || entry.riders.every((rider) => {
        const player = lockedByPlayer.get(rider.playerId);
        return player?.riderId === rider.studioRiderId
          && player.deviceId === rider.bikeDeviceId
          && connected.has(rider.bikeDeviceId);
      }));
    const preserveResumableExplore = entry.request.activityType === 'explore'
      && expectedActivity !== 'explore'
      && clubOwnerActive
      && playMode === 'local'
      && !demoMode
      && entry.request.clubId === ownedClub?.id;
    if (preserveResumableExplore) return;
    if (
      !expectedActivity
      || !clubOwnerActive
      || playMode !== 'local'
      || demoMode
      || !bindingMatches
    ) {
      void cancelActiveClubOwnerTrainingGroup().catch((error: unknown) => {
        console.warn(`Club preparation cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }, [
    appMode,
    cancelActiveClubOwnerTrainingGroup,
    clubOwnerActive,
    connectedDeviceIds,
    demoMode,
    activePlayers,
    explorePlayers,
    lockedRacePlayers,
    ownedClub?.id,
    playMode,
    raceCapture?.sessionId,
    raceCapture?.status,
  ]);

  useEffect(() => () => {
    if (clubOwnerTrainingGroupRef.current?.request.activityType === 'explore') return;
    void cancelActiveClubOwnerTrainingGroup({ keepalive: true }).catch(() => undefined);
  }, [cancelActiveClubOwnerTrainingGroup]);
  const accountHeartRateRiderId = authUser ? `account:${authUser.id}` : null;
  const observedAccountHeartRate = accountHeartRateRiderId
    ? liveHeartRateByRider[accountHeartRateRiderId]
    : null;
  const accountLiveHeartRate = !accountHeartRateRiderId
    ? null
    : watchConnectAccountHeartRate !== undefined
      ? watchConnectAccountHeartRate?.riderId === accountHeartRateRiderId
        ? watchConnectAccountHeartRate
        : null
      : observedAccountHeartRate?.sessionId.startsWith('watch-connect:')
        ? null
        : observedAccountHeartRate ?? null;
  const heartRateByPlayer = useMemo<LiveHeartRateByPlayer>(() => {
    const next: LiveHeartRateByPlayer = {};
    if (demoMode) return next;
    const nativeWorkoutOwnedByAccount = nativeHeartRateWorkoutBelongsToAccount(
      heartRate.status?.sessionId,
      authUser?.id,
      heartRateKnownPairingIdsRef.current,
    );
    const candidateById = new Map<PlayerSlot['id'], PlayerSlot>();
    [...explorePlayers, ...racePlayers].forEach((player) => candidateById.set(player.id, player));

    candidateById.forEach((player) => {
      if (!player.riderId) return;
      const cloudReading = player.riderId === accountHeartRateRiderId
        ? accountLiveHeartRate
        : liveHeartRateByRider[player.riderId];
      const nativeReading = player.riderId === accountHeartRateRiderId
        && watchConnectAccountHeartRate === undefined
        && heartRateHydratedAccountId === authUser?.id
        && nativeWorkoutOwnedByAccount
        && heartRate.readingState === 'live'
        && heartRate.latest?.sessionId === heartRate.status?.sessionId
        ? heartRate.latest
        : null;
      const latest = nativeReading && (!cloudReading || nativeReading.recordedAt >= cloudReading.recordedAt)
        ? nativeReading
        : cloudReading;
      if (latest) next[player.id] = latest;
    });
    return next;
  }, [
    accountHeartRateRiderId,
    accountLiveHeartRate,
    authUser,
    demoMode,
    explorePlayers,
    heartRate.latest,
    heartRate.status?.sessionId,
    heartRate.readingState,
    heartRateHydratedAccountId,
    liveHeartRateByRider,
    racePlayers,
    watchConnectAccountHeartRate,
  ]);
  const cloudProfileKey = authUser?.profileKey ?? multiplayer.profile.guestKey;
  const exploreRecentRouteHistoryScope = resolveExploreRecentRouteHistoryScope({
    accountProfileKey: cloudProfileKey,
    accountCloudEnabled: Boolean(authUser),
    kioskMode: clubTabletKioskMode,
    clubTabletDeviceId: clubTabletDevice?.device.id,
    studioRiderId: clubTabletSessionActive
      ? clubTabletSession?.session.studioRiderId
      : null,
  });
  const regionalUnits = useMemo(() => regionalUnitPreferences(), []);
  const regionalUnitRegion = useMemo(() => localeRegionCode(), []);
  const applyUnitPreferences = useCallback((preferences: UnitPreferences) => {
    const normalized = mergeUnitPreferences(null, preferences) ?? regionalUnitPreferences();
    unitPreferencesRef.current = normalized;
    setUnitPreferences(normalized);
    return normalized;
  }, []);
  const persistUnitPreferences = useCallback((preferences: UnitPreferences) => {
    const normalized = applyUnitPreferences(preferences);
    writeStoredUnitPreferences(cloudProfileKey, normalized);
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      setCloudUserDataStatus('loading');
      setCloudUserDataMessage('Saving display units to your TrackLab profile.');
      setUnitPreferencesSyncStatus('loading');
      setUnitPreferencesSyncMessage('Saving display units to your TrackLab profile.');
      void queueCloudUserDataPatch(cloudProfileKey, { unitPreferences: normalized })
        .then((data) => {
          if (cloudUserDataLoadedKeyRef.current !== cloudProfileKey) return;
          if (!data.unitPreferences) {
            throw new Error('Cloud returned no display-unit preference.');
          }

          const current = unitPreferencesRef.current;
          const requestIsStillCurrent = unitPreferencesMatch(current, normalized);
          const resolved = requestIsStillCurrent
            ? data.unitPreferences
            : mergeUnitPreferences(data.unitPreferences, current) ?? current;
          applyUnitPreferences(resolved);
          writeStoredUnitPreferences(cloudProfileKey, resolved);
          setCloudUserDataStatus('online');
          setUnitPreferencesSyncStatus('online');
          if (!unitPreferencesMatch(data.unitPreferences, resolved)) {
            setCloudUserDataStatus('loading');
            setCloudUserDataMessage('Your latest display-unit change is still syncing.');
            setUnitPreferencesSyncStatus('loading');
            setUnitPreferencesSyncMessage('Your latest display-unit change is still syncing.');
          } else if (data.unitPreferences.updatedAt > normalized.updatedAt) {
            setCloudUserDataMessage('A newer display-unit choice from your TrackLab profile was kept.');
            setUnitPreferencesSyncMessage('A newer display-unit choice from your TrackLab profile was kept.');
          } else {
            setCloudUserDataMessage('Display units saved to your TrackLab profile.');
            setUnitPreferencesSyncMessage('Display units saved to your TrackLab profile.');
          }
        })
        .catch((error: Error) => {
          if (cloudUserDataLoadedKeyRef.current !== cloudProfileKey) return;
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Display units are saved on this device, but cloud sync is temporarily unavailable. ${error.message}`);
          setUnitPreferencesSyncStatus('offline');
          setUnitPreferencesSyncMessage(`Display units are saved on this device, but cloud sync is temporarily unavailable. ${error.message}`);
        });
    }
  }, [applyUnitPreferences, cloudProfileKey]);
  const handleSpeedUnitChange = useCallback((nextSpeedUnit: SpeedUnit) => {
    const current = unitPreferencesRef.current;
    if (current.speedUnit === nextSpeedUnit && current.updatedAt > 0) return;
    persistUnitPreferences({
      ...current,
      speedUnit: nextSpeedUnit,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    });
  }, [persistUnitPreferences]);
  const handleDistanceUnitChange = useCallback((nextDistanceUnit: DistanceUnit) => {
    const current = unitPreferencesRef.current;
    if (current.distanceUnit === nextDistanceUnit && current.updatedAt > 0) return;
    persistUnitPreferences({
      ...current,
      distanceUnit: nextDistanceUnit,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    });
  }, [persistUnitPreferences]);
  const handleRegionalUnitDefaults = useCallback(() => {
    const current = unitPreferencesRef.current;
    persistUnitPreferences({
      ...regionalUnitPreferences(),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    });
  }, [persistUnitPreferences]);
  useEffect(() => {
    applyUnitPreferences(readStoredUnitPreferences(cloudProfileKey) ?? regionalUnitPreferences());
  }, [applyUnitPreferences, cloudProfileKey]);
  useEffect(() => {
    const profileKey = authUser?.profileKey ?? null;
    studioRidersProfileKeyRef.current = profileKey;
    setStudioRidersProfileKey(profileKey);

    if (!profileKey) {
      setStudioRiders([]);
      return;
    }

    setStudioRiders(readStoredStudioRidersForProfile(profileKey, {
      allowLegacyOwnerRoster: adminProfileActive,
    }));
  }, [adminProfileActive, authUser?.profileKey]);
  useEffect(() => {
    const flushPendingPreferences = () => {
      void flushCloudUserDataPatches(cloudProfileKey);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingPreferences();
      }
    };

    window.addEventListener('pagehide', flushPendingPreferences);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushPendingPreferences);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [cloudProfileKey]);
  const applyRaceViewPreferences = useCallback((preferences: RaceViewPreferences) => {
    const normalized = normalizeRaceViewPreferences(preferences);
    raceViewPreferencesRef.current = normalized;
    setEarthCamerasByTrack(normalized.earthCamerasByTrack);
    setRaceCameraLocked(normalized.cameraLocked);
    setRiderOverlaysByTrack(normalized.riderOverlaysByTrack);
    setDemoRiderNames(normalized.demoRiderNames);
    setDemoRiderPhotos(normalized.demoRiderPhotos);
    setRaceCommentaryPreferences(normalized.commentary);
  }, []);
  const persistRaceViewPreferences = useCallback((preferences: RaceViewPreferences) => {
    const normalized = normalizeRaceViewPreferences(preferences);
    raceViewPreferencesRef.current = normalized;
    writeStoredRaceViewPreferences(cloudProfileKey, normalized);
    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void queueCloudUserDataPatch(cloudProfileKey, { raceViewPreferences: normalized }).catch((error: Error) => {
        console.warn(`Could not save race view preferences to TrackLab cloud: ${error.message}`);
      });
    }
  }, [cloudProfileKey]);
  useEffect(() => {
    const localPreferences = readStoredRaceViewPreferences(cloudProfileKey, readStoredEarthCameras());
    applyRaceViewPreferences(localPreferences);
  }, [applyRaceViewPreferences, cloudProfileKey]);
  const handleRaceCommentaryPreferencesChange = useCallback((preferences: RaceCommentaryPreferences) => {
    const normalized = normalizeRaceCommentaryPreferences(preferences);
    setRaceCommentaryPreferences(normalized);
    persistRaceViewPreferences({
      ...raceViewPreferencesRef.current,
      commentary: normalized,
      commentaryUpdatedAt: Date.now(),
    });
  }, [persistRaceViewPreferences]);
  const handleRaceCommentaryRecentLinesChange = useCallback((recentLines: string[]) => {
    const normalized = normalizeRaceCommentaryPreferences({
      ...raceViewPreferencesRef.current.commentary,
      recentLines,
    });
    setRaceCommentaryPreferences(normalized);
    persistRaceViewPreferences({
      ...raceViewPreferencesRef.current,
      commentary: normalized,
      commentaryUpdatedAt: Date.now(),
    });
  }, [persistRaceViewPreferences]);
  const ghostRouteVariantId = effectiveTrack.activeRouteVariantId ?? (hasDualStartRoutes ? raceRouteVariantId : undefined);
  const activeSprintDistanceFeet = raceWorkspaceMode === 'straight-sprint' ? straightSprintDistanceFeet : undefined;
  const activeSprintAirSetting = raceWorkspaceMode === 'straight-sprint' ? straightSprintAirSetting : undefined;
  const eventGhostLaps = useMemo(
    () => ghostsForTrackRoute(
      ghostLaps,
      effectiveTrack.id,
      ghostRouteVariantId,
      isLoopTrack ? lapCount : 1,
      activeSprintDistanceFeet,
      activeSprintAirSetting,
    ),
    [
      activeSprintAirSetting,
      activeSprintDistanceFeet,
      effectiveTrack.id,
      ghostLaps,
      ghostRouteVariantId,
      isLoopTrack,
      lapCount,
    ],
  );
  const availableGhostLaps = useMemo(
    () => eventGhostLaps.filter((ghost) => (
        ghost.raceSource === 'live'
        && (
          clubTabletSessionActive
          ||
          ghost.ownerKey === cloudProfileKey
          || ghost.source !== 'personal'
          || ghost.analyticsPublic
        )
      ))
      .sort((left, right) => (
        Number(right.id === friendGhostRaceTarget?.id) - Number(left.id === friendGhostRaceTarget?.id)
        || left.finishTimeMs - right.finishTimeMs
        || right.savedAt - left.savedAt
      ))
      .slice(0, 50),
    [
      cloudProfileKey,
      clubTabletSessionActive,
      eventGhostLaps,
      friendGhostRaceTarget?.id,
    ],
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

      return bikeSampleIsLive(samplesByDevice.get(player.deviceId), now, liveBikeTimeoutMs);
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
  const activeZones = mappedZones;
  const raceZones = useMemo(
    () => repeatTrackZonesForLaps(activeZones, baseRouteLengthMeters, isLoopTrack ? lapCount : 1),
    [activeZones, baseRouteLengthMeters, isLoopTrack, lapCount],
  );
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
  const { raceState, riders, raceSummary, finishWindowEndsAt, startRace, resetRace } = useRaceEngine(
    racePlayers,
    samplesByDevice,
    effectiveRouteLengthMeters,
    activeBranchChoicesByPlayer,
    splitDecisionPoints,
    raceZones,
  );
  const newPersonalRecordsByPlayer = useMemo(
    () => personalRecordAchievements(
      riders.map((rider) => ({
        playerId: rider.playerId,
        finishTimeMs: rider.finishedAt,
      })),
      previousRaceBestTimes,
    ),
    [previousRaceBestTimes, riders],
  );
  const selectedGhostFinishMs = useMemo(
    () => selectedGhostLaps.reduce(
      (latestFinishMs, ghost) => Math.max(latestFinishMs, ghost.finishTimeMs),
      0,
    ),
    [selectedGhostLaps],
  );
  const straightSprintGhostFinishPending = shouldHoldStraightSprintForGhost(
    appMode,
    raceState,
    selectedGhostFinishMs,
    ghostPlaybackMs,
  );
  const raceCommentary = useRaceCommentary({
    preferences: raceCommentaryPreferences,
    raceState,
    startGateActive: startGateStatus.active,
    startGatePhase: startGateStatus.phase,
    track: effectiveTrack,
    raceLengthMeters: effectiveRouteLengthMeters,
    players: racePlayers,
    riders,
    zones: raceZones,
    ghostLaps: availableGhostLaps,
    selectedGhostLaps,
    ghostRiders: selectedGhostRiders,
    ghostOwnerKey: clubTabletSessionActive ? clubTabletProfileKey : cloudProfileKey,
    newPersonalRecordsByPlayer,
    lapCount: isLoopTrack ? lapCount : 1,
    reactionTimesByPlayer,
    straightSprint: raceWorkspaceMode === 'straight-sprint',
    onRecentLinesChange: handleRaceCommentaryRecentLinesChange,
  });
  useEffect(() => {
    if (appMode === 'explore') {
      raceCommentary.stop();
      stopBmxEventAmbience();
      stopRaceAudioKeepAlive();
    }
  }, [appMode, raceCommentary.stop]);
  const primeRaceAudio = raceCommentary.prime;
  const finishingAnnouncementsActive = (
    raceState === 'finished' && !raceCommentary.finishAnnouncementsComplete
  );
  const raceAmbienceActive = (
    startGateStatus.active
    || raceState === 'racing'
    || finishingAnnouncementsActive
    || straightSprintGhostFinishPending
  );
  const raceViewFullscreen = (
    startGateStatus.active
    || raceState === 'racing'
    || finishingAnnouncementsActive
    || straightSprintGhostFinishPending
  );
  const finishCountdownSeconds = finishWindowEndsAt != null && raceState === 'racing'
    ? Math.min(raceFinishCountdownMs / 1000, Math.max(1, countdownSeconds(finishWindowEndsAt, now)))
    : null;
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

  useEffect(() => {
    if (raceAmbienceActive) {
      if (raceCommentaryPreferences.ambientEnabled) {
        void startBmxEventAmbience(raceCommentaryPreferences.ambientVolume);
      } else {
        stopBmxEventAmbience();
      }
      return;
    }

    stopBmxEventAmbience();
    stopRaceAudioKeepAlive();
  }, [
    raceAmbienceActive,
    raceCommentaryPreferences.ambientEnabled,
    raceCommentaryPreferences.ambientVolume,
  ]);

  useEffect(() => () => {
    stopBmxEventAmbience();
    stopRaceAudioKeepAlive();
  }, []);

  useEffect(() => {
    if (appMode === 'explore' || appMode === 'get-pulled') {
      return;
    }
    updateBikeRaceAudio(raceState, riders);
  }, [appMode, raceState, riders]);

  useEffect(() => () => {
    stopBikeRaceAudio();
  }, []);

  const releaseRaceFullscreen = useCallback(() => {
    releaseBrowserFullscreen();
  }, []);

  const requestRaceFullscreen = useCallback(() => {
    if (raceViewFullscreen) {
      requestBrowserFullscreen(raceShellRef.current);
    }
  }, [raceViewFullscreen]);

  useEffect(() => {
    const fullscreenActive = raceViewFullscreen || exploreRideFullscreen || utilityFullscreen;
    document.documentElement.classList.toggle('tracklab-race-active', fullscreenActive);
    document.body.classList.toggle('tracklab-race-active', fullscreenActive);
    return () => {
      document.documentElement.classList.remove('tracklab-race-active');
      document.body.classList.remove('tracklab-race-active');
    };
  }, [exploreRideFullscreen, raceViewFullscreen, utilityFullscreen]);

  const cancelStartGateSequence = useCallback(() => {
    startGateSequenceIdRef.current += 1;
    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    stopStartGateAudio();
    stagingCountdownEndsAtRef.current = 0;
    stagingCountdownRemainingMsRef.current = 0;
    stagingCountdownTrackIdRef.current = null;
    setStartCountdownPaused(false);
    cadenceStartedAtRef.current = 0;
    redLightAtRef.current = 0;
    cStartTriggeredPlayerIdsRef.current = new Set();
    cStartOffsetsByPlayerRef.current = {};
    setCStartOffsetsByPlayer({});
  }, []);

  const clearStartGateSequence = useCallback(() => {
    cancelStartGateSequence();
    falseStartActiveRef.current = false;
    setStartGateStatus(idleStartGateStatus);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, [cancelStartGateSequence]);

  useEffect(() => {
    if (finishCountdownSeconds == null) {
      lastFinishToneSecondRef.current = null;
      return;
    }

    if (lastFinishToneSecondRef.current === finishCountdownSeconds) {
      return;
    }

    lastFinishToneSecondRef.current = finishCountdownSeconds;
    playStartGateTone('tick');
  }, [finishCountdownSeconds]);

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
    void cancelActiveClubOwnerTrainingGroup().catch((error: unknown) => {
      console.warn(`Could not cancel club training preparation while changing tracks: ${error instanceof Error ? error.message : String(error)}`);
    });
    pendingInitialTrackIdRef.current = null;
    setInitialUrlTrackPending(false);
    selectedTrackIdRef.current = nextTrackId;
    clearStartGateSequence();
    setMappingFullscreen(false);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setLockedRacePlayers(null);
    resetRace();
    releaseRaceFullscreen();
  }, [cancelActiveClubOwnerTrainingGroup, clearStartGateSequence, releaseRaceFullscreen, resetRace]);

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
      racePhotoSyncPendingRef.current = true;
      racePhotoSignatureRef.current = '';
      return;
    }

    const syncedRiders = racePlayers
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
          ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
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
      .filter((rider): rider is OutgoingMultiplayerRaceState['riders'][number] => rider != null);
    const photoSignature = syncedRiders
      .map((rider) => (
        `${rider.id}:${rider.photoUrl?.length ?? 0}:${rider.photoUrl?.slice(-24) ?? ''}`
      ))
      .join('|');
    if (photoSignature !== racePhotoSignatureRef.current) {
      racePhotoSignatureRef.current = photoSignature;
      racePhotoSyncPendingRef.current = true;
    }

    latestRaceSyncRef.current = {
      sessionId: raceCapture?.sessionId ?? `${multiplayer.currentRoom.id}:${effectiveTrack.id}:manual`,
      trackId: effectiveTrack.id,
      raceState,
      riders: syncedRiders,
      summary: raceSummary,
    };
  }, [effectiveTrack.id, multiplayer.currentRoom, playMode, raceCapture?.sessionId, racePlayers, raceState, raceSummary, riders, samplesByDevice]);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !multiplayer.currentRoom) {
      return undefined;
    }

    const sendRaceState = () => {
      const state = latestRaceSyncRef.current;
      if (state) {
        const includePhotos = racePhotoSyncPendingRef.current;
        multiplayer.sendRaceState({
          ...state,
          riders: state.riders.map((rider) => {
            // The server retains the last photo; high-frequency race packets carry telemetry only.
            if (includePhotos) {
              return { ...rider, photoUrl: rider.photoUrl ?? '' };
            }
            const { photoUrl: _photoUrl, ...telemetry } = rider;
            return telemetry;
          }),
        });
        racePhotoSyncPendingRef.current = false;
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
    setRaceHeartRateByPlayer({});

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
        ...(appMode === 'straight-sprint' ? {
          sprintDistanceFeet: straightSprintDistanceFeet,
          sprintAirSetting: straightSprintAirSetting,
        } : {}),
      },
      sessionMode: 'sprint',
      selectedMetrics,
      players: racePlayers.map((player) => ({
        id: player.id,
        name: player.name,
        deviceId: player.deviceId,
        colorName: player.colorName,
        riderId: player.riderId,
        bikeName: player.bikeName,
      })),
      zones: raceZones,
      events: [{
        at: createdAt,
        elapsedMs: 0,
        type: 'race-arm',
        label: 'Race armed / riders locked',
      }],
      samples: [],
      frames: [],
      reactionTimesByPlayer: {},
      summary: [],
    };

    setRaceCapture(capture);
    return capture;
  }, [
    appMode,
    demoMode,
    effectiveRouteLengthMeters,
    effectiveTrack,
    racePlayers,
    raceZones,
    selectedMetrics,
    straightSprintAirSetting,
    straightSprintDistanceFeet,
  ]);

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

  const resetRaceCaptureForFalseStart = useCallback((detection: FalseStartDetection, at = Date.now()) => {
    setRaceCapture((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        startedAt: null,
        endedAt: null,
        status: 'armed',
        samples: [],
        frames: [],
        reactionTimesByPlayer: {},
        summary: [],
        zoneResults: [],
        events: [
          ...current.events,
          {
            at,
            elapsedMs: at - current.createdAt,
            type: 'false-start',
            label: `False start: ${detection.playerName} reached ${formatSpeedFromKph(detection.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)} before gate drop`,
          },
        ],
      };
    });
  }, [speedUnit]);

  useEffect(() => {
    if (
      raceState === 'finished'
      && raceCommentary.finishAnnouncementsComplete
      && !straightSprintGhostFinishPending
    ) {
      releaseRaceFullscreen();
    }
  }, [
    raceCommentary.finishAnnouncementsComplete,
    raceState,
    releaseRaceFullscreen,
    straightSprintGhostFinishPending,
  ]);

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
        const driveSignalAt = latestBikeDriveSignalAt(sample);
        if (driveSignalAt < reactionStartAt) {
          return;
        }

        next[player.id] = driveSignalAt - reactionStartAt;
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

      const profiles = changed ? dedupeBikeProfiles(next) : current;
      return reconcileClonedBikeProfileNames(profiles, connectedDeviceIds);
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

    safeSetLocalStorage(bikeConnectionSourceStorageKey, bikeConnectionSource);
  }, [bikeConnectionSource]);

  useEffect(() => {
    if ((clubTabletKioskMode || (!authenticatedRacerAccess && clubLiveAccessActive)) && bikeConnectionSource !== 'bluetooth') {
      setBikeConnectionSource('bluetooth');
    }
  }, [authenticatedRacerAccess, bikeConnectionSource, clubLiveAccessActive, clubTabletKioskMode]);

  useEffect(() => {
    if (shouldStopAdvancedConnector({
      authenticatedRacerAccess,
      clubMonitorOpen: clubMonitorReleasesLocalBikes,
      sourceState: bridge.sourceState,
    })) {
      void bridge.stopLocalBridge();
    }
  }, [
    bridge.sourceState,
    bridge.stopLocalBridge,
    clubMonitorReleasesLocalBikes,
    authenticatedRacerAccess,
  ]);

  useEffect(() => {
    if (!demoMode && bluetooth.connectedCount > 0 && bikeConnectionSource !== 'bluetooth') {
      setBikeConnectionSource('bluetooth');
    }
  }, [bikeConnectionSource, bluetooth.connectedCount, demoMode]);

  useEffect(() => {
    if (
      clubMonitorReleasesLocalBikes
      || demoMode
      || bikeConnectionSource !== 'advanced'
      || !authenticatedRacerAccess
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
    clubMonitorReleasesLocalBikes,
    demoMode,
    authenticatedRacerAccess,
  ]);

  useEffect(() => {
    if (bridge.connection !== 'open' || bridgeUserDataLoadedRef.current) {
      return;
    }

    const requestedProfileKey = authUser?.profileKey ?? null;
    let cancelled = false;
    readBridgeUserData()
      .then((data) => {
        if (cancelled) {
          return;
        }

        if (adminProfileActive) {
          setStoredMappings((current) => {
            const next = mergeTrackMappingsBySavedAt(current, data.trackMappings);
            writeStoredTrackMappings(next);
            return next;
          });
        }
        setCustomRoutes((current) => {
          const next = mergeCustomRoutes(current, data.customRoutes);
          writeStoredCustomRoutes(next);
          return next;
        });
        setBikeProfiles((current) => mergeBikeProfiles(current, data.bikeProfiles));
        if (canManageStudioRiders && requestedProfileKey) {
          mergeStudioRidersForProfile(requestedProfileKey, data.studioRiders);
        }
        bridgeUserDataLoadedRef.current = true;
      })
      .catch((error: Error) => {
        console.warn(`Could not load TrackLab bridge user data: ${error.message}`);
        bridgeUserDataLoadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [
    adminProfileActive,
    authUser?.profileKey,
    bridge.connection,
    canManageStudioRiders,
    mergeStudioRidersForProfile,
  ]);

  useEffect(() => {
    if (!cloudProfileKey) {
      setCloudUserDataStatus('offline');
      setCloudUserDataMessage('No profile key is available for cloud sync.');
      setUnitPreferencesSyncStatus('offline');
      setUnitPreferencesSyncMessage('Display units are saved on this device because no profile key is available.');
      return;
    }

    const requestedProfileKey = authUser?.profileKey ?? null;
    let cancelled = false;
    let loading = false;
    cloudUserDataLoadedKeyRef.current = null;
    cloudUserDataAvailableRef.current = false;
    setCloudUserDataStatus('loading');
    setCloudUserDataMessage('Loading cloud profile data.');
    setUnitPreferencesSyncStatus('loading');
    setUnitPreferencesSyncMessage('Loading saved display units.');

    const refreshCloudUserData = () => {
      if (loading || cancelled) {
        return;
      }

      loading = true;
      void Promise.all([
        readCloudUserData(cloudProfileKey),
        readGlobalRaceViewPreferences().catch((error: Error) => {
          console.warn(`Could not load the developer's global race view: ${error.message}`);
          return null;
        }),
      ])
        .then(([data, globalRaceViewPreferences]) => {
          if (cancelled) {
            return;
          }

          if (adminProfileActive) {
            setStoredMappings((current) => {
              const next = mergeTrackMappingsBySavedAt(current, data.trackMappings);
              writeStoredTrackMappings(next);
              return next;
            });
          }
          setCustomRoutes((current) => {
            const next = mergeCustomRoutes(current, data.customRoutes);
            writeStoredCustomRoutes(next);
            return next;
          });
          setBikeProfiles((current) => mergeBikeProfiles(current, data.bikeProfiles));
          if (canManageStudioRiders && requestedProfileKey) {
            mergeStudioRidersForProfile(requestedProfileKey, data.studioRiders);
          }
          setAccountProfile((current) => (
            data.accountProfile.updatedAt >= current.updatedAt ? data.accountProfile : current
          ));
          const storedUnitPreferences = readStoredUnitPreferences(cloudProfileKey);
          const accountUnitPreferences = data.unitPreferences
            ? mergeUnitPreferences(storedUnitPreferences, data.unitPreferences)
            : storedUnitPreferences
              ?? (requestedProfileKey ? migrateLegacyUnitPreferences(cloudProfileKey) : null)
              ?? regionalUnitPreferences(undefined, Date.now());
          if (accountUnitPreferences) {
            applyUnitPreferences(accountUnitPreferences);
            writeStoredUnitPreferences(cloudProfileKey, accountUnitPreferences);
            if (!data.unitPreferences || !unitPreferencesMatch(data.unitPreferences, accountUnitPreferences)) {
              setUnitPreferencesSyncStatus('loading');
              setUnitPreferencesSyncMessage('Saving display units to your TrackLab profile.');
              void queueCloudUserDataPatch(cloudProfileKey, {
                unitPreferences: accountUnitPreferences,
              })
                .then((savedData) => {
                  if (cancelled || cloudUserDataLoadedKeyRef.current !== cloudProfileKey) return;
                  if (!savedData.unitPreferences) {
                    throw new Error('Cloud returned no display-unit preference.');
                  }

                  const current = unitPreferencesRef.current;
                  const requestIsStillCurrent = unitPreferencesMatch(current, accountUnitPreferences);
                  const resolved = requestIsStillCurrent
                    ? savedData.unitPreferences
                    : mergeUnitPreferences(savedData.unitPreferences, current) ?? current;
                  applyUnitPreferences(resolved);
                  writeStoredUnitPreferences(cloudProfileKey, resolved);
                  if (!unitPreferencesMatch(savedData.unitPreferences, resolved)) {
                    setCloudUserDataStatus('loading');
                    setCloudUserDataMessage('Your latest display-unit change is still syncing.');
                    setUnitPreferencesSyncStatus('loading');
                    setUnitPreferencesSyncMessage('Your latest display-unit change is still syncing.');
                  } else if (savedData.unitPreferences.updatedAt > accountUnitPreferences.updatedAt) {
                    setCloudUserDataStatus('online');
                    setCloudUserDataMessage('A newer display-unit choice from your TrackLab profile was kept.');
                    setUnitPreferencesSyncStatus('online');
                    setUnitPreferencesSyncMessage('A newer display-unit choice from your TrackLab profile was kept.');
                  } else {
                    setUnitPreferencesSyncStatus('online');
                    setUnitPreferencesSyncMessage('Display units saved to your TrackLab profile.');
                  }
                })
                .catch((error: Error) => {
                  console.warn(`Could not reconcile display units with TrackLab cloud: ${error.message}`);
                  if (!cancelled && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
                    setCloudUserDataStatus('offline');
                    setCloudUserDataMessage(`Display units are saved on this device, but cloud sync is temporarily unavailable. ${error.message}`);
                    setUnitPreferencesSyncStatus('offline');
                    setUnitPreferencesSyncMessage(`Display units are saved on this device, but cloud sync is temporarily unavailable. ${error.message}`);
                  }
                });
            } else {
              setUnitPreferencesSyncStatus('online');
              setUnitPreferencesSyncMessage('Display units are synced to your TrackLab profile.');
            }
          }
          const localRaceViewPreferences = readStoredRaceViewPreferences(
            cloudProfileKey,
            readStoredEarthCameras(),
          );
          const accountRaceViewPreferences = data.raceViewPreferences
            ? mergeRaceViewPreferences(localRaceViewPreferences, data.raceViewPreferences)
            : localRaceViewPreferences;
          const mergedRaceViewPreferences = applyGlobalRaceViewPreferences(
            accountRaceViewPreferences,
            globalRaceViewPreferences,
          );
          applyRaceViewPreferences(mergedRaceViewPreferences);
          writeStoredRaceViewPreferences(cloudProfileKey, mergedRaceViewPreferences);
          cloudUserDataAvailableRef.current = true;
          cloudUserDataLoadedKeyRef.current = cloudProfileKey;
          if (
            !data.raceViewPreferences
            || !raceViewPreferencesMatch(data.raceViewPreferences, accountRaceViewPreferences)
          ) {
            void queueCloudUserDataPatch(cloudProfileKey, {
              raceViewPreferences: accountRaceViewPreferences,
            }).catch((error: Error) => {
              console.warn(`Could not reconcile race view preferences with TrackLab cloud: ${error.message}`);
            });
          }
          if (
            !globalRaceViewPreferences
            && developerRaceLayoutActive
            && accountRaceViewPreferences.cameraLocked
            && Object.keys(accountRaceViewPreferences.earthCamerasByTrack).length > 0
          ) {
            void saveGlobalRaceViewPreferences(accountRaceViewPreferences)
              .then((savedGlobalPreferences) => {
                if (cancelled) {
                  return;
                }
                const nextPreferences = applyGlobalRaceViewPreferences(
                  raceViewPreferencesRef.current,
                  savedGlobalPreferences,
                );
                applyRaceViewPreferences(nextPreferences);
                writeStoredRaceViewPreferences(cloudProfileKey, nextPreferences);
              })
              .catch((error: Error) => {
                console.warn(`Could not publish the developer's existing race view: ${error.message}`);
              });
          }
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Display units, bike names, the developer camera view, studio riders, custom routes, and track maps are synced to your profile.');

          if (authUser && adminProfileActive && mappingBackfillProfileRef.current !== cloudProfileKey) {
            mappingBackfillProfileRef.current = cloudProfileKey;
            const recoverableRoutes = mergeCustomRoutes(readStoredCustomRoutes(), data.customRoutes);
            const recoverableRouteById = new Map(recoverableRoutes.map((route) => [route.id, route]));
            const profileMappings = mergeTrackMappingsBySavedAt(storedMappingsRef.current, data.trackMappings);
            const unsyncedMappings = Object.values(profileMappings).filter((localMapping) => {
              const cloudMapping = data.trackMappings[localMapping.trackId];
              if (recoverableRouteById.has(localMapping.trackId)) {
                return true;
              }
              return newestTrackMapping(cloudMapping, localMapping) === localMapping
                && localMapping.savedAt !== cloudMapping?.savedAt;
            });

            if (unsyncedMappings.length > 0) {
              void Promise.allSettled(unsyncedMappings.map((mapping) => saveCloudTrackMapping(
                mapping,
                recoverableRouteById.get(mapping.trackId),
              ))).then((results) => {
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
            const offlineUnitPreferences = readStoredUnitPreferences(cloudProfileKey)
              ?? (requestedProfileKey ? migrateLegacyUnitPreferences(cloudProfileKey) : null)
              ?? regionalUnitPreferences(undefined, Date.now());
            applyUnitPreferences(offlineUnitPreferences);
            writeStoredUnitPreferences(cloudProfileKey, offlineUnitPreferences);
            cloudUserDataAvailableRef.current = false;
            cloudUserDataLoadedKeyRef.current = cloudProfileKey;
            setCloudUserDataStatus('offline');
            setCloudUserDataMessage(`Cloud profile unavailable. Local browser storage is still active. ${error.message}`);
            setUnitPreferencesSyncStatus('offline');
            setUnitPreferencesSyncMessage(`Display units are saved on this device, but cloud sync is temporarily unavailable. ${error.message}`);
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
  }, [
    adminProfileActive,
    applyRaceViewPreferences,
    applyUnitPreferences,
    authUser,
    canManageStudioRiders,
    cloudProfileKey,
    developerRaceLayoutActive,
    mergeStudioRidersForProfile,
  ]);

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
    if (!authUser || studioRidersProfileKey !== authUser.profileKey) {
      return;
    }

    const normalizedRiders = mergeStudioRiders(studioRiders);
    writeStoredStudioRidersForProfile(authUser.profileKey, normalizedRiders);
    if (!canManageActiveStudioRiders) {
      return;
    }
    if (bridge.connection === 'open' && bridgeUserDataLoadedRef.current) {
      void queueBridgeUserDataPatch({ studioRiders: normalizedRiders }).catch((error: Error) => {
        console.warn(`Could not save studio riders to TrackLab bridge: ${error.message}`);
      });
    }

    if (cloudUserDataAvailableRef.current && cloudUserDataLoadedKeyRef.current === cloudProfileKey) {
      void queueCloudUserDataPatch(cloudProfileKey, { studioRiders: normalizedRiders })
        .then(() => {
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Studio rider roster saved to this cloud profile.');
        })
        .catch((error: Error) => {
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Could not save studio rider roster to cloud. ${error.message}`);
          console.warn(`Could not save studio riders to TrackLab cloud: ${error.message}`);
        });
    }
  }, [
    authUser?.profileKey,
    bridge.connection,
    canManageActiveStudioRiders,
    cloudProfileKey,
    studioRiders,
    studioRidersProfileKey,
  ]);

  useEffect(() => {
    const activeRiderIds = new Set(availableStudioRiders.map((rider) => rider.id));
    setStudioRiderAssignments((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([, riderId]) => activeRiderIds.has(riderId)),
      );
      const unchanged = Object.keys(next).length === Object.keys(current).length
        && Object.entries(next).every(([deviceId, riderId]) => current[Number(deviceId)] === riderId);
      return unchanged ? current : next;
    });
  }, [availableStudioRiders]);

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
    if (!adminProfileActive || bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      return;
    }

    void queueBridgeUserDataPatch({ trackMappings: storedMappings }).catch((error: Error) => {
      console.warn(`Could not save track mappings to TrackLab bridge: ${error.message}`);
    });
  }, [adminProfileActive, bridge.connection, storedMappings]);

  useEffect(() => {
    if (!raceCapture) {
      window.localStorage.removeItem(raceCaptureStorageKey);
      (window as typeof window & { __tracklabLastRaceCapture?: RaceCapture | null }).__tracklabLastRaceCapture = null;
      return;
    }

    safeSetLocalStorage(raceCaptureStorageKey, JSON.stringify(raceCapture));
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
          riderPedalPhase: rider?.pedalPhase ?? null,
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
    safeSetLocalStorage('tracklab-live-debug', JSON.stringify(liveDebug));
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
    if (!clubTabletKioskMode) writeStoredGhostLaps(ghostLaps);
  }, [clubTabletKioskMode, ghostLaps]);

  useEffect(() => {
    const availableIds = new Set(availableGhostLaps.map((ghost) => ghost.id));
    setSelectedGhostIds((current) => current.filter((ghostId) => availableIds.has(ghostId)));
  }, [availableGhostLaps]);

  useEffect(() => {
    if (!friendGhostRaceTarget || selectedTrack.id !== friendGhostRaceTarget.trackId) return;
    const expectsStraightSprint = friendGhostRaceTarget.sprintDistanceFeet != null
      && friendGhostRaceTarget.sprintAirSetting != null;
    if (friendGhostRaceTarget.routeVariantId && raceRouteVariantId !== friendGhostRaceTarget.routeVariantId) {
      setRaceRouteVariantId(friendGhostRaceTarget.routeVariantId);
      return;
    }
    if (lapCount !== friendGhostRaceTarget.lapCount) {
      setLapCount(friendGhostRaceTarget.lapCount);
      return;
    }
    if (
      expectsStraightSprint
      && (
        straightSprintDistanceFeet !== friendGhostRaceTarget.sprintDistanceFeet
        || straightSprintAirSetting !== friendGhostRaceTarget.sprintAirSetting
      )
    ) {
      setStraightSprintDistanceFeet(friendGhostRaceTarget.sprintDistanceFeet!);
      setStraightSprintAirSetting(friendGhostRaceTarget.sprintAirSetting!);
    }
  }, [
    friendGhostRaceTarget,
    lapCount,
    raceRouteVariantId,
    selectedTrack.id,
    straightSprintAirSetting,
    straightSprintDistanceFeet,
  ]);

  useEffect(() => {
    if (!friendGhostAutoSelectPendingRef.current || !friendGhostRaceTarget) return;
    const authorizedTarget = availableGhostLaps.find((ghost) => (
      ghost.id === friendGhostRaceTarget.id
      && ghost.ownerKey === `user:${friendGhostRaceTarget.profileId}`
      && ghost.source === 'friend'
    ));
    if (!authorizedTarget) return;
    setSelectedGhostIds([authorizedTarget.id]);
    friendGhostAutoSelectPendingRef.current = false;
  }, [availableGhostLaps, friendGhostRaceTarget]);

  useEffect(() => {
    if (isCustomRoutePreviewId(selectedTrack.id)) {
      return undefined;
    }

    let cancelled = false;
    if (clubTabletKioskMode && !clubTabletSessionActive) {
      setSelectedGhostIds([]);
      setGhostLaps([]);
      return undefined;
    }
    if (clubTabletSessionActive && clubTabletSession) {
      setSelectedGhostIds([]);
      setGhostLaps([]);
      void import('./lib/clubTablet').then(({ loadClubTabletGhosts }) => loadClubTabletGhosts(
        selectedTrack.id,
        raceWorkspaceMode === 'straight-sprint'
          ? { distanceFeet: straightSprintDistanceFeet, airSetting: straightSprintAirSetting }
          : undefined,
        clubTabletSession,
      )).then((values) => {
        if (cancelled) return;
        const scopedGhosts = values.flatMap((value) => {
          const ghost = sanitizeGhostLap(value);
          return ghost ? [{ ...ghost, ownerKey: clubTabletProfileKey }] : [];
        });
        setGhostLaps(scopedGhosts);
      }).catch((error: Error) => {
        if (!cancelled) console.warn(`Could not load this athlete's Club Tablet ghosts: ${error.message}`);
      });
      return () => { cancelled = true; };
    }

    if (!cloudProfileKey) return undefined;
    const friendKeys = friendGhostKeySignature
      ? friendGhostKeySignature.split(',').filter(Boolean)
      : [];
    const focusedFriendGhost = friendGhostRaceTarget?.trackId === selectedTrack.id
      ? { ghostId: friendGhostRaceTarget.id, profileId: friendGhostRaceTarget.profileId }
      : undefined;

    loadGhostLapsFromCloud(
      selectedTrack.id,
      cloudProfileKey,
      friendKeys,
      raceWorkspaceMode === 'straight-sprint'
        ? { distanceFeet: straightSprintDistanceFeet, airSetting: straightSprintAirSetting }
        : undefined,
      focusedFriendGhost,
    )
      .then((cloudGhosts) => {
        if (cancelled) return;

        // Friend and leaderboard ghosts are server-authorized snapshots. Drop
        // the previous snapshot before merging so an unfriend or block removes
        // access immediately instead of leaving a stale shared-device copy.
        setGhostLaps((current) => mergeGhostLaps(
          current.filter((ghost) => ghost.source === 'personal' && ghost.ownerKey === cloudProfileKey),
          cloudGhosts,
        ));
      })
      .catch((error: Error) => {
        console.warn(`Could not load TrackLab ghosts: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [
    cloudProfileKey,
    clubTabletProfileKey,
    clubTabletKioskMode,
    clubTabletSession?.sessionToken,
    clubTabletSessionActive,
    friendGhostKeySignature,
    friendGhostRaceTarget?.id,
    friendGhostRaceTarget?.profileId,
    friendGhostRaceTarget?.trackId,
    friendGraphRevision,
    raceWorkspaceMode,
    selectedTrack.id,
    straightSprintAirSetting,
    straightSprintDistanceFeet,
  ]);

  useEffect(() => {
    if (startGateStatus.active && raceState !== 'racing') {
      setGhostPlaybackMs(0);
      return undefined;
    }

    if (raceState === 'ready') {
      setGhostPlaybackMs(0);
      return undefined;
    }

    const continueFinishedStraightSprintGhost = (
      raceState === 'finished'
      && appMode === 'straight-sprint'
      && selectedGhostFinishMs > 0
    );

    if (raceState === 'finished' && !continueFinishedStraightSprintGhost) {
      setGhostPlaybackMs(selectedGhostFinishMs);
      return undefined;
    }

    if (raceState !== 'racing' && !continueFinishedStraightSprintGhost) {
      return undefined;
    }

    let frameId = 0;
    const tick = () => {
      const startedAt = ghostRaceStartedAtRef.current ?? raceCapture?.startedAt ?? Date.now();
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const playbackMs = continueFinishedStraightSprintGhost
        ? Math.min(elapsedMs, selectedGhostFinishMs)
        : elapsedMs;
      setGhostPlaybackMs(playbackMs);
      if (continueFinishedStraightSprintGhost && playbackMs >= selectedGhostFinishMs) {
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    tick();
    return () => window.cancelAnimationFrame(frameId);
  }, [
    appMode,
    raceCapture?.startedAt,
    raceState,
    selectedGhostFinishMs,
    startGateStatus.active,
  ]);

  useEffect(() => {
    if (
      !raceCapture
      || raceCapture.status !== 'racing'
      || raceState !== 'racing'
      || activeRaceSessionIdRef.current !== raceCapture.sessionId
    ) {
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
  }, [raceCapture, racePlayers, raceState, riders, samplesByDevice]);

  useEffect(() => {
    if (
      !raceCapture
      || raceCapture.status !== 'racing'
      || raceState !== 'racing'
      || activeRaceSessionIdRef.current !== raceCapture.sessionId
    ) {
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

      const capturedSummary = raceSummaryWithCapturedMetrics(current, raceSummary);
      const finalizedCapture: RaceCapture = {
        ...current,
        status: 'finished',
        endedAt: finishedAt,
        reactionTimesByPlayer,
        summary: capturedSummary,
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

      return {
        ...finalizedCapture,
        zoneResults: buildRaceZoneResults(finalizedCapture),
      };
    });
  }, [raceCapture, raceState, raceSummary, reactionTimesByPlayer]);

  useEffect(() => {
    if (demoMode || raceState !== 'finished' || !raceCapture || raceCapture.status !== 'finished') return;
    const sessionId = activeRaceSessionIdRef.current ?? raceCapture.sessionId;
    const startedAt = raceCapture.startedAt ?? raceCapture.createdAt;
    const endedAt = raceCapture.endedAt ?? Date.now();
    const accountRiderId = authUser ? `account:${authUser.id}` : null;
    const accountPlayer = accountRiderId
      ? racePlayers.find((player) => player.riderId === accountRiderId)
      : undefined;
    let zoneWindows: Array<{
      zoneId: string;
      zoneName?: string;
      startElapsedMs: number;
      endElapsedMs: number;
    }> = [];
    if (accountPlayer) {
      const samples = mapHeartRateMeasurementsToActiveClock(heartRate.measurements, [{
        startedAt,
        endedAt,
        activeElapsedAtStartMs: 0,
      }]);
      const durationMs = Math.max(0, endedAt - startedAt);
      const summary = summarizeHeartRate(samples, { startElapsedMs: 0, endElapsedMs: durationMs });
      zoneWindows = (raceCapture.zoneResults ?? []).flatMap((zone) => {
        const rider = zone.riders.find((candidate) => candidate.playerId === accountPlayer.id);
        return rider?.entryElapsedMs != null && rider.exitElapsedMs != null
          ? [{
            zoneId: zone.zoneId,
            zoneName: zone.zoneName,
            startElapsedMs: rider.entryElapsedMs,
            endElapsedMs: rider.exitElapsedMs,
          }]
          : [];
      });
      setRaceHeartRateByPlayer({
        [accountPlayer.id]: {
          source: 'apple-watch',
          samples,
          summary,
          zones: summarizeHeartRateZones(samples, zoneWindows),
        },
      });
    }
    void finalizeHeartRateRelay({
      sessionId,
      endedAt,
      activeDurationMs: Math.max(0, endedAt - startedAt),
      zones: zoneWindows,
    });
  }, [authUser, demoMode, finalizeHeartRateRelay, heartRate.measurements, raceCapture, racePlayers, raceState]);

  const saveClubOwnerRaceGroup = useCallback(async (
    capture: RaceCapture,
    entry: ClubOwnerTrainingCoordinatorEntry,
  ) => {
    if (capture.sessionId !== entry.request.sessionId || capture.startedAt == null) return;
    const coordinator = await import('./lib/clubOwnerTrainingCoordinator');
    return coordinator.saveClubOwnerRaceGroupFlow({
      entry,
      capture,
      title: entry.request.activityType === 'straight-sprint' && activeSprintDistanceFeet != null
        ? `${activeSprintDistanceFeet.toLocaleString()} ft sprint at ${effectiveTrack.name}`
        : `${effectiveTrack.name} BMX race`,
      lapCount: isLoopTrack ? lapCount : 1,
      routeVariantId: ghostRouteVariantId,
      ...(activeSprintDistanceFeet != null && activeSprintAirSetting != null
        ? { sprintDistanceFeet: activeSprintDistanceFeet, sprintAirSetting: activeSprintAirSetting }
        : {}),
      checkpointScope: clubOwnerTrainingCheckpointScopeRef.current,
      isCurrent: () => clubOwnerTrainingGroupRef.current === entry,
      onCheckpointCleared: () => { clubOwnerTrainingCheckpointScopeRef.current = null; },
      onHistoryChanged: () => setTrainingHistoryRevision((revision) => revision + 1),
      onStatus: (status) => setClubOwnerRacePreparation((current) => ({ ...current, ...status })),
    });
  }, [
    activeSprintAirSetting,
    activeSprintDistanceFeet,
    effectiveTrack.name,
    ghostRouteVariantId,
    isLoopTrack,
    lapCount,
  ]);

  useEffect(() => {
    if (!clubOwnerActive || authStatus !== 'signed-in' || !authUser?.profileKey || !ownedClub?.id) return undefined;
    const scope = authUser.profileKey;
    if (clubOwnerTrainingRecoveryScopeRef.current === scope || clubOwnerTrainingGroupRef.current) return undefined;
    clubOwnerTrainingRecoveryScopeRef.current = scope;
    let disposed = false;
    void import('./lib/clubOwnerTrainingCoordinator').then(async (coordinator) => {
      const recovered = await coordinator.recoverClubOwnerRaceCheckpoint({
        scope,
        clubId: ownedClub.id,
        capture: raceCapture,
      });
      if (!recovered) return;
      const { entry, playerIds } = recovered;
      if (disposed) {
        await coordinator.cancelClubOwnerTrainingGroup(entry, { keepalive: true });
        return;
      }
      if (!raceCapture || raceCapture.status !== 'finished') return;
      activeRaceSessionIdRef.current = raceCapture.sessionId;
      clubOwnerTrainingGroupRef.current = entry;
      clubOwnerTrainingCheckpointScopeRef.current = scope;
      clubOwnerTrainingAuthorizedPlayersRef.current.set(raceCapture.sessionId, new Set(playerIds));
      clubOwnerTrainingCompletionStartedRef.current.add(raceCapture.sessionId);
      setClubOwnerRacePreparation({
        phase: 'saving',
        sessionId: raceCapture.sessionId,
        playerIds,
        detail: 'Recovered club authorization. Finishing athlete save.',
      });
      await saveClubOwnerRaceGroup(raceCapture, entry);
    }).catch((error: unknown) => {
      if (!disposed) {
        setClubOwnerRacePreparation({
          phase: 'error',
          failureStage: 'complete',
          sessionId: raceCapture?.sessionId ?? null,
          playerIds: [],
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return () => {
      disposed = true;
    };
  }, [
    authStatus,
    authUser?.profileKey,
    clubOwnerActive,
    ownedClub?.id,
    raceCapture,
    saveClubOwnerRaceGroup,
  ]);

  useEffect(() => {
    if (raceState !== 'finished' || !raceCapture || raceCapture.status !== 'finished') return;
    const entry = clubOwnerTrainingGroupRef.current;
    if (!entry || entry.request.sessionId !== raceCapture.sessionId) return;
    if (clubOwnerTrainingCompletionStartedRef.current.has(raceCapture.sessionId)) return;
    clubOwnerTrainingCompletionStartedRef.current.add(raceCapture.sessionId);
    void saveClubOwnerRaceGroup(raceCapture, entry).catch(() => undefined);
  }, [raceCapture, raceState, saveClubOwnerRaceGroup]);

  useEffect(() => {
    if (
      raceState !== 'finished'
      || !raceCapture
      || raceCapture.status !== 'finished'
      || raceCapture.source !== 'live'
      || raceCapture.summary.length === 0
    ) {
      return;
    }

    const sessionId = activeRaceSessionIdRef.current ?? raceCapture.sessionId;
    if (!sessionId || ghostSavedSessionIdsRef.current.has(sessionId)) {
      return;
    }

    const tabletLocalPlayer = clubTabletSessionActive && clubTabletSession
      ? racePlayers.find((player) => player.riderId === clubTabletSession.session.studioRiderId)
      : undefined;
    if (clubTabletSessionActive && !tabletLocalPlayer) {
      console.warn('Club Tablet race result was not saved because the selected athlete could not be matched safely.');
      return;
    }
    const authorizedClubPlayerIds = clubOwnerTrainingAuthorizedPlayersRef.current.get(sessionId) ?? new Set<PlayerSlot['id']>();
    const capturedSummaries = (tabletLocalPlayer
      ? raceCapture.summary.filter((summary) => summary.playerId === tabletLocalPlayer.id)
      : raceCapture.summary)
      .filter((summary) => !authorizedClubPlayerIds.has(summary.playerId));
    if (capturedSummaries.length === 0 && authorizedClubPlayerIds.size > 0) {
      // The atomic club-group endpoint owns every result in this capture.
      // Mark the legacy owner path handled without creating duplicate history.
      ghostSavedSessionIdsRef.current.add(sessionId);
      return;
    }
    const ownerKey = clubTabletSessionActive ? clubTabletProfileKey : cloudProfileKey || 'local';
    const ownerName = clubTabletRider?.name ?? authUser?.name ?? multiplayer.profile.name ?? 'TrackLab rider';
    const savedAt = Date.now();
    const nextGhosts = capturedSummaries
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
          sprintDistanceFeet: activeSprintDistanceFeet,
          sprintAirSetting: activeSprintAirSetting,
          lapCount: isLoopTrack ? lapCount : 1,
          zoneResults: (raceCapture?.zoneResults ?? []).map((zone) => ({
            ...zone,
            riders: zone.riders.filter((result) => result.playerId === summary.playerId),
          })),
          ownerKey,
          ownerName,
          raceSource: 'live',
          player,
          savedAt,
        });
      })
      .filter((ghost): ghost is NonNullable<typeof ghost> => ghost != null);

    const persistence = legacyRacePersistencePlan(capturedSummaries.length, nextGhosts.length);
    if (!persistence.saveHistory) {
      ghostSavedSessionIdsRef.current.add(sessionId);
      return;
    }

    ghostSavedSessionIdsRef.current.add(sessionId);
    if (persistence.saveGhosts) {
      setGhostLaps((current) => mergeGhostLaps(current, nextGhosts));
    }
    const raceResultSummaries = capturedSummaries.map((summary) => {
          const photoUrl = racePlayers.find((player) => player.id === summary.playerId)?.photoUrl;
          return {
            ...summary,
            ...(photoUrl ? { photoUrl } : {}),
            ...(activeSprintDistanceFeet != null && activeSprintAirSetting != null ? {
              sprintDistanceFeet: activeSprintDistanceFeet,
              sprintAirSetting: activeSprintAirSetting,
            } : {}),
          };
        });
    const raceResultSave = tabletLocalPlayer
      ? import('./lib/clubTablet').then(({ saveClubTabletRaceResult }) => saveClubTabletRaceResult({
        sessionId,
        trackId: effectiveTrack.id,
        trackName: effectiveTrack.name,
        summaries: raceResultSummaries,
        localPlayerId: tabletLocalPlayer.id,
      }, clubTabletSession))
      : fetch('/api/race-results', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          trackId: effectiveTrack.id,
          trackName: effectiveTrack.name,
          summaries: raceResultSummaries,
        }),
      }).then((response) => {
        if (!response.ok) throw new Error(`Race history service returned ${response.status}`);
      });
    void raceResultSave.catch((error: Error) => {
      console.warn(`Could not save TrackLab race history: ${error.message}`);
    });
    const trainingStartedAt = raceCapture.startedAt ?? raceCapture.createdAt;
    const trainingEndedAt = raceCapture.endedAt ?? savedAt;
    const trainingSummaries = capturedSummaries.map((summary) => {
      const player = racePlayers.find((candidate) => candidate.id === summary.playerId);
      const photoUrl = player?.photoUrl;
      return {
        ...summary,
        ...(player?.riderId ? { riderId: player.riderId } : {}),
        ...(photoUrl ? { photoUrl } : {}),
      };
    });
    void import('./lib/trainingHistory').then(({ saveTrainingSession }) => saveTrainingSession({
      id: sessionId,
      activityType: appMode === 'straight-sprint' ? 'straight-sprint' : 'bmx-race',
      title: appMode === 'straight-sprint' && activeSprintDistanceFeet != null
        ? `${activeSprintDistanceFeet.toLocaleString()} ft sprint at ${effectiveTrack.name}`
        : `${effectiveTrack.name} BMX race`,
      startedAt: trainingStartedAt,
      endedAt: trainingEndedAt,
      durationMs: Math.max(0, trainingEndedAt - trainingStartedAt),
      distanceMeters: Math.max(0, ...capturedSummaries.map((summary) => summary.distanceMeters)),
      trackId: effectiveTrack.id,
      trackName: effectiveTrack.name,
      details: {
        summaries: trainingSummaries,
        zoneResults: (raceCapture.zoneResults ?? []).map((zone) => ({
          ...zone,
          riders: zone.riders.filter((rider) => !authorizedClubPlayerIds.has(rider.playerId)),
        })),
        reactionTimesByPlayer: Object.fromEntries(Object.entries(raceCapture.reactionTimesByPlayer)
          .filter(([playerId]) => !authorizedClubPlayerIds.has(Number(playerId) as PlayerSlot['id']))),
        events: authorizedClubPlayerIds.size > 0 ? [] : raceCapture.events,
        selectedMetrics: raceCapture.selectedMetrics,
        lapCount: isLoopTrack ? lapCount : 1,
        routeVariantId: ghostRouteVariantId,
        ...(activeSprintDistanceFeet != null && activeSprintAirSetting != null ? {
          sprintDistanceFeet: activeSprintDistanceFeet,
          sprintAirSetting: activeSprintAirSetting,
        } : {}),
      },
    }, clubTrainingSelection, {
      localPlayerId: tabletLocalPlayer?.id ?? null,
    })).then(() => {
      setTrainingHistoryRevision((revision) => revision + 1);
    }).catch((error: Error) => {
      console.warn(`Could not save TrackLab training session: ${error.message}`);
    });
    nextGhosts.forEach((ghost) => {
      const ghostSave = tabletLocalPlayer
        ? import('./lib/clubTablet').then(({ saveClubTabletGhost }) => (
          saveClubTabletGhost(ghost, tabletLocalPlayer.id, clubTabletSession)
        ))
        : syncGhostLapToCloud(ghost, ownerKey);
      void ghostSave.catch((error: Error) => {
        console.warn(`Could not sync TrackLab ghost: ${error.message}`);
      });
    });
  }, [
    authUser?.name,
    activeSprintAirSetting,
    activeSprintDistanceFeet,
    cloudProfileKey,
    appMode,
    clubTrainingSelection,
    clubTabletProfileKey,
    clubTabletRider?.name,
    clubTabletSession,
    clubTabletSessionActive,
    effectiveTrack.id,
    effectiveTrack.name,
    ghostRouteVariantId,
    isLoopTrack,
    lapCount,
    multiplayer.profile.name,
    raceCapture,
    racePlayers,
    raceState,
    riders,
  ]);

  useEffect(() => {
    if (startGateStatus.active || raceState !== 'ready') {
      return;
    }

    resetRace();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, [
    effectiveTrack.activeRouteVariantId,
    effectiveTrack.id,
    mappedZones,
    raceState,
    resetRace,
    startGateStatus.active,
    straightSprintAirSetting,
    straightSprintDistanceFeet,
  ]);

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

  const renameDemoPlayer = useCallback((playerId: PlayerSlot['id'], name: string) => {
    const safeName = normalizeBikeName(name);
    if (!safeName) {
      return;
    }

    const nextNames = {
      ...raceViewPreferencesRef.current.demoRiderNames,
      [playerId]: safeName,
    };
    setDemoRiderNames(nextNames);
    persistRaceViewPreferences({
      ...raceViewPreferencesRef.current,
      demoRiderNames: nextNames,
      demoRiderNamesUpdatedAt: Date.now(),
    });
  }, [persistRaceViewPreferences]);

  const handleDemoRiderPhotoChange = useCallback((
    playerId: PlayerSlot['id'],
    photoUrl: string | undefined,
  ) => {
    setLockedRacePlayers(null);
    const nextPhotos = { ...raceViewPreferencesRef.current.demoRiderPhotos };
    if (photoUrl) {
      nextPhotos[playerId] = photoUrl;
    } else {
      delete nextPhotos[playerId];
    }
    setDemoRiderPhotos(nextPhotos);
    persistRaceViewPreferences({
      ...raceViewPreferencesRef.current,
      demoRiderPhotos: nextPhotos,
      demoRiderPhotosUpdatedAt: Date.now(),
    });
  }, [persistRaceViewPreferences]);

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
            name: deviceId == null ? defaultBikeName(nextDeviceId) : profile.name,
            colorName: visual.colorName,
            accent: visual.accent,
            updatedAt: Date.now(),
          }
          : profile
      ));

      return next.some((profile) => profile.deviceId === nextDeviceId)
        ? dedupeBikeProfiles(next)
        : dedupeBikeProfiles([...next, createBikeProfile(nextDeviceId, playerId - 1)]);
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
        persistRaceViewPreferences({
          ...raceViewPreferencesRef.current,
          earthCamerasByTrack: next,
        });
        return next;
      });
    }
  }, [persistRaceViewPreferences]);

  const handleCountryChange = (country: string) => {
    const nextState = statesForCountry(country, baseCatalogTracks)[0];
    const nextTrack = tracksForLocation(country, nextState, baseCatalogTracks)[0];
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
    const nextTrack = tracksForLocation(selectedCountry, state, baseCatalogTracks)[0];
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

  const handleRaceFriendGhost = (profile: FriendProfile) => {
    const preview = profile.ghostPreview;
    if (!preview) return;
    const nextTrack = persistentCatalogTracks.find((track) => track.id === preview.trackId);
    if (!nextTrack) {
      return `${preview.trackName} is not available in this TrackLab catalog yet.`;
    }

    const isStraightSprint = preview.sprintDistanceFeet != null && preview.sprintAirSetting != null;
    friendGhostAutoSelectPendingRef.current = true;
    setFriendGhostRaceTarget({ ...preview, profileId: profile.id });
    setSelectedGhostIds([]);
    discardCustomRoutePreview();
    prepareForTrackSelection(nextTrack.id);
    setMappingMode(false);
    setAppMode(isStraightSprint ? 'straight-sprint' : 'race');
    setSelectedCountry(nextTrack.country);
    setSelectedState(nextTrack.state);
    setSelectedTrackId(nextTrack.id);
    if (preview.routeVariantId) setRaceRouteVariantId(preview.routeVariantId);
    setLapCount(preview.lapCount);
    if (isStraightSprint) {
      setStraightSprintDistanceFeet(preview.sprintDistanceFeet!);
      setStraightSprintAirSetting(preview.sprintAirSetting!);
    }
    setFriendGraphRevision((current) => current + 1);
    return undefined;
  };

  const openBmxRaceIntervals = () => {
    setMappingMode(false);
    setAppMode('race');

    if (selectedTrack.countryCode === 'CUSTOM' || isCustomRoutePreviewId(selectedTrack.id)) {
      const nextTrack = baseCatalogTracks.find((track) => track.id === lastBmxTrackIdRef.current)
        ?? baseCatalogTracks[0]
        ?? defaultTrack;
      handleTrackChange(nextTrack.id);
    }
  };

  const openStraightSprint = () => {
    setMappingMode(false);
    setAppMode('straight-sprint');
    setCustomRouteStatus((current) => current ?? 'Create a custom location or choose a saved sprint route.');

    if (selectedTrack.countryCode !== 'CUSTOM') {
      const nextTrack = availableCustomRoutes.find((track) => track.id === lastStraightSprintTrackIdRef.current)
        ?? availableCustomRoutes[0];
      if (nextTrack) {
        handleTrackChange(nextTrack.id);
      }
    }

    window.setTimeout(() => {
      document.getElementById('custom-route-location-input')?.focus();
    }, 80);
  };

  const openGetPulled = () => {
    setMappingMode(false);
    setAppMode('get-pulled');
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
        persistRaceViewPreferences({
          ...raceViewPreferencesRef.current,
          earthCamerasByTrack: next,
        });
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
      persistRaceViewPreferences({
        ...raceViewPreferencesRef.current,
        earthCamerasByTrack: next,
      });
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
    if (!mappingMode || mappingEditMode !== 'zones') {
      setMappingObstacleView3D(false);
    }
  }, [mappingEditMode, mappingMode]);

  useEffect(() => {
    setMappingRouteVariantId('amateur');
    setRaceRouteVariantId('amateur');
    setMappingEditMode('navigate');
    setMappingMode(false);
    setMappingFullscreen(false);
    clearMappingHistory();
  }, [clearMappingHistory, selectedTrack.id]);

  useEffect(() => {
    if (developerUiActive) {
      return;
    }
    setMappingMode(false);
    setMappingFullscreen(false);
    setMappingObstacleView3D(false);
  }, [developerUiActive]);

  useEffect(() => {
    setDraftPoints(activeMappingRoute?.centerline ?? []);
    setDraftZoneBoundarySets(activeMappingRoute ? zoneBoundarySetsFromRouteVariant(activeMappingRoute) : []);
    setDraftSplitSections(activeMappingRoute?.splitSections ?? []);
    setDraftSplitBuilder(null);
    setMappingRestSeconds(activeMappingRoute?.restAfterSeconds ?? 1);
    clearMappingHistory();
  }, [activeMappingRoute, clearMappingHistory]);

  useEffect(() => {
    setMappingRaceViewMode(
      selectedTrackMapping?.raceViewMode === '3d' ? '3d' : 'satellite',
    );
  }, [selectedTrack.id, selectedTrackMapping?.raceViewMode]);

  const handleMappingModeChange = (enabled: boolean) => {
    if (enabled && !developerUiActive) {
      return;
    }

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
      if (routeIsClosedLoop(current)) {
        return current;
      }

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

      if (
        current.length >= 3
        && distanceBetweenTrackPoints(point, current[0]) <= loopRouteSnapMeters
      ) {
        return appendOrReplacePoint(current, current[0]);
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
    const zoneAnchors = captureZoneBoundaryAnchors(draftPoints, draftRouteSplitSections, draftZoneBoundarySets);
    rememberMappingEdit('route');
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const wasClosedLoop = routeIsClosedLoop(current);
      const isStartPoint = index === 0;
      const isFinishPoint = index === current.length - 1;
      const movedPoint = isFinishPoint
        && current.length >= 3
        && distanceBetweenTrackPoints(point, current[0]) <= loopRouteSnapMeters
        ? current[0]
        : snappedPoint.point;
      const next = current.map((draftPoint, draftIndex) => {
        if (draftIndex === index) {
          return movedPoint;
        }
        if (wasClosedLoop && isStartPoint && draftIndex === current.length - 1) {
          return movedPoint;
        }
        return draftPoint;
      });
      setDraftZoneBoundarySets((currentZones) => {
        const nextZones = zoneAnchors.length > 0
          ? reprojectZoneBoundaryAnchors(next, draftRouteSplitSections, zoneAnchors)
          : currentZones;

        return normalizeDraftZoneBoundarySetsForRoute(next, draftRouteSplitSections, nextZones);
      });
      return next;
    });
  }, [draftPoints, draftRouteSplitSections, draftZoneBoundarySets, normalizeDraftZoneBoundarySetsForRoute, rememberMappingEdit, snapDraftPointToSplitJunction]);

  const handleMappingPathPointRemove = useCallback((index: number) => {
    if (index < 0 || index >= draftPoints.length) {
      return;
    }

    rememberMappingEdit('route');
    const zoneAnchors = captureZoneBoundaryAnchors(draftPoints, draftRouteSplitSections, draftZoneBoundarySets);
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.filter((_, draftIndex) => draftIndex !== index);
      setDraftZoneBoundarySets((currentZones) => {
        const nextZones = zoneAnchors.length > 0
          ? reprojectZoneBoundaryAnchors(next, draftRouteSplitSections, zoneAnchors)
          : currentZones;

        return normalizeDraftZoneBoundarySetsForRoute(next, draftRouteSplitSections, nextZones);
      });
      return next;
    });
  }, [draftPoints, draftRouteSplitSections, draftZoneBoundarySets, normalizeDraftZoneBoundarySetsForRoute, rememberMappingEdit]);

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
    setPreservedZoneAnchorSets([]);
    setDraftPoints([]);
    setDraftZoneBoundarySets([]);
    setDraftSplitSections([]);
    setDraftSplitBuilder(null);
    clearMappingHistory();
  };

  const redrawMappingRoute = useCallback(() => {
    if (draftPoints.length < 2) {
      return;
    }

    rememberMappingEdit('route');
    setPreservedZoneAnchorSets(captureZoneBoundaryAnchors(
      draftPoints,
      draftRouteSplitSections,
      draftZoneBoundarySets,
    ));
    setDraftPoints([]);
    setDraftSplitBuilder(null);
    setMappingMode(true);
    setMappingEditMode('curve');
  }, [draftPoints, draftRouteSplitSections, draftZoneBoundarySets, rememberMappingEdit]);

  const clearMappingZones = useCallback(() => {
    if (!draftZoneBoundarySets.some((set) => set.boundaryMeters.length > 0)) {
      return;
    }

    rememberMappingEdit('zones');
    setPreservedZoneAnchorSets([]);
    setDraftZoneBoundarySets([]);
  }, [draftZoneBoundarySets, rememberMappingEdit]);

  const updateMappingRestSeconds = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.min(30, Number.isFinite(seconds) ? seconds : 0));
    setMappingRestSeconds(safeSeconds);
  };

  const persistTrackMapping = async (mapping: UserTrackMapping) => {
    if (!authUser || !adminProfileActive) {
      setMappingSaveStatus('error');
      setMappingSaveMessage('Only the TrackLab developer can edit and publish track maps.');
      return;
    }

    setMappingSaveStatus('saving');
    setMappingSaveMessage('Saving this track map to your account.');
    try {
      const saved = await saveCloudTrackMapping(mapping, selectedTrack);
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
    if (!adminProfileActive || draftPoints.length < 2) {
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
      mappingRaceViewMode,
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
    setPreservedZoneAnchorSets([]);
    setRaceRouteVariantId(mappingRouteVariantId);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const removeMapping = () => {
    if (!adminProfileActive) {
      return;
    }

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
    setMappingRaceViewMode('satellite');
    setPreservedZoneAnchorSets([]);
    clearMappingHistory();
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const exportMapping = () => {
    if (adminProfileActive && selectedTrackMapping) {
      downloadTrackMapping(selectedTrackMapping);
    }
  };

  const importMapping = (file: File) => {
    if (!adminProfileActive) {
      return;
    }

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
        setPreservedZoneAnchorSets([]);
        clearMappingHistory();
        setMappingRestSeconds(importedRoute.restAfterSeconds);
        setMappingRaceViewMode(
          mapping.raceViewMode === '3d' ? '3d' : 'satellite',
        );
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

  const exportRaceCaptureJson = async () => {
    const capture = acceptedRaceCapture(raceCapture);
    if (!capture) {
      return;
    }
    const { redactPrivatePower } = await import('./lib/privatePower');

    downloadTextFile(
      raceCaptureFilename(capture, 'json'),
      JSON.stringify(redactPrivatePower(capture), null, 2),
      'application/json',
    );
  };

  const exportRaceCaptureCsv = () => {
    const capture = acceptedRaceCapture(raceCapture);
    if (!capture) {
      return;
    }

    downloadTextFile(
      raceCaptureFilename(capture, 'csv'),
      raceCaptureToCsv(capture),
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

    let nextZoneMeters = draftZoneProRange
      ? appendProSetZoneBoundaryMeter(draftZoneMeters, meter, draftZoneRouteLengthMeters)
      : draftZoneMeters;
    if (!draftZoneProRange) {
      const existingBoundaryIndex = draftZoneMeters.findIndex((boundary) => (
        Math.abs(boundary - meter) < zoneBoundaryDuplicateMeters
      ));
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
    }

    if (numbersMatch(draftZoneMeters, nextZoneMeters)) {
      return;
    }

    rememberMappingEdit('zones');
    updateCurrentDraftZoneMeters(nextZoneMeters);
  }, [draftZoneMeters, draftZoneProRange, draftZoneRidePoints, draftZoneRouteLengthMeters, rememberMappingEdit, updateCurrentDraftZoneMeters]);

  const handleMappingProZoneEndpointAdd = useCallback((endpoint: 'split' | 'merge') => {
    if (!draftZoneProRange || draftZoneRidePoints.length < 2) {
      return;
    }

    const point = endpoint === 'split'
      ? draftZoneRidePoints[0]
      : draftZoneRidePoints[draftZoneRidePoints.length - 1];
    handleMappingZonePointAdd(point);
  }, [draftZoneProRange, draftZoneRidePoints, handleMappingZonePointAdd]);

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

  const removeMappingZone = useCallback((index: number) => {
    if (index < 0) {
      return;
    }

    const nextZoneMeters = draftZoneMeters.filter((_, boundaryIndex) => (
      boundaryIndex !== index * 2 && boundaryIndex !== index * 2 + 1
    ));
    if (numbersMatch(draftZoneMeters, nextZoneMeters)) {
      return;
    }

    rememberMappingEdit('zones');
    updateCurrentDraftZoneMeters(nextZoneMeters);
  }, [draftZoneMeters, rememberMappingEdit, updateCurrentDraftZoneMeters]);

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

  const handleStudioRiderAssignment = useCallback((deviceId: number, riderId: string | null) => {
    if (startGateStatus.active || raceState === 'racing') {
      return;
    }
    if (clubTabletSessionActive && clubTabletSession) {
      if (deviceId !== clubTabletSession.session.bikeDeviceId || riderId !== clubTabletSession.session.studioRiderId) return;
    }

    setLockedRacePlayers(null);
    setStudioRiderAssignments((current) => assignStudioRider(current, deviceId, riderId));
  }, [clubTabletSession, clubTabletSessionActive, raceState, startGateStatus.active]);

  const handleStudioRiderAdd = useCallback((name: string) => {
    if (!canManageActiveStudioRiders) {
      return false;
    }
    const rider = createStudioRider(name);
    if (!rider) {
      return false;
    }

    setStudioRiders((current) => mergeStudioRiders(current, [rider]));
    return true;
  }, [canManageActiveStudioRiders]);

  const handleStudioRiderRename = useCallback((riderId: string, name: string) => {
    if (!canManageActiveStudioRiders) {
      return;
    }
    setStudioRiders((current) => mergeStudioRiders(current.map((rider) => (
      rider.id === riderId ? renameStudioRider(rider, name) : rider
    ))));
  }, [canManageActiveStudioRiders]);

  const handleStudioRiderPhotoChange = useCallback((
    riderId: string,
    photoUrl: string | undefined,
  ) => {
    if (!canManageActiveStudioRiders) {
      return;
    }
    setLockedRacePlayers(null);
    setStudioRiders((current) => mergeStudioRiders(current.map((rider) => (
      rider.id === riderId ? updateStudioRiderPhoto(rider, photoUrl) : rider
    ))));
  }, [canManageActiveStudioRiders]);

  const handleAccountPhotoChange = useCallback((photoUrl: string | undefined) => {
    const normalizedPhotoUrl = normalizeRiderPhotoDataUrl(photoUrl);
    const nextProfile: AccountProfile = {
      ...(normalizedPhotoUrl ? { photoUrl: normalizedPhotoUrl } : {}),
      updatedAt: Date.now(),
    };
    setLockedRacePlayers(null);
    setAccountProfile(nextProfile);
    if (cloudProfileKey) {
      void queueCloudUserDataPatch(cloudProfileKey, { accountProfile: nextProfile })
        .then(() => {
          setCloudUserDataStatus('online');
          setCloudUserDataMessage('Your account photo is saved across devices.');
        })
        .catch((error: Error) => {
          setCloudUserDataStatus('offline');
          setCloudUserDataMessage(`Could not save your account photo. ${error.message}`);
        });
    }
  }, [cloudProfileKey]);

  const handleClubProfileComplete = useCallback((user: AuthUser, profile: AccountProfile) => {
    setAuthUser(user);
    setProfileNameDraft(user.name);
    setProfileEmailDraft(user.email);
    setMembership(user.membership);
    setCheckoutBikeSeats(user.membership.bikeSeats);
    setAccountProfile(profile);
    setLockedRacePlayers(null);
    setCloudUserDataStatus('online');
    setCloudUserDataMessage('Your Club Athlete name and photo are saved across devices.');
    window.setTimeout(() => {
      void refreshClubTrainingMemberships();
    }, 0);
  }, [refreshClubTrainingMemberships]);

  const handleStudioRiderRemove = useCallback((riderId: string) => {
    if (!canManageActiveStudioRiders) {
      return;
    }
    setLockedRacePlayers(null);
    setStudioRiders((current) => mergeStudioRiders(current.map((rider) => (
      rider.id === riderId ? removeStudioRider(rider) : rider
    ))));
    setStudioRiderAssignments((current) => {
      const next = { ...current };
      Object.entries(next).forEach(([deviceId, assignedRiderId]) => {
        if (assignedRiderId === riderId) {
          delete next[Number(deviceId)];
        }
      });
      return next;
    });
  }, [canManageActiveStudioRiders]);

  const handleMappingRouteVariantChange = useCallback((variantId: RaceRouteVariantId) => {
    setMappingRouteVariantId(variantId);
    setMappingZoneBranchChoice(variantId === 'pro' ? 'b' : 'a');
    setMappingEditMode('navigate');
  }, []);

  const handleMappingEditModeChange = useCallback((mode: MappingEditMode) => {
    setMappingEditMode(mode);
    if (mode === 'zones' && mappingRouteVariantId === 'pro' && draftRouteSplitSections.length > 0) {
      setMappingZoneBranchChoice('b');
    }
  }, [draftRouteSplitSections.length, mappingRouteVariantId]);

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
      const accountPreferencesAreHydrated = authStatus !== 'loading'
        && (!authUser || cloudUserDataLoadedKeyRef.current === cloudProfileKey);
      if (!accountPreferencesAreHydrated) {
        return current;
      }

      if (!cameraIsOnSelectedTrack) {
        return current;
      }

      if (earthCamerasMatch(current[raceCameraPreferenceKey], safeCamera)) {
        return current;
      }

      const next = {
        ...current,
        [raceCameraPreferenceKey]: safeCamera,
      };
      persistRaceViewPreferences({
        ...raceViewPreferencesRef.current,
        earthCamerasByTrack: next,
      });
      return next;
    });
  }, [
    authStatus,
    authUser,
    cloudProfileKey,
    earthAngle,
    earthCenter,
    earthHeading,
    earthZoom,
    effectiveTrack,
    persistRaceViewPreferences,
    raceCameraPreferenceKey,
  ]);

  const handleEarthAngleChange = useCallback((angle: number) => {
    handleEarthCameraChange({ angle });
  }, [handleEarthCameraChange]);

  const handleEarthHeadingChange = useCallback((heading: number) => {
    handleEarthCameraChange({ heading });
  }, [handleEarthCameraChange]);

  const handleRaceCameraLockedChange = useCallback((locked: boolean) => {
    if (!developerRaceLayoutActive) {
      return;
    }
    setRaceCameraLocked(locked);
    const nextPreferences = normalizeRaceViewPreferences({
      ...raceViewPreferencesRef.current,
      cameraLocked: locked,
      cameraLockedUpdatedAt: Date.now(),
    });
    persistRaceViewPreferences(nextPreferences);
    if (locked && Object.keys(nextPreferences.earthCamerasByTrack).length > 0) {
      void saveGlobalRaceViewPreferences(nextPreferences)
        .then((savedGlobalPreferences) => {
          const globallyLockedPreferences = applyGlobalRaceViewPreferences(
            raceViewPreferencesRef.current,
            savedGlobalPreferences,
          );
          applyRaceViewPreferences(globallyLockedPreferences);
          writeStoredRaceViewPreferences(cloudProfileKey, globallyLockedPreferences);
        })
        .catch((error: Error) => {
          console.warn(`Could not publish the locked race view globally: ${error.message}`);
        });
    }
  }, [
    applyRaceViewPreferences,
    cloudProfileKey,
    developerRaceLayoutActive,
    persistRaceViewPreferences,
  ]);

  const handleRiderOverlayPreferenceChange = useCallback((trackId: string, layout: RaceRiderOverlayLayout) => {
    if (!developerRaceLayoutActive) {
      return;
    }
    setRiderOverlaysByTrack((current) => {
      const updatedAt = Date.now();
      const next = {
        ...current,
        [trackId]: layout,
      };
      persistRaceViewPreferences({
        ...raceViewPreferencesRef.current,
        riderOverlaysByTrack: next,
        riderOverlayUpdatedAtByTrack: {
          ...raceViewPreferencesRef.current.riderOverlayUpdatedAtByTrack,
          [trackId]: updatedAt,
        },
      });
      return next;
    });
  }, [developerRaceLayoutActive, persistRaceViewPreferences]);

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

  const loadCStartPlayers = useCallback((playerIds: PlayerId[]) => {
    if (playerIds.length === 0) {
      return;
    }

    const next = { ...cStartOffsetsByPlayerRef.current };
    playerIds.forEach((playerId) => {
      next[playerId] = bmxCStartBackoffMeters;
    });
    cStartOffsetsByPlayerRef.current = next;
    setCStartOffsetsByPlayer(next);
  }, []);

  const releaseCStartPlayers = useCallback((playerIds?: PlayerId[]) => {
    const targetPlayerIds = playerIds ?? racePlayers.map((player) => player.id);
    const startingOffsets = new Map(targetPlayerIds.map((playerId) => [
      playerId,
      cStartOffsetsByPlayerRef.current[playerId] ?? 0,
    ]));
    if (![...startingOffsets.values()].some((offset) => offset > 0)) {
      return;
    }

    const frameCount = 6;
    for (let frame = 1; frame <= frameCount; frame += 1) {
      scheduleStartGateStep((bmxCStartReleaseMs / frameCount) * frame, () => {
        const progress = frame / frameCount;
        const easedProgress = progress * progress * (3 - 2 * progress);
        const next = { ...cStartOffsetsByPlayerRef.current };
        targetPlayerIds.forEach((playerId) => {
          const startingOffset = startingOffsets.get(playerId) ?? 0;
          const nextOffset = startingOffset * (1 - easedProgress);
          if (nextOffset <= 0.0001) {
            delete next[playerId];
          } else {
            next[playerId] = nextOffset;
          }
        });
        cStartOffsetsByPlayerRef.current = next;
        setCStartOffsetsByPlayer(next);
      });
    }
  }, [racePlayers, scheduleStartGateStep]);

  const armReactionTimer = useCallback((armedAt = Date.now()) => {
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
    const inputAllowedAt = redLightAtRef.current || gateDropAt;
    cadenceStartedAtRef.current = 0;
    falseStartActiveRef.current = false;
    ghostRaceStartedAtRef.current = gateDropAt;
    ghostTraceRef.current = new Map();
    ghostTraceLastSampleAtRef.current = new Map();
    const personalBestOwnerKey = clubTabletSessionActive ? clubTabletProfileKey : cloudProfileKey;
    setPreviousRaceBestTimes(demoMode
      ? {}
      : previousPersonalBestTimes(racePlayers, eventGhostLaps, personalBestOwnerKey));
    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 104729);
      setDemoRaceStartedAt(gateDropAt);
    }

    setStartGateStatus({
      active: true,
      phase: 'go',
      label: 'GO',
      detail: 'Gate open',
      lightIndex: 3,
    });
    if (!demoMode) {
      bridge.sendControlCommand('race-start');
    }

    appendRaceCaptureEvent('race-start', 'Gate drop / race started', gateDropAt);
    const clubGroup = clubOwnerTrainingGroupRef.current;
    if (clubGroup && clubGroup.request.sessionId === activeRaceSessionIdRef.current) {
      void import('./lib/clubOwnerTrainingCoordinator')
        .then(({ activateAndCheckpointClubOwnerTrainingGroup }) => (
          activateAndCheckpointClubOwnerTrainingGroup(
            clubGroup,
            gateDropAt,
            clubOwnerTrainingCheckpointScopeRef.current,
          )
        ))
        .catch((error: unknown) => {
          if (clubOwnerTrainingGroupRef.current !== clubGroup) return;
          setClubOwnerRacePreparation((current) => ({
            ...current,
            phase: 'error',
            failureStage: 'activate',
            detail: error instanceof Error ? error.message : String(error),
          }));
        });
    }
    const heartRatePlayer = authUser
      ? racePlayers.find((player) => player.riderId === `account:${authUser.id}`)
      : undefined;
    const heartRateSessionId = activeRaceSessionIdRef.current;
    if (!demoMode && heartRatePlayer && heartRateSessionId) {
      void beginHeartRateRelay({
        sessionId: heartRateSessionId,
        activityType: appMode === 'straight-sprint' ? 'straight-sprint' : 'bmx-race',
        riderId: heartRatePlayer.riderId,
        playerId: heartRatePlayer.id,
        startedAt: gateDropAt,
      });
    }
    releaseCStartPlayers();
    startRace(gateDropAt, inputAllowedAt);
    scheduleStartGateStep(420, () => {
      redLightAtRef.current = 0;
      setStartGateStatus(idleStartGateStatus);
    });
  }, [appMode, appendRaceCaptureEvent, authUser, beginHeartRateRelay, bridge, cloudProfileKey, clubTabletProfileKey, clubTabletSessionActive, demoMode, eventGhostLaps, racePlayers, releaseCStartPlayers, scheduleStartGateStep, startRace]);

  const startConfiguredCadence = useCallback(async (startingTrackId: string, sequenceId: number) => {
    if (
      sequenceId !== startGateSequenceIdRef.current
      || selectedTrackIdRef.current !== startingTrackId
    ) {
      return;
    }

    stagingCountdownEndsAtRef.current = 0;
    stagingCountdownRemainingMsRef.current = 0;
    stagingCountdownTrackIdRef.current = null;
    setStartCountdownPaused(false);

    setStartGateStatus({
      active: true,
      phase: 'cadence',
      label: 'UCI CADENCE',
      detail: 'Starting random cadence audio',
      lightIndex: null,
    });

    void primeAudioCues().catch(() => undefined);

    const voiceStart = await playUciRandomStartVoice().catch(() => {
      playStartGateTone('tick');
      return {
        startedAt: Date.now(),
        source: 'fallback' as const,
      };
    });
    if (sequenceId !== startGateSequenceIdRef.current || selectedTrackIdRef.current !== startingTrackId) {
      return;
    }

    cadenceStartedAtRef.current = voiceStart.startedAt;
    const randomDelayMs = randomIntegerInclusive(uciRandomDelayMinMs, uciRandomDelayMaxMs);
    const firstToneAtMs = uciVoiceWatchGateOffsetMs + randomDelayMs;
    const scheduleVoiceStep = (voiceOffsetMs: number, action: () => void) => {
      const elapsedSinceVoiceStartMs = Date.now() - voiceStart.startedAt;
      scheduleStartGateStep(Math.max(0, voiceOffsetMs - elapsedSinceVoiceStartMs), action, sequenceId);
    };

    setStartGateStatus({
      active: true,
      phase: 'cadence',
      label: 'OK RIDERS',
      detail: voiceStart.source === 'audio' ? 'UCI random start voice' : 'Fallback start tone',
      lightIndex: null,
    });

    scheduleVoiceStep(3300, () => {
      setStartGateStatus({
        active: true,
        phase: 'cadence',
        label: 'RIDERS READY',
        detail: 'Watch the gate',
        lightIndex: null,
      });
    });

    scheduleVoiceStep(uciVoiceWatchGateOffsetMs, () => {
      setStartGateStatus({
        active: true,
        phase: 'cadence',
        label: 'RANDOM DELAY',
        detail: 'Watch the gate',
        lightIndex: null,
      });
    });

    const runCadenceTone = (index: 0 | 1 | 2) => {
      if (index === 0) {
        const redLightAt = Date.now();
        redLightAtRef.current = redLightAt;
        armReactionTimer(redLightAt);
      }
      if (index === 2 && demoMode) {
        const demoPlayerIds = racePlayers.map((player) => player.id);
        cStartTriggeredPlayerIdsRef.current = new Set(demoPlayerIds);
        loadCStartPlayers(demoPlayerIds);
      }

      setStartGateStatus({
        active: true,
        phase: 'cadence',
        label: startTreeLabels[index],
        detail: 'UCI cadence',
        lightIndex: index,
      });
      playStartGateTone('uci-red');

      // Chain each UCI step from the moment the previous one actually rendered.
      // Independent absolute timers can collapse into one burst when a busy map
      // delays the browser event loop, especially on tablets.
      scheduleStartGateStep(uciStartToneIntervalMs, () => {
        if (index < 2) {
          runCadenceTone((index + 1) as 1 | 2);
          return;
        }
        playStartGateTone('uci-green');
        beginRaceAtGateDrop(startingTrackId, sequenceId);
      }, sequenceId);
    };

    scheduleVoiceStep(firstToneAtMs, () => runCadenceTone(0));
  }, [armReactionTimer, beginRaceAtGateDrop, demoMode, loadCStartPlayers, racePlayers, scheduleStartGateStep]);

  const scheduleStagingCountdown = useCallback((
    startingTrackId: string,
    sequenceId: number,
    durationMs = liveRaceStagingSeconds * 1000,
  ) => {
    if (
      sequenceId !== startGateSequenceIdRef.current
      || selectedTrackIdRef.current !== startingTrackId
    ) {
      return;
    }

    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    const secondsRemaining = Math.max(1, Math.ceil(durationMs / 1000));
    const normalizedDurationMs = secondsRemaining * 1000;
    stagingCountdownEndsAtRef.current = Date.now() + normalizedDurationMs;
    stagingCountdownRemainingMsRef.current = normalizedDurationMs;
    stagingCountdownTrackIdRef.current = startingTrackId;
    setStartCountdownPaused(false);
    setStartGateStatus({
      active: true,
      phase: 'staging',
      label: String(secondsRemaining),
      detail: 'Adjust the view, then return to your bike',
      lightIndex: null,
    });

    for (let nextSeconds = secondsRemaining - 1; nextSeconds >= 1; nextSeconds -= 1) {
      scheduleStartGateStep((secondsRemaining - nextSeconds) * 1000, () => {
        stagingCountdownRemainingMsRef.current = nextSeconds * 1000;
        setStartGateStatus({
          active: true,
          phase: 'staging',
          label: String(nextSeconds),
          detail: 'Adjust the view, then return to your bike',
          lightIndex: null,
        });
      }, sequenceId);
    }

    scheduleStartGateStep(normalizedDurationMs, () => {
      void startConfiguredCadence(startingTrackId, sequenceId);
    }, sequenceId);
  }, [scheduleStartGateStep, startConfiguredCadence]);

  const startCountdownControlsAvailable = canControlRaceStagingCountdown({
    gateActive: startGateStatus.active,
    gatePhase: startGateStatus.phase,
    multiplayerRoomActive: Boolean(multiplayer.currentRoom),
  });

  const handleStartCountdownPauseToggle = useCallback(() => {
    if (!startCountdownControlsAvailable) {
      return;
    }

    const startingTrackId = stagingCountdownTrackIdRef.current;
    if (!startingTrackId) {
      return;
    }

    if (startCountdownPaused) {
      scheduleStagingCountdown(
        startingTrackId,
        startGateSequenceIdRef.current,
        stagingCountdownRemainingMsRef.current,
      );
      return;
    }

    const remainingMs = Math.max(1000, stagingCountdownEndsAtRef.current - Date.now());
    stagingCountdownRemainingMsRef.current = Math.ceil(remainingMs / 1000) * 1000;
    stagingCountdownEndsAtRef.current = 0;
    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    setStartCountdownPaused(true);
    setStartGateStatus((current) => current.phase === 'staging'
      ? {
        ...current,
        label: 'PAUSED',
        detail: `${Math.ceil(stagingCountdownRemainingMsRef.current / 1000)} seconds remaining`,
      }
      : current);
  }, [scheduleStagingCountdown, startCountdownControlsAvailable, startCountdownPaused]);

  const handleStartCountdownForceStart = useCallback(() => {
    if (!startCountdownControlsAvailable) {
      return;
    }

    const startingTrackId = stagingCountdownTrackIdRef.current;
    if (!startingTrackId) {
      return;
    }

    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    stagingCountdownEndsAtRef.current = 0;
    stagingCountdownRemainingMsRef.current = 0;
    stagingCountdownTrackIdRef.current = null;
    setStartCountdownPaused(false);
    void startConfiguredCadence(startingTrackId, startGateSequenceIdRef.current);
  }, [startConfiguredCadence, startCountdownControlsAvailable]);

  const handleFalseStart = useCallback((detection: FalseStartDetection) => {
    if (falseStartActiveRef.current || raceState === 'racing') {
      return;
    }

    falseStartActiveRef.current = true;
    const startingTrackId = selectedTrackIdRef.current;
    cancelStartGateSequence();
    const sequenceId = startGateSequenceIdRef.current;
    resetRace();
    resetRaceCaptureForFalseStart(detection);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
    if (!demoMode) {
      bridge.sendControlCommand('race-reset');
    }

    const totalSeconds = Math.ceil(falseStartResetCountdownMs / 1000);
    const showCountdown = (secondsRemaining: number) => {
      setStartGateStatus({
        active: true,
        phase: 'false-start',
        label: String(secondsRemaining),
        detail: `False start: ${detection.playerName}. Gate resets in ${secondsRemaining}`,
        lightIndex: null,
      });
      playStartGateTone('tick');
    };

    showCountdown(totalSeconds);
    for (let secondsRemaining = totalSeconds - 1; secondsRemaining >= 1; secondsRemaining -= 1) {
      scheduleStartGateStep(
        (totalSeconds - secondsRemaining) * 1000,
        () => showCountdown(secondsRemaining),
        sequenceId,
      );
    }

    scheduleStartGateStep(falseStartResetCountdownMs, () => {
      if (selectedTrackIdRef.current !== startingTrackId) {
        return;
      }

      falseStartActiveRef.current = false;
      if (!demoMode) {
        bridge.sendControlCommand('race-arm');
      }
      void startConfiguredCadence(startingTrackId, sequenceId);
    }, sequenceId);
  }, [bridge, cancelStartGateSequence, demoMode, raceState, resetRace, resetRaceCaptureForFalseStart, scheduleStartGateStep, startConfiguredCadence]);

  useEffect(() => {
    if (
      demoMode
      || !startGateStatus.active
      || startGateStatus.phase !== 'cadence'
      || cadenceStartedAtRef.current <= 0
      || redLightAtRef.current > 0
      || falseStartActiveRef.current
    ) {
      return;
    }

    const detection = detectFalseStart(racePlayers, samplesByDevice, cadenceStartedAtRef.current);
    if (detection) {
      handleFalseStart(detection);
    }
  }, [demoMode, handleFalseStart, racePlayers, samplesByDevice, startGateStatus.active, startGateStatus.phase]);

  useEffect(() => {
    const validStartAt = redLightAtRef.current || reactionStartAt || 0;
    const canPresentStart = startGateStatus.phase === 'cadence' || raceState === 'racing';
    if (demoMode || !canPresentStart || validStartAt <= 0) {
      return;
    }

    const newlyTriggered = racePlayers.filter((player) => {
      if (cStartTriggeredPlayerIdsRef.current.has(player.id)) {
        return false;
      }

      const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
      return bikeSampleHasDriveSignalSince(sample, validStartAt);
    });
    if (newlyTriggered.length === 0) {
      return;
    }

    newlyTriggered.forEach((player) => cStartTriggeredPlayerIdsRef.current.add(player.id));
    const newlyTriggeredIds = newlyTriggered.map((player) => player.id);
    loadCStartPlayers(newlyTriggeredIds);

    if (raceState === 'racing') {
      releaseCStartPlayers(newlyTriggeredIds);
    }
  }, [
    demoMode,
    loadCStartPlayers,
    racePlayers,
    raceState,
    reactionStartAt,
    releaseCStartPlayers,
    samplesByDevice,
    startGateStatus.phase,
  ]);

  const handleDemoModeChange = (enabled: boolean, nextSource: BikeConnectionSource = enabled ? 'demo' : 'bluetooth') => {
    if (enabled && !adminProfileActive) {
      return;
    }

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
    if (clubTabletKioskMode && source !== 'bluetooth') return;

    if (!accountProfileComplete && !clubTabletDeviceActive) {
      setProfileFormError('Create an account or sign in before connecting Wattbikes.');
      setCheckoutMessage(null);
      setShowMembershipLanding(true);
      return;
    }

    if (source === 'advanced' && !authenticatedRacerAccess) {
      setCheckoutMessage('Advanced Connector requires a personal Racer bike membership.');
      setCheckoutStatus('idle');
      setShowMembershipLanding(true);
      return;
    }

    if (source === 'bluetooth' && liveBikeAccessLocked) {
      setCheckoutMessage(selectedClubTrainingMembershipActive
        ? 'Club bike access is unavailable. The club may be using all purchased bike seats or its membership may need attention.'
        : 'Choose “Training at your club” for temporary studio access, or upgrade to Racer.');
      setCheckoutStatus('idle');
      return;
    }

    if (source === 'demo') {
      if (!adminProfileActive) {
        return;
      }
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
    const nextCount = Math.max(1, Math.min(maxPlayers, Math.round(count)));
    clearStartGateSequence();
    setLockedRacePlayers(null);
    setDemoBikeCount(nextCount);
    setSelectedDemoPlayerIds(defaultPlayerSlots.slice(0, nextCount).map((player) => player.id));
    setDemoRaceSeed(Date.now() + count);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const handleDemoPlayerSelectionChange = (playerIds: PlayerSlot['id'][]) => {
    const requestedIds = new Set(playerIds);
    const nextIds = defaultPlayerSlots
      .map((player) => player.id)
      .filter((playerId) => requestedIds.has(playerId));
    if (nextIds.length === 0) {
      return;
    }
    clearStartGateSequence();
    setLockedRacePlayers(null);
    setSelectedDemoPlayerIds(nextIds);
    setDemoBikeCount(nextIds.length);
    setDemoRaceSeed(Date.now() + nextIds.reduce((total, playerId) => total + playerId, 0));
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

      // A signed-out device may still hold a prior athlete's native recovery
      // record. Clear it before committing this newly authenticated account;
      // RecoveryAlertCoordinator will then bind and rehydrate the exact user.
      await clearNativeRecoveryBoundary();
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
      setMembership(createMembership('visitor'));
      setCheckoutBikeSeats(1);
      setProfileFormError(error instanceof Error ? error.message : 'Could not sign in.');
      return false;
    }
  }, [authMode, authPasswordDraft, profileEmailDraft, profileNameDraft]);

  const handleSignOut = useCallback(async () => {
    const ownsNativeHeartRateWriter = heartRate.availability?.platform === 'iphone'
      || (heartRate.availability == null && Boolean(
        heartRate.status?.sessionId
        || heartRate.watchConnect?.connectionId
        || heartRate.relayState?.configured
        || (heartRate.relayState?.sessions.length ?? 0) > 0
        || (heartRate.relayState?.queuedCount ?? 0) > 0
        || (heartRate.relayState?.pendingSampleCount ?? 0) > 0,
      ));
    const unsyncedHeartRate = Boolean(
      ownsNativeHeartRateWriter
      && (heartRate.relayState?.configured
      || (heartRate.relayState?.queuedCount ?? 0) > 0
      || (heartRate.relayState?.pendingSampleCount ?? 0) > 0),
    );
    if (
      !clubTabletKioskMode
      && unsyncedHeartRate
      && typeof window !== 'undefined'
      && !window.confirm(
        'Apple Watch heart-rate data is still active or waiting to sync on this iPhone. Choose Cancel and wait for “Heart rate synced to TrackLab Cloud” to protect it. Choose OK only if you want to discard the device copy and sign out now.',
      )
    ) {
      setHeartRateMessage('Sign-out paused while Apple Watch heart rate finishes syncing.');
      return;
    }
    heartRateAccountHydrationGenerationRef.current += 1;
    heartRateAccountHydrationRef.current = null;
    setHeartRateHydratedAccountId(null);
    setLiveHeartRateByRider({});
    heartRate.clearSamples();
    const liveClubSelection = clubTrainingSelection;
    const pendingHeartRateStarts = [...heartRateRelayStartPromisesRef.current.entries()];
    const pendingWatchConnectActions = [...watchConnectActionPromisesRef.current];
    pendingHeartRateStarts.forEach(([sessionId]) => {
      cancelledHeartRateRelaySessionsRef.current.add(sessionId);
    });
    const pendingMonitorAuthorizations = [...clubMonitorSprintAuthorizationsRef.current.values()];
    const pendingClubGroupCancellation = cancelActiveClubOwnerTrainingGroup({ keepalive: true });
    clubMonitorSprintAuthorizationsRef.current.clear();
    setMonitorHistoryStatusByPlayer({});
    setMonitorReservedSessionByPlayer({});
    setMonitorHeartRateInvitations([]);
    setMonitorHeartRateBlocks([]);
    setMonitorHeartRateActionByRider({});
    setMonitorHeartRateOverlayPlayerId(null);
    monitorHeartRateInvitationSecretsRef.current.clear();
    monitorHeartRateBusyRidersRef.current.clear();
    monitorStoppedHeartRateInvitationIdsRef.current.clear();
    if (authUser?.id) {
      clearQueuedFriendRequests(authUser.id);
    }
    friendInviteAutoOpenedRef.current = false;
    friendGhostAutoSelectPendingRef.current = false;
    setFriendGhostRaceTarget(null);
    clearStartGateSequence();
    clubTrainingRequestGenerationRef.current += 1;
    activeClubProfileKeyRef.current = null;
    studioRidersProfileKeyRef.current = null;
    setStudioRidersProfileKey(null);
    setStudioRiders([]);
    setClubTrainingMemberships([]);
    setOwnedClub(null);
    setClubTrainingMembershipProfileKey(null);
    setClubRosterManagementProfileKey(null);
    setClubTrainingSelection(null);
    setClubTrainingStatus('idle');
    setCheckoutMessage(null);
    setProfileFormError(null);
    setAuthPasswordDraft('');
    setAuthStatus('loading');

    const pendingHeartRateAccountBlockAction = heartRateAccountBlockActionPromiseRef.current;
    await pendingClubGroupCancellation.catch(() => undefined);
    await Promise.all(pendingHeartRateStarts.map(([, pending]) => pending.catch(() => false)));
    if (pendingHeartRateAccountBlockAction) {
      await pendingHeartRateAccountBlockAction.catch(() => undefined);
    }
    if (ownsNativeHeartRateWriter) {
      const heartRateCloudApi = await import('./lib/heartRateCloud');
      await import('./lib/watchConnectActions').then(({ stopWatchConnectForAccountBoundary }) => (
        stopWatchConnectForAccountBoundary({
          getNativeState: async () => {
            const state = await heartRate.getWatchConnectState();
            return {
              state: state.state,
              scope: state.scope,
              connectionId: state.connectionId,
              sessionId: state.sessionId,
              connectedUntil: state.connectedUntil,
              remainingMs: state.remainingMs,
              requiresUserStart: state.requiresUserStart,
              workoutReady: state.workoutReady,
              relayConfigured: state.relayConfigured,
              ...(state.reason ? { reason: state.reason } : {}),
            };
          },
          stopNative: async () => {
            const state = await heartRate.stopWatchConnect();
            return {
              state: state.state,
              scope: state.scope,
              connectionId: state.connectionId,
              sessionId: state.sessionId,
              connectedUntil: state.connectedUntil,
              remainingMs: state.remainingMs,
              requiresUserStart: state.requiresUserStart,
              workoutReady: state.workoutReady,
              relayConfigured: state.relayConfigured,
              ...(state.reason ? { reason: state.reason } : {}),
            };
          },
        })
      )).catch(() => undefined);
      await Promise.allSettled(pendingWatchConnectActions);
      const serverPairingIds = authUser?.id
        ? await heartRateCloudApi.loadHeartRatePairings().then((pairings) => pairings
          .filter((pairing) => (
            pairing.riderId === `account:${authUser.id}` && pairing.revokedAt == null
          ))
          .map((pairing) => pairing.id)).catch(() => [] as string[])
        : [];
      const heartRateSessionIds = new Set([
        ...heartRatePairingIdsBySessionRef.current.keys(),
        ...(heartRate.relayState?.sessions.map((session) => session.sessionId) ?? []),
        ...(activeHeartRateRelaySessionRef.current ? [activeHeartRateRelaySessionRef.current] : []),
      ]);
      const heartRatePairingIds = new Set([
        ...heartRatePairingIdsBySessionRef.current.values(),
        ...heartRateKnownPairingIdsRef.current,
        ...serverPairingIds,
        ...(activeHeartRatePairingIdRef.current ? [activeHeartRatePairingIdRef.current] : []),
      ]);
      const clearedRelays = await heartRate.clearAllRelays().catch(() => ({
        configured: false,
        reason: 'Native relay cleanup failed.',
      }));
      if (clearedRelays.reason) {
        await Promise.all([...heartRateSessionIds].map((sessionId) => (
          heartRate.clearRelay({ sessionId }).catch(() => undefined)
        )));
      }
      await Promise.all([...heartRatePairingIds].map((pairingId) => (
        heartRateCloudApi.revokeHeartRatePairing(pairingId).catch(() => undefined)
      )));
    }
    await Promise.all(pendingMonitorAuthorizations.map((entry) => queueClubMonitorBikeOperation(
      clubMonitorSaveChainsByDeviceRef.current,
      entry.reservation.bikeDeviceId,
      async () => {
        let secured: AuthorizedClubMonitorSprint;
        try {
          secured = await (entry.activation ?? entry.authorization);
        } catch {
          secured = await entry.authorization;
        }
        await import('./lib/clubMonitorHistory').then(({ cancelClubMonitorSprintAuthorization }) => (
          cancelClubMonitorSprintAuthorization(secured.authorization.id, { keepalive: true })
        ));
      },
    ).catch(() => undefined)));
    clubMonitorSaveChainsByDeviceRef.current.clear();
    activeHeartRateRelaySessionRef.current = null;
    activeHeartRatePairingIdRef.current = null;
    heartRateRelayStartPromisesRef.current.clear();
    heartRatePairingIdsBySessionRef.current.clear();
    heartRateKnownPairingIdsRef.current.clear();
    heartRateAccountBlocksRef.current = [];
    activeHeartRateAccountBlockRef.current = null;
    heartRateAccountBlockCoversSessionsRef.current = false;
    heartRateAccountBlockCoveredSessionIdsRef.current.clear();
    heartRateAccountBlockObservedRelayIdsRef.current.clear();
    heartRateAccountBlockActionPromiseRef.current = null;
    watchConnectSuppressLegacyRelayRef.current = false;
    clubOwnerTrainingRecoveryScopeRef.current = null;
    cancelledHeartRateRelaySessionsRef.current.clear();
    finalizedHeartRateRelaySessionsRef.current.clear();
    heartRateConsentUpdateRevisionRef.current += 1;
    setHeartRateStudioConsent({ live: false, session: false });

    if (liveClubSelection) {
      await import('./lib/clubLive')
        .then(({ stopClubLiveSession }) => stopClubLiveSession(liveClubSelection, { keepalive: true }))
        .catch(() => undefined);
    }
    // Recovery notifications are device-local and can also be scheduled on an
    // iPad, independently of the iPhone heart-rate writer. Clear them after
    // relay shutdown and immediately before logout so an in-flight A response
    // cannot recreate A's alert at the A -> B account boundary.
    await clearNativeRecoveryBoundary();
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
  }, [
    authUser?.id,
    cancelActiveClubOwnerTrainingGroup,
    clearStartGateSequence,
    clubTabletKioskMode,
    clubTrainingSelection,
    heartRate,
  ]);

  useEffect(() => {
    if (!clubTabletKioskMode) {
      clubTabletAutoSignOutStartedRef.current = false;
      return;
    }
    if (!authUser || clubTabletAutoSignOutStartedRef.current) return;
    clubTabletAutoSignOutStartedRef.current = true;
    // Enrollment immediately converts this browser into a student-safe kiosk;
    // the owner's cookie and profile state are removed behind the locked UI.
    void handleSignOut().finally(() => {
      setShowMembershipLanding(false);
      setAppMode('club-tablet');
    });
  }, [authUser, clubTabletKioskMode, handleSignOut]);

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
    if (!adminProfileActive) {
      return;
    }

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
  }, [adminProfileActive, membership, multiplayer, requireAccountProfile]);

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

  const openTrackLocator = useCallback(() => {
    if (!requireAccountProfile()) {
      return;
    }

    setShowMembershipLanding(true);
    window.setTimeout(() => {
      document.getElementById('track-locator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [requireAccountProfile]);

  const handleCheckoutBikeSeatsChange = useCallback((bikeSeats: number) => {
    setCheckoutBikeSeats(clampBillingBikeSeats(bikeSeats));
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
    if (!adminProfileActive) {
      return;
    }

    clearStartGateSequence();
    setDemoMode(true);
    setDemoBikeCount(Math.min(maxPlayers, Math.max(1, demoBikeCount)));
    setDemoRaceSeed(Date.now());
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
    setAppMode('race');
  }, [adminProfileActive, clearStartGateSequence, demoBikeCount, resetRace]);

  const enableMultiplayerTest = useCallback(() => {
    setPlayMode('multiplayer');
    setAppMode('diagnostics');
  }, []);

  const handleReset = () => {
    const sessionId = raceCapture?.sessionId ?? `reset-${Date.now()}`;
    void cancelActiveClubOwnerTrainingGroup().catch((error: unknown) => {
      console.warn(`Could not cancel club training preparation during reset: ${error instanceof Error ? error.message : String(error)}`);
    });
    clearHeartRateRelay(sessionId);
    appendRaceCaptureEvent('race-reset', 'Race reset');
    clearStartGateSequence();
    setLockedRacePlayers(null);
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
    void cancelActiveClubOwnerTrainingGroup().catch((error: unknown) => {
      console.warn(`Could not cancel club training preparation: ${error instanceof Error ? error.message : String(error)}`);
    });
    clearHeartRateRelay(sessionId);
    const label = raceState === 'racing'
      ? 'Race cancelled mid-race'
      : 'Race cancelled before gate drop';
    appendRaceCaptureEvent('race-cancel', label);
    clearStartGateSequence();
    setLockedRacePlayers(null);
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

  const returnToClubTablet = useCallback(() => {
    clearStartGateSequence();
    setLockedRacePlayers(null);
    setMappingMode(false);
    setMappingFullscreen(false);
    setExploreRideFullscreen(false);
    setExploreClubLiveState(null);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(true);
    resetRace();
    raceCommentary.stop();
    stopBmxEventAmbience();
    stopRaceAudioKeepAlive();
    stopBikeRaceAudio();
    roomVoice.stop();
    if (multiplayer.currentRoom) {
      multiplayer.controlExploreSession('reset');
      multiplayer.leaveRoom();
    }
    setPlayMode('local');
    releaseRaceFullscreen();
    setAppMode('club-tablet');
  }, [
    clearStartGateSequence,
    multiplayer,
    raceCommentary.stop,
    releaseRaceFullscreen,
    resetRace,
    roomVoice,
  ]);
  clubTabletEmergencyExitRef.current = returnToClubTablet;

  const handleClubTabletDeviceChange = useCallback((next: ClubTabletDeviceCredential | null) => {
    setLiveHeartRateByRider({});
    clearRaceCaptureForClubTablet();
    friendGhostAutoSelectPendingRef.current = false;
    setFriendGhostRaceTarget(null);
    setChatDraft('');
    setChatMessages([]);
    if (!next) {
      clubTabletEmergencyExitRef.current();
      clearStoredClubTabletSession();
      clearStoredClubTabletDevice();
      setClubTabletSession(null);
      setClubTabletRoster(null);
      setClubTabletDevice(null);
      setClubTabletDeviceStatus('idle');
      setClubTrainingSelection(null);
      setStudioRiderAssignments({});
      setLiveRaceReadyDeviceIds([]);
      setSelectedGhostIds([]);
      setGhostLaps(readStoredGhostLaps());
      return;
    }
    setClubTabletDevice(next);
    setClubTabletDeviceStatus('checking');
    setDemoMode(false);
    setBikeConnectionSource('bluetooth');
    setShowMembershipLanding(false);
    setSidebarMoreOpen(false);
    setAppMode('club-tablet');
  }, [clearRaceCaptureForClubTablet]);

  const handleClubTabletSessionChange = useCallback((next: ClubTabletSessionCredential | null) => {
    setLiveHeartRateByRider({});
    clearRaceCaptureForClubTablet();
    friendGhostAutoSelectPendingRef.current = false;
    setFriendGhostRaceTarget(null);
    setChatDraft('');
    setChatMessages([]);
    if (!next) {
      clubTabletEmergencyExitRef.current();
      clearStoredClubTabletSession();
      setClubTabletSession(null);
      setClubTrainingSelection(null);
      setStudioRiderAssignments({});
      setLiveRaceReadyDeviceIds([]);
      setSelectedGhostIds([]);
      setGhostLaps([]);
      return;
    }
    storeClubTabletSession(next);
    setClubTabletSession(next);
    setClubTrainingSelection({
      clubId: next.session.clubId,
      studioRiderId: next.session.studioRiderId,
    });
    setStudioRiderAssignments({ [next.session.bikeDeviceId]: next.session.studioRiderId });
    setLiveRaceReadyDeviceIds([next.session.bikeDeviceId]);
    setSelectedGhostIds([]);
    setGhostLaps([]);
    setBikeConnectionSource('bluetooth');
    setDemoMode(false);
    setAppMode('club-tablet');
  }, [clearRaceCaptureForClubTablet]);

  const handleClubTabletDeviceReady = useCallback((
    nextRoster: ClubTabletRoster,
    hasStoredSession: boolean,
  ) => {
    setClubTabletRoster(nextRoster);
    setClubTabletDeviceStatus('active');
    setAppMode((current) => (hasStoredSession ? current : 'club-tablet'));
  }, []);

  const handleClubTabletDeviceError = useCallback(() => {
    setClubTabletDeviceStatus('error');
  }, []);

  const retryClubTabletAuthorization = useCallback(() => {
    if (!clubTabletDevice) return;
    setClubTabletDeviceStatus('checking');
    setClubTabletRoster(null);
    setClubTabletAuthorizationRevision((current) => current + 1);
  }, [clubTabletDevice]);

  const handleClubTabletRosterChange = useCallback((nextRoster: ClubTabletRoster | null) => {
    setClubTabletRoster(nextRoster);
    if (nextRoster && nextRoster.device.id === clubTabletDevice?.device.id) {
      setClubTabletDeviceStatus('active');
    }
  }, [clubTabletDevice?.device.id]);

  const handleClubTabletDeviceRevoked = useCallback(() => {
    handleClubTabletDeviceChange(null);
    setClubTabletDeviceStatus('revoked');
    setShowMembershipLanding(true);
  }, [handleClubTabletDeviceChange]);

  const handleClubTabletSessionExpired = useCallback(() => {
    handleClubTabletSessionChange(null);
  }, [handleClubTabletSessionChange]);

  const handleClubTabletHeartRateReading = useCallback((reading: HeartRateLiveEvent | null) => {
    setLiveHeartRateByRider(reading ? { [reading.riderId]: reading } : {});
  }, []);

  const handleClubTabletEndAthlete = useCallback(async () => {
    const activeSession = clubTabletSession;
    returnToClubTablet();
    try {
      if (activeSession) {
        const { endClubTabletSession } = await import('./lib/clubTablet');
        await endClubTabletSession(activeSession);
      }
    } finally {
      handleClubTabletSessionChange(null);
    }
  }, [clubTabletSession, handleClubTabletSessionChange, returnToClubTablet]);

  const shareMultiplayerInvite = useCallback(() => {
    if (!multiplayer.inviteUrl) {
      return;
    }

    void navigator.clipboard?.writeText(multiplayer.inviteUrl).catch(() => {
      window.prompt('Copy this TrackLab room invite link:', multiplayer.inviteUrl);
    });
  }, [multiplayer.inviteUrl]);

  const handleExploreDemoRideStatusChange = useCallback((
    status: 'ready' | 'riding' | 'paused' | 'finished',
  ) => {
    if (!demoMode) {
      return;
    }
    if (status === 'riding') {
      setDemoSignalsStopped(false);
      setDemoRaceStartedAt((startedAt) => startedAt ?? Date.now());
      return;
    }
    if (status === 'ready' || status === 'finished') {
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(false);
    }
  }, [demoMode]);

  const handleMonitorSprintArm = useCallback((arm: MonitorSprintArm) => {
    if (demoMode) return;
    const accountRiderId = authUser ? `account:${authUser.id}` : null;
    if (arm.riderId === accountRiderId) return;

    const member = ownedClub?.members.find((candidate) => candidate.studioRiderId === arm.riderId);
    if (!ownedClub || !arm.riderId || member?.status !== 'claimed') {
      setMonitorReservedSessionByPlayer((current) => {
        if (!(arm.playerId in current)) return current;
        const next = { ...current };
        delete next[arm.playerId];
        return next;
      });
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [arm.playerId]: {
          state: 'error',
          label: 'Not armed',
          detail: arm.riderId
            ? 'This studio rider must claim their TrackLab account before Monitor View can save history.'
            : 'Assign a claimed athlete to this Wattbike before they pedal.',
        },
      }));
      return;
    }

    const reservation: ClubMonitorSprintReservation = {
      clubId: ownedClub.id,
      studioRiderId: arm.riderId,
      bikeDeviceId: arm.deviceId,
      sessionId: arm.id,
      playerId: arm.playerId,
      armedAt: arm.armedAt,
    };
    setMonitorReservedSessionByPlayer((current) => {
      if (!(arm.playerId in current)) return current;
      const next = { ...current };
      delete next[arm.playerId];
      return next;
    });
    setMonitorHistoryStatusByPlayer((current) => ({
      ...current,
      [arm.playerId]: {
        state: 'authorizing',
        label: 'Securing',
        detail: 'Reserving this exact rider, lane, and Wattbike before the first watt.',
      },
    }));
    const authorization = queueClubMonitorBikeOperation(
      clubMonitorSaveChainsByDeviceRef.current,
      arm.deviceId,
      () => import('./lib/clubMonitorHistory')
        .then(({ authorizeClubMonitorSprint }) => authorizeClubMonitorSprint(reservation)),
    );
    const entry: ClubMonitorSprintAuthorizationEntry = {
      reservation,
      authorization,
      activation: null,
    };
    // Store synchronously: Monitor may emit arm and first-watt start in the
    // same React effect when a bike is already producing power.
    clubMonitorSprintAuthorizationsRef.current.set(arm.id, entry);
    void authorization.then(() => {
      if (clubMonitorSprintAuthorizationsRef.current.get(arm.id) !== entry) return;
      setMonitorReservedSessionByPlayer((current) => ({ ...current, [arm.playerId]: arm.id }));
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [arm.playerId]: {
          state: 'saving',
          label: 'Ready',
          detail: 'Secure reservation ready. The sprint clock will start at the first watt.',
        },
      }));
    }).catch((error: unknown) => {
      if (clubMonitorSprintAuthorizationsRef.current.get(arm.id) === entry) {
        clubMonitorSprintAuthorizationsRef.current.delete(arm.id);
      }
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [arm.playerId]: {
          state: 'error',
          label: 'Not armed',
          detail: error instanceof Error ? error.message : String(error),
        },
      }));
    });
  }, [authUser, demoMode, ownedClub]);

  const cancelMonitorSprintAuthorization = useCallback((cancellation: {
    id: string;
    playerId: PlayerSlot['id'];
    deviceId: number;
    reason: MonitorSprintArmCancellation['reason'] | MonitorSprintCancellation['reason'];
  }) => {
    const entry = clubMonitorSprintAuthorizationsRef.current.get(cancellation.id);
    if (!entry) return;
    clubMonitorSprintAuthorizationsRef.current.delete(cancellation.id);
    setMonitorReservedSessionByPlayer((current) => {
      if (current[cancellation.playerId] !== cancellation.id) return current;
      const next = { ...current };
      delete next[cancellation.playerId];
      return next;
    });
    const operation = queueClubMonitorBikeOperation(
      clubMonitorSaveChainsByDeviceRef.current,
      cancellation.deviceId,
      async () => {
        let secured: AuthorizedClubMonitorSprint;
        try {
          secured = await (entry.activation ?? entry.authorization);
        } catch {
          secured = await entry.authorization;
        }
        await import('./lib/clubMonitorHistory').then(({ cancelClubMonitorSprintAuthorization }) => (
          cancelClubMonitorSprintAuthorization(secured.authorization.id, {
            keepalive: cancellation.reason === 'view-closed',
          })
        ));
      },
    );
    void operation.catch((error: unknown) => {
      // A failed reserve has nothing to cancel. Surface every other failure so
      // the owner knows this lane needs a fresh secure arm.
      void entry.authorization.then(() => {
        setMonitorHistoryStatusByPlayer((current) => ({
          ...current,
          [cancellation.playerId]: {
            state: 'error',
            label: 'Cancel failed',
            detail: error instanceof Error ? error.message : String(error),
          },
        }));
      }).catch(() => undefined);
    });
  }, []);

  const handleMonitorSprintArmCancel = useCallback((cancellation: MonitorSprintArmCancellation) => {
    cancelMonitorSprintAuthorization(cancellation);
  }, [cancelMonitorSprintAuthorization]);

  const handleMonitorSprintCancel = useCallback((cancellation: MonitorSprintCancellation) => {
    const accountRiderId = authUser ? `account:${authUser.id}` : null;
    if (cancellation.riderId === accountRiderId) {
      void clearHeartRateRelay(cancellation.id);
      return;
    }
    cancelMonitorSprintAuthorization(cancellation);
  }, [authUser, cancelMonitorSprintAuthorization, clearHeartRateRelay]);

  const handleMonitorSprintStart = useCallback((session: MonitorSprintSession) => {
    if (demoMode) return;
    const accountRiderId = authUser ? `account:${authUser.id}` : null;
    if (session.riderId === accountRiderId) {
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [session.playerId]: { state: 'saving', label: 'Capturing', detail: 'This sprint will save to your TrackLab account.' },
      }));
      void beginHeartRateRelay({
        sessionId: session.id,
        activityType: 'monitor-sprint',
        riderId: session.riderId,
        playerId: session.playerId,
        startedAt: session.startedAt,
      });
      return;
    }

    const entry = clubMonitorSprintAuthorizationsRef.current.get(session.id);
    if (
      !entry
      || entry.reservation.studioRiderId !== session.riderId
      || entry.reservation.bikeDeviceId !== session.deviceId
      || entry.reservation.playerId !== session.playerId
    ) {
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [session.playerId]: {
          state: 'error',
          label: 'Not captured',
          detail: 'The secure pre-pedal reservation did not match this rider and Wattbike.',
        },
      }));
      return;
    }

    setMonitorHistoryStatusByPlayer((current) => ({
      ...current,
      [session.playerId]: {
        state: 'authorizing',
        label: 'Starting',
        detail: 'Locking the authoritative sprint clock to this first-watt sample.',
      },
    }));
    const activation = queueClubMonitorBikeOperation(
      clubMonitorSaveChainsByDeviceRef.current,
      session.deviceId,
      async () => {
        const { activateAuthorizedClubMonitorSprint } = await import('./lib/clubMonitorHistory');
        return activateAuthorizedClubMonitorSprint(await entry.authorization, session.startedAt);
      },
    );
    entry.activation = activation;
    void activation.then(() => {
      if (clubMonitorSprintAuthorizationsRef.current.get(session.id) !== entry) return;
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [session.playerId]: {
          state: 'saving',
          label: 'Capturing',
          detail: 'Saving this exact first-watt-to-finish sprint to the assigned athlete.',
        },
      }));
    }).catch((error: unknown) => {
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [session.playerId]: {
          state: 'error',
          label: 'Not captured',
          detail: error instanceof Error ? error.message : String(error),
        },
      }));
    });
  }, [authUser, beginHeartRateRelay, demoMode]);

  const handleMonitorSprintComplete = useCallback((result: MonitorSprintCompleteResult) => {
    if (demoMode || !authUser) return;
    const accountRiderId = `account:${authUser.id}`;
    if (result.riderId === accountRiderId) {
      const heartRateFinalization = finalizeHeartRateRelay({
        sessionId: result.id,
        endedAt: result.endedAt,
        activeDurationMs: result.durationMs,
      });
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [result.playerId]: { state: 'saving', label: 'Saving', detail: 'Saving this sprint to your TrackLab account.' },
      }));
      void import('./lib/trainingHistory').then(({ saveTrainingSession }) => saveTrainingSession({
        id: result.id,
        activityType: 'monitor-sprint',
        title: 'Monitor View sprint',
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        durationMs: result.durationMs,
        distanceMeters: result.distanceMeters,
        trackId: 'tracklab-monitor-sprint',
        trackName: 'Monitor View',
        details: {
          riders: [{
            playerId: result.playerId,
            ...(result.riderId ? { riderId: result.riderId } : {}),
            name: result.riderName,
            distanceMeters: result.distanceMeters,
            averageWatts: result.averageWatts,
            peakWatts: result.peakWatts,
            averageCadence: result.averageCadence,
            peakCadence: result.peakCadence,
            averageSpeedKph: result.averageSpeedKph,
            peakSpeedKph: result.peakSpeedKph,
          }],
        },
      })).then(async () => {
        const heartRateOutcome = await heartRateFinalization;
        setTrainingHistoryRevision((revision) => revision + 1);
        setMonitorHistoryStatusByPlayer((current) => ({
          ...current,
          [result.playerId]: personalMonitorSavedStatus(heartRateOutcome),
        }));
      }).catch((error: Error) => {
        setMonitorHistoryStatusByPlayer((current) => ({
          ...current,
          [result.playerId]: { state: 'error', label: 'Save failed', detail: error.message },
        }));
      });
      return;
    }

    const pending = clubMonitorSprintAuthorizationsRef.current.get(result.id);
    if (!pending || pending.reservation.studioRiderId !== result.riderId || !pending.activation) return;
    const binding: ClubMonitorSprintBinding = {
      clubId: pending.reservation.clubId,
      studioRiderId: pending.reservation.studioRiderId,
      bikeDeviceId: pending.reservation.bikeDeviceId,
      sessionId: pending.reservation.sessionId,
      playerId: pending.reservation.playerId,
      startedAt: result.startedAt,
    };
    setMonitorHistoryStatusByPlayer((current) => ({
      ...current,
      [result.playerId]: { state: 'saving', label: 'Saving', detail: 'Saving to the assigned athlete account.' },
    }));
    const save = queueClubMonitorBikeOperation(
      clubMonitorSaveChainsByDeviceRef.current,
      result.deviceId,
      async () => {
        const { saveToken } = await pending.activation!;
        return import('./lib/clubMonitorHistory').then(({ saveAuthorizedClubMonitorSprint }) => (
          saveAuthorizedClubMonitorSprint(binding, {
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            distanceMeters: result.distanceMeters,
            averageWatts: result.averageWatts,
            peakWatts: result.peakWatts,
            averageCadence: result.averageCadence,
            peakCadence: result.peakCadence,
            averageSpeedKph: result.averageSpeedKph,
            peakSpeedKph: result.peakSpeedKph,
          }, saveToken)
        ));
      },
    ).then((saved) => {
      setTrainingHistoryRevision((revision) => revision + 1);
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [result.playerId]: clubMonitorSavedStatus(saved.heartRate.status),
      }));
    }).catch((error: unknown) => {
      setMonitorHistoryStatusByPlayer((current) => ({
        ...current,
        [result.playerId]: {
          state: 'error',
          label: 'Save failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      }));
    }).finally(() => {
      clubMonitorSprintAuthorizationsRef.current.delete(result.id);
    });
  }, [authUser, demoMode, finalizeHeartRateRelay]);

  const handleMonitorHeartRateOpen = useCallback((player: PlayerSlot) => {
    setMonitorHeartRateOverlayPlayerId(player.id);
  }, []);

  const handleMonitorHeartRateCreate = useCallback(async (player: PlayerSlot) => {
    if (!ownedClub || !player.riderId) return;
    await import('./lib/studioHeartRateOwnerActions').then(({ createOwnerStudioHeartRateInvitation }) => (
      createOwnerStudioHeartRateInvitation({
        club: ownedClub,
        player,
        anchorContext: {
          appMode,
          monitorSessionId: monitorReservedSessionByPlayer[player.id],
          group: clubOwnerTrainingGroupRef.current,
          preparation: clubOwnerRacePreparation,
        },
        blocks: monitorHeartRateBlocks,
        invitations: monitorHeartRateInvitations,
        busyRiderIds: monitorHeartRateBusyRidersRef.current,
        currentHref: window.location.href,
        buildFallbackClaimUrl: monitorHeartRateInviteHandoffHref,
        invitationSecrets: monitorHeartRateInvitationSecretsRef.current,
        updateActions: setMonitorHeartRateActionByRider,
        updateInvitations: setMonitorHeartRateInvitations,
      })
    ));
  }, [appMode, clubOwnerRacePreparation, monitorHeartRateBlocks, monitorHeartRateInvitations, monitorReservedSessionByPlayer, ownedClub]);

  const handleMonitorHeartRateCopy = useCallback(async (studioRiderId: string) => {
    await import('./lib/studioHeartRateOwnerActions').then(({ copyOwnerStudioHeartRateInvitation }) => (
      copyOwnerStudioHeartRateInvitation({
        studioRiderId,
        invitationSecrets: monitorHeartRateInvitationSecretsRef.current,
        updateActions: setMonitorHeartRateActionByRider,
      })
    ));
  }, []);

  const handleMonitorHeartRateShare = useCallback(async (studioRiderId: string) => {
    await import('./lib/studioHeartRateOwnerActions').then(({ shareOwnerStudioHeartRateInvitation }) => (
      shareOwnerStudioHeartRateInvitation({
        studioRiderId,
        invitationSecrets: monitorHeartRateInvitationSecretsRef.current,
        updateActions: setMonitorHeartRateActionByRider,
      })
    ));
  }, []);

  const handleMonitorHeartRateCancel = useCallback(async (studioRiderId: string) => {
    if (!ownedClub) return;
    await import('./lib/studioHeartRateOwnerActions').then(({ stopOwnerStudioHeartRateSharing }) => (
      stopOwnerStudioHeartRateSharing({
        clubId: ownedClub.id,
        studioRiderId,
        invitations: monitorHeartRateInvitations,
        blocks: monitorHeartRateBlocks,
        busyRiderIds: monitorHeartRateBusyRidersRef.current,
        stoppedInvitationIds: monitorStoppedHeartRateInvitationIdsRef.current,
        invitationSecrets: monitorHeartRateInvitationSecretsRef.current,
        updateActions: setMonitorHeartRateActionByRider,
        updateInvitations: setMonitorHeartRateInvitations,
        updateBlocks: setMonitorHeartRateBlocks,
      })
    ));
  }, [monitorHeartRateBlocks, monitorHeartRateInvitations, ownedClub]);

  const handleMonitorHeartRateRetry = useCallback((player: PlayerSlot) => {
    if (!ownedClub || !player.riderId) return;
    void import('./lib/studioHeartRateOwnerActions').then(({ retryOwnerStudioHeartRateInvitation }) => (
      retryOwnerStudioHeartRateInvitation({
        clubId: ownedClub.id,
        player,
        invitations: monitorHeartRateInvitations,
        blocks: monitorHeartRateBlocks,
        updateActions: setMonitorHeartRateActionByRider,
        onCreate: (target) => { void handleMonitorHeartRateCreate(target); },
      })
    ));
  }, [handleMonitorHeartRateCreate, monitorHeartRateBlocks, monitorHeartRateInvitations, ownedClub]);

  const monitorStudioHeartRateByPlayer = useMemo<Partial<Record<
    PlayerSlot['id'],
    MonitorStudioHeartRateControl
  >>>(() => {
    if (!ownedClub) return {};
    const accountRiderId = authUser ? `account:${authUser.id}` : null;
    const controls: Partial<Record<PlayerSlot['id'], MonitorStudioHeartRateControl>> = {};
    explorePlayers.forEach((player) => {
      if (!player.riderId || player.riderId === accountRiderId) return;
      const member = ownedClub.members.find((candidate) => candidate.studioRiderId === player.riderId);
      if (member?.status !== 'claimed') return;
      const action = monitorHeartRateActionByRider[player.riderId];
      const block = activeMonitorHeartRateBlock(
        monitorHeartRateBlocks,
        ownedClub.id,
        player.riderId,
      );
      const invitation = activeMonitorHeartRateInvitation(
        monitorHeartRateInvitations,
        ownedClub.id,
        player.riderId,
        now,
      );
      controls[player.id] = {
        phase: action?.phase
          ?? (block
            ? block.state
            : invitation
              ? 'waiting-athlete'
              : 'disconnected'),
      };
    });
    return controls;
  }, [
    authUser,
    explorePlayers,
    monitorHeartRateActionByRider,
    monitorHeartRateBlocks,
    monitorHeartRateInvitations,
    now,
    ownedClub,
  ]);

  const monitorHeartRateOverlayPlayer = monitorHeartRateOverlayPlayerId == null
    ? null
    : (raceWorkspaceActive ? racePlayers : explorePlayers)
      .find((player) => player.id === monitorHeartRateOverlayPlayerId) ?? null;
  const monitorHeartRateOverlayRiderId = monitorHeartRateOverlayPlayer?.riderId ?? null;
  const monitorHeartRateOverlayAction = monitorHeartRateOverlayRiderId
    ? monitorHeartRateActionByRider[monitorHeartRateOverlayRiderId]
    : null;
  const monitorHeartRateOverlaySecret = monitorHeartRateOverlayRiderId
    ? monitorHeartRateInvitationSecretsRef.current.get(monitorHeartRateOverlayRiderId)
    : null;
  const handleExploreFullscreenChange = useCallback((enabled: boolean) => {
    setExploreRideFullscreen(enabled);
    if (enabled) {
      requestBrowserFullscreen(raceShellRef.current);
    } else {
      releaseBrowserFullscreen();
    }
  }, []);

  const handleUtilityFullscreenChange = useCallback((enabled: boolean) => {
    setUtilityFullscreen(enabled);
    if (enabled) {
      requestBrowserFullscreen(raceShellRef.current);
    } else {
      releaseBrowserFullscreen();
    }
  }, []);

  const openFullscreenUtility = useCallback((mode: 'monitor' | 'club-monitor') => {
    setAppMode(mode);
    setUtilityFullscreen(true);
    requestBrowserFullscreen(raceShellRef.current);
  }, []);

  useEffect(() => {
    if (appMode !== 'explore' && exploreRideFullscreen) {
      setExploreRideFullscreen(false);
      releaseBrowserFullscreen();
    }
  }, [appMode, exploreRideFullscreen]);

  useEffect(() => {
    const utilityModeActive = appMode === 'get-pulled' || appMode === 'monitor' || clubMonitorReleasesLocalBikes;
    if (!utilityModeActive && utilityFullscreen) {
      setUtilityFullscreen(false);
      releaseBrowserFullscreen();
    }
  }, [appMode, utilityFullscreen]);

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
      { id: Date.now(), author: playMode === 'local' ? 'You' : 'Room Host', text, at: formatClock() },
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
      || !straightSprintRouteReady
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

    const activityType = appMode === 'straight-sprint' ? 'straight-sprint' : 'bmx-race';
    const groupPlayers = startingRacePlayers.filter((player) => player.deviceId != null
      && player.riderId != null
      && ownedClub?.members.some((member) => member.status === 'claimed'
        && member.studioRiderId === player.riderId));
    const shouldUseClubGroup = clubOwnerActive
      && playMode === 'local'
      && !demoMode
      && Boolean(ownedClub)
      && groupPlayers.length > 0;
    let clubGroup = clubOwnerTrainingGroupRef.current;

    if (shouldUseClubGroup && !clubGroup) {
      if (clubOwnerTrainingPreparePromiseRef.current) return;
      setLockedRacePlayers(startingRacePlayers);
      setMappingMode(false);
      setMappingFullscreen(false);
      setDemoSignalsStopped(false);
      const capture = createRaceCapture();
      const generation = ++clubOwnerTrainingGenerationRef.current;
      const checkpointScope = authUser!.profileKey;
      const playerIds = groupPlayers.map((player) => player.id);
      setClubOwnerRacePreparation({
        phase: 'authorizing',
        sessionId: capture.sessionId,
        playerIds,
        detail: `Securing ${playerIds.length} rider/bike ${playerIds.length === 1 ? 'assignment' : 'assignments'} before countdown.`,
      });
      const request = {
        requestId: `club-race-${capture.sessionId}`,
        clubId: ownedClub!.id,
        sessionId: capture.sessionId,
        activityType,
        armedAt: capture.createdAt,
        assignments: groupPlayers.map((player) => ({
          studioRiderId: player.riderId!,
          bikeDeviceId: player.deviceId!,
          playerId: player.id,
        })),
      } as const;
      let entry: ClubOwnerTrainingCoordinatorEntry | null = null;
      const preparation = (async () => {
        try {
          const coordinator = await import('./lib/clubOwnerTrainingCoordinator');
          entry = await coordinator.prepareClubOwnerTrainingGroup({
            request,
            checkpointScope,
            isCurrent: () => generation === clubOwnerTrainingGenerationRef.current,
            onArm: (armedEntry) => {
              entry = armedEntry;
              if (generation !== clubOwnerTrainingGenerationRef.current) return;
              clubOwnerTrainingGroupRef.current = armedEntry;
              clubOwnerTrainingCheckpointScopeRef.current = checkpointScope;
              clubOwnerTrainingAuthorizedPlayersRef.current.set(capture.sessionId, new Set(playerIds));
            },
          });
          if (!entry || generation !== clubOwnerTrainingGenerationRef.current) return;
          setClubOwnerRacePreparation({
            phase: 'ready',
            sessionId: capture.sessionId,
            playerIds,
            detail: 'Riders locked. Connect Apple Watch now or continue without it.',
          });
        } catch (error) {
          if (generation !== clubOwnerTrainingGenerationRef.current) return;
          setClubOwnerRacePreparation({
            phase: 'error',
            failureStage: 'prepare',
            sessionId: capture.sessionId,
            playerIds,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      clubOwnerTrainingPreparePromiseRef.current = preparation;
      void preparation.finally(() => {
        if (clubOwnerTrainingPreparePromiseRef.current === preparation) {
          clubOwnerTrainingPreparePromiseRef.current = null;
        }
      });
      return;
    }

    if (!shouldUseClubGroup && clubGroup) {
      await cancelActiveClubOwnerTrainingGroup();
      clubGroup = null;
    }
    if (shouldUseClubGroup && clubGroup) {
      if (
        clubGroup.request.sessionId !== activeRaceSessionIdRef.current
        || clubGroup.request.activityType !== activityType
        || clubOwnerRacePreparation.phase !== 'ready'
      ) return;
      setClubOwnerRacePreparation((current) => ({
        ...current,
        phase: 'active',
        detail: 'Countdown started; all athletes share the gate clock.',
      }));
    } else {
      setLockedRacePlayers(startingRacePlayers);
      createRaceCapture();
    }

    clearStartGateSequence();
    const sequenceId = startGateSequenceIdRef.current;
    setMappingMode(false);
    setMappingFullscreen(false);
    setDemoSignalsStopped(false);
    requestBrowserFullscreen(raceShellRef.current);
    if (!demoMode) bridge.sendControlCommand('race-arm');
    primeRaceAudio();
    void primeBikeRaceAudio();
    scheduleStagingCountdown(startingTrackId, sequenceId);
  };

  const clubOwnerPreparationDialogVisible = raceWorkspaceActive && (
    clubOwnerRacePreparation.phase === 'authorizing'
    || clubOwnerRacePreparation.phase === 'ready'
    || (clubOwnerRacePreparation.phase === 'error' && raceState !== 'racing')
  );
  const retryClubOwnerTrainingAction = () => {
    const entry = clubOwnerTrainingGroupRef.current;
    if (
      entry
      && raceCapture?.status === 'finished'
      && entry.request.sessionId === raceCapture.sessionId
      && (clubOwnerRacePreparation.failureStage === 'activate'
        || clubOwnerRacePreparation.failureStage === 'complete')
    ) {
      clubOwnerTrainingCompletionStartedRef.current.add(raceCapture.sessionId);
      void saveClubOwnerRaceGroup(raceCapture, entry).catch(() => undefined);
      return;
    }
    if (entry) {
      void cancelActiveClubOwnerTrainingGroup({ preserveStatus: true })
        .then(() => handleStart())
        .catch(() => undefined);
      return;
    }
    void handleStart();
  };

  const clubOwnerUtilitySharedProps = {
    owner: {
      authUser: authUser ? { id: authUser.id, profileKey: authUser.profileKey } : null,
      ownedClub,
      clubOwnerActive,
      clubTabletSessionActive,
      clubTabletSession,
      clubTrainingSelection,
      playMode,
      preparation: clubOwnerRacePreparation,
      setPreparation: setClubOwnerRacePreparation,
      groupRef: clubOwnerTrainingGroupRef,
      preparePromiseRef: clubOwnerTrainingPreparePromiseRef,
      generationRef: clubOwnerTrainingGenerationRef,
      completionStartedRef: clubOwnerTrainingCompletionStartedRef,
      authorizedPlayersRef: clubOwnerTrainingAuthorizedPlayersRef,
      checkpointScopeRef: clubOwnerTrainingCheckpointScopeRef,
      startedAtRef: clubOwnerUtilityStartedAtRef,
      completionRef: clubOwnerUtilityCompletionRef,
      cancelActiveGroup: cancelActiveClubOwnerTrainingGroup,
      onHistoryChanged: () => setTrainingHistoryRevision((revision) => revision + 1),
    },
    heartRateContext: {
      heartRate: {
        measurements: heartRate.measurements,
        pauseRelay: heartRate.pauseRelay,
        resumeRelay: heartRate.resumeRelay,
      },
      begin: beginHeartRateRelay,
      finalize: finalizeHeartRateRelay,
      clear: clearHeartRateRelay,
      relayStartPromisesRef: heartRateRelayStartPromisesRef,
      cancelledSessionsRef: cancelledHeartRateRelaySessionsRef,
      activeSessionRef: activeHeartRateRelaySessionRef,
      accountBlockCoveredSessionIdsRef: heartRateAccountBlockCoveredSessionIdsRef,
      accountBlockCoversSessionsRef: heartRateAccountBlockCoversSessionsRef,
      onMessage: setHeartRateMessage,
    },
    preparationHeartRate: {
      players: explorePlayers,
      actionsByRider: monitorHeartRateActionByRider,
      blocks: monitorHeartRateBlocks,
      invitations: monitorHeartRateInvitations,
      now,
      onOpen: setMonitorHeartRateOverlayPlayerId,
    },
  } as const;

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

  const nativeBluetoothFailed = nativeBluetoothStatus.state === 'failed';
  const nativeBluetoothFailureMessage = 'Native Bluetooth could not start. Close and reopen the TrackLab app. If this continues, install the latest app build.';
  const retryNativeBluetooth = async () => {
    const status = await bootstrapNativeBluetooth();
    setNativeBluetoothStatus(status);
  };
  const connectionLabel = (() => {
    if (demoMode) {
      return 'Demo race source online';
    }

    if (bikeConnectionSource === 'bluetooth') {
      if (nativeBluetoothFailed) {
        return 'Native Bluetooth could not start';
      }

      if (!bluetooth.supported) {
        return 'Bluetooth Direct unavailable';
      }

      if (activePlayers.length > 0) {
        return 'Bluetooth Direct online';
      }

      if (bluetooth.connection === 'connecting') {
        return 'Bluetooth Direct pairing';
      }

      return bluetooth.connection === 'open' ? 'Bluetooth Direct paired' : 'Bluetooth Direct ready';
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
      if (nativeBluetoothFailed) {
        return nativeBluetoothFailureMessage;
      }

      if (!bluetooth.supported) {
        return bluetooth.status;
      }

      return activePlayers.length > 0
        ? `${activePlayers.length} live Bluetooth bike${activePlayers.length === 1 ? '' : 's'} connected.`
        : bluetooth.status;
    }

    const bridgeControlStatus = bridge.controlStatus ? ` ${bridge.controlStatus}` : '';

    if (activePlayers.some((player) => player.deviceSource === 'bluetooth')) {
      return `${bluetooth.status} ${bridge.connection === 'open' ? bridge.status : bridge.error ?? bridge.status}${bridgeControlStatus}`;
    }

    return `${bridge.error ?? `${bridge.status} ${bluetooth.status}`}${bridgeControlStatus}`;
  })();
  const bridgeBusy = bridge.sourceState === 'starting' || bridge.sourceState === 'stopping';
  const bridgeRunning = bridge.sourceState === 'running';
  const showLiveBikeUpgrade = () => {
    setCheckoutMessage(selectedClubTrainingMembershipActive && !authenticatedRacerAccess
      ? 'Club bike access is unavailable. The club may be using all purchased bike seats or its membership may need attention.'
      : 'Upgrade to Racer to connect personal Wattbikes.');
    setCheckoutStatus('idle');
    if (!selectedClubTrainingMembershipActive) {
      setShowMembershipLanding(true);
    }
  };
  const showAdvancedConnectorUpgrade = () => {
    setCheckoutMessage('Advanced Connector requires a personal Racer bike membership.');
    setCheckoutStatus('idle');
    setShowMembershipLanding(true);
  };
  const advancedConnectorAccessLocked = !authenticatedRacerAccess || clubMonitorReleasesLocalBikes;
  const bridgeButtonDisabled = advancedConnectorAccessLocked || demoMode || bikeConnectionSource !== 'advanced' || bridge.connection !== 'open' || bridgeBusy;
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
      if (nativeBluetoothFailed) {
        return nativeBluetoothFailureMessage;
      }

      return bluetooth.supported
        ? 'No connector needed. Browser Bluetooth feeds the same BMX gear logic, race engine, monitor, and summaries.'
        : null;
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
      ? nativeBluetoothFailed
        ? 'error'
        : bluetooth.supported
          ? bluetooth.connection === 'connecting' ? 'connecting' : 'idle'
          : 'error'
      : bridge.connection === 'open' && (bridge.sourceState === 'running' || bridge.sourceState === 'starting')
      ? 'connecting'
      : bridge.connection;
  const showBluetoothPairing = !demoMode && bikeConnectionSource === 'bluetooth';
  const pairingEmptyMessage = demoMode
    ? 'Choose demo riders to generate live race samples.'
    : bikeConnectionSource === 'advanced'
      ? 'Start Advanced Connector, put each Wattbike in Just Ride at resistance level 1, then pedal for Bluetooth/ANT+/USB discovery.'
      : nativeBluetoothFailed
        ? nativeBluetoothFailureMessage
        : bluetooth.supported
        ? 'Press Pair Wattbike to authorize a bike. Riders appear only after TrackLab establishes the connection.'
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
  const sessionTrackAvailable = raceWorkspaceMode !== 'straight-sprint' || selectedTrack.countryCode === 'CUSTOM';
  const workflowMapReady = sessionTrackAvailable
    && effectiveTrack.routeStatus === 'user-mapped'
    && straightSprintRouteReady;
  const workflowRaceReady = workflowConnectionReady && workflowRaceEntryReady && workflowMapReady && !startGateStatus.active && raceState !== 'racing';
  const hasStartHereSplitChoices = racePlayers.length > 0 && (effectiveTrack.splitSections?.length ?? 0) > 0;
  const canChooseStartHereSplitLine = raceState !== 'racing' && !startGateStatus.active;
  const canEditLiveRaceEntry = !demoMode && raceState !== 'racing' && !startGateStatus.active;
  const workflowSteps: RaceWorkflowStep[] = [
    {
      kind: 'action',
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
        setAppMode(raceWorkspaceMode);
      },
    },
    {
      kind: 'action',
      label: raceWorkspaceMode === 'straight-sprint' ? 'Pick Sprint' : 'Pick Track',
      detail: sessionTrackAvailable ? selectedTrack.name : 'Create a custom location',
      state: sessionTrackAvailable ? 'complete' : 'next',
      onClick: () => {
        setAppMode(raceWorkspaceMode);
        if (!sessionTrackAvailable) {
          window.setTimeout(() => {
            document.getElementById('custom-route-location-input')?.focus();
          }, 0);
        }
      },
    },
    ...(developerUiActive && sessionTrackAvailable ? [{
      kind: 'action' as const,
      label: 'Map Zones',
      detail: workflowMapReady
        ? raceWorkspaceMode === 'straight-sprint'
          ? `${formatDistanceMeters(
            straightSprintFeetToMeters(straightSprintMappedFeet),
            distanceUnit,
          )} mapped`
          : `${effectiveTrack.zones.length} pedal zone${effectiveTrack.zones.length === 1 ? '' : 's'}`
        : 'Needs layout',
      state: workflowMapReady ? 'complete' as const : 'next' as const,
      onClick: () => {
        setAppMode(raceWorkspaceMode);
        handleMappingModeChange(true);
        setMappingEditMode(workflowMapReady ? 'zones' : 'draw');
      },
    }] : []),
    ...(sessionTrackAvailable && isLoopTrack ? [{
      kind: 'laps' as const,
      state: 'complete',
    }] : []),
    ...(sessionTrackAvailable ? [{
      kind: 'action',
      label: 'Ghost',
      detail: selectedGhostLaps.length > 0
        ? `${selectedGhostLaps.length} selected`
        : availableGhostLaps.length > 0
          ? `${availableGhostLaps.length} available / optional`
          : 'Saved after first finish',
      state: selectedGhostLaps.length > 0 ? 'complete ghost-selected' : 'idle',
      onClick: () => {
        setAppMode(raceWorkspaceMode);
        window.setTimeout(() => {
          document.querySelector('.ghost-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      },
    } as RaceWorkflowStep] : []),
    {
      kind: 'action',
      label: workflowRaceReady
        ? raceState === 'finished'
          ? raceWorkspaceMode === 'straight-sprint' ? 'Sprint Again' : 'Race Again'
          : raceWorkspaceMode === 'straight-sprint'
            ? demoMode ? 'Start Demo Sprint' : 'Start Live Sprint'
            : demoMode ? 'Start Demo Race' : 'Start Live Race'
        : raceWorkspaceMode === 'straight-sprint' ? 'Sprint' : 'Race',
      detail: workflowRaceReady
        ? 'Ready'
        : !sessionTrackAvailable
          ? 'Create sprint first'
          : !workflowMapReady
          ? raceWorkspaceMode === 'straight-sprint' && effectiveTrack.routeStatus === 'user-mapped'
            ? `Map at least ${formatDistanceMeters(straightSprintDistanceMeters, distanceUnit)}`
            : 'Map first'
          : !workflowConnectionReady
            ? 'Connect bike'
            : !workflowRaceEntryReady
              ? 'Choose racer'
            : raceState === 'racing'
              ? 'In progress'
              : 'Ready soon',
      state: workflowRaceReady ? 'next' : raceState === 'racing' ? 'complete' : 'idle',
      primaryAction: workflowRaceReady,
      onPointerDown: workflowRaceReady ? primeRaceAudio : undefined,
      onClick: () => {
        setAppMode(raceWorkspaceMode);
        if (workflowRaceReady) {
          void handleStart();
        }
      },
    },
  ];

  const clubLiveActivity: ClubLiveActivityState = {
    ...(clubTabletRider?.id || accountRider?.id
      ? { accountRiderId: clubTabletRider?.id ?? accountRider?.id }
      : {}),
    appMode,
    explore: exploreClubLiveState,
    getPulled: getPulledLiveState,
    multiplayerActive: playMode === 'multiplayer' && Boolean(multiplayer.currentRoom),
    multiplayerParticipantCount: multiplayer.currentRoom?.racerCount ?? null,
    now,
    race: {
      capture: raceCapture,
      courseLengthMeters: effectiveRouteLengthMeters,
      players: racePlayers,
      riders,
      samplesByDevice,
      startGateActive: startGateStatus.active,
      state: raceState,
      trackName: effectiveTrack.name,
    },
  };
  const clubLiveAthleteBridge = clubLiveProfileKey
    && clubTrainingSelection
    && selectedClubTrainingMembershipActive ? (
      <Suspense fallback={null}>
        <ClubLiveAthleteBridge
          accessActive={clubLiveAccessActive}
          activity={clubLiveActivity}
          demoMode={demoMode}
          profileKey={clubLiveProfileKey}
          selection={clubTrainingSelection}
          tabletSessionActive={clubTabletSessionActive}
          onAccessChange={setClubLiveAccess}
          onAccessStatusChange={setClubLiveAccessStatus}
        />
      </Suspense>
    ) : null;
  const clubTabletRuntime = clubTabletDevice ? (
    <Suspense fallback={null}>
      <ClubTabletRuntime
        key={`${clubTabletDevice.device.id}:${clubTabletAuthorizationRevision}`}
        device={clubTabletDevice}
        roster={clubTabletRoster}
        session={clubTabletSession}
        bikeActivityAt={clubTabletBikeActivityAt}
        onDeviceReady={handleClubTabletDeviceReady}
        onDeviceError={handleClubTabletDeviceError}
        onDeviceRevoked={handleClubTabletDeviceRevoked}
        onSessionRenewed={setClubTabletSession}
        onSessionExpired={handleClubTabletSessionExpired}
        onHeartRateReading={handleClubTabletHeartRateReading}
      />
    </Suspense>
  ) : null;
  const heartRateStudioInviteDialog = heartRateStudioInviteCode ? (
    <Suspense fallback={null}>
      <HeartRateStudioInviteDialog
        authenticated={Boolean(authUser)}
        currentHref={typeof window === 'undefined' ? '' : window.location.href}
        inviteCode={heartRateStudioInviteCode}
        onClose={handleHeartRateStudioInviteClose}
        onConfigureNativeRelay={handleHeartRateStudioRelayConfigure}
        onRequestSignIn={handleHeartRateStudioInviteSignIn}
        open={heartRateStudioInviteOpen}
        platform={heartRate.availability?.platform ?? 'other'}
      />
    </Suspense>
  ) : null;
  const heartRateAccountBlockCoordinator = !clubTabletKioskMode ? (
    <Suspense fallback={null}>
      <HeartRateAccountBlockCoordinator
        authStatus={authStatus}
        accountId={authUser?.id ?? null}
        kioskMode={clubTabletKioskMode}
        settingsOpen={settingsMode && watchConnectCapable === false}
        hydratedAccountId={heartRateHydratedAccountId}
        heartRate={heartRate}
        accountHydrationRef={heartRateAccountHydrationRef}
        activeRelaySessionRef={activeHeartRateRelaySessionRef}
        activePairingIdRef={activeHeartRatePairingIdRef}
        pairingIdsBySessionRef={heartRatePairingIdsBySessionRef}
        knownPairingIdsRef={heartRateKnownPairingIdsRef}
        accountBlocksRef={heartRateAccountBlocksRef}
        activeBlockRef={activeHeartRateAccountBlockRef}
        coversSessionsRef={heartRateAccountBlockCoversSessionsRef}
        observedRelayIdsRef={heartRateAccountBlockObservedRelayIdsRef}
        actionPromiseRef={heartRateAccountBlockActionPromiseRef}
        onMessage={setHeartRateMessage}
        onRequestSignIn={handleHeartRateAccountBlockSignIn}
        onOpenSettings={handleHeartRateAccountBlockOpenSettings}
        onBlockPresenceChange={setHeartRateAccountBlockPresent}
      />
    </Suspense>
  ) : null;
  const watchConnectCoordinator = !clubTabletKioskMode ? (
    <Suspense fallback={null}>
      <WatchConnectCoordinator
        actionPromises={watchConnectActionPromisesRef.current}
        accountId={authUser?.id ?? null}
        accountName={authUser?.name ?? 'TrackLab athlete'}
        authStatus={authStatus}
        heartRate={heartRate}
        latestHeartRate={authUser?.id
          ? liveHeartRateByRider[`account:${authUser.id}`] ?? null
          : null}
        knownPairingIds={heartRateKnownPairingIdsRef.current}
        onAccountLiveHeartRateChange={setWatchConnectAccountHeartRate}
        onCapabilityChange={setWatchConnectCapable}
        onLegacyRelaySuppressionChange={handleLegacyRelaySuppressionChange}
        onLiveHeartRateReadingsChange={setLiveHeartRateByRider}
        onMessage={setHeartRateMessage}
        onOpenSettings={() => handleHeartRateAccountBlockOpenSettings(true)}
        ownedStudio={ownedClub ? { clubId: ownedClub.id, clubName: ownedClub.name } : null}
        settingsOpen={settingsMode}
        preferPersonal={Boolean(ownedClub)}
        studioContext={watchConnectStudioMembership ? {
          clubId: watchConnectStudioMembership.clubId,
          clubName: watchConnectStudioMembership.clubName,
        } : null}
        studioContexts={activeClubTrainingMemberships.map((membership) => ({
          clubId: membership.clubId,
          clubName: membership.clubName,
        }))}
      />
    </Suspense>
  ) : null;
  if (!clubTabletKioskMode && (showMembershipLanding || !accountProfileComplete)) {
    return (
      <>
        {clubLiveAthleteBridge}
        {heartRateStudioInviteDialog}
        {heartRateAccountBlockCoordinator}
        {watchConnectCoordinator}
        <Suspense fallback={<div className="explore-loading">Loading TrackLab…</div>}>
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
          catalogReady={catalogDatabaseReady}
          tracks={baseCatalogTracks}
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
        </Suspense>
      </>
    );
  }

  const analyticsPanel = (
    <Suspense fallback={<div className="panel-section">Loading post-race analysis…</div>}>
      <AnalyticsPanel
        track={effectiveTrack}
        players={racePlayers}
        raceSummary={raceSummary}
        selectedMetrics={selectedMetrics}
        reactionTimesByPlayer={reactionTimesByPlayer}
        speedUnit={speedUnit}
        distanceUnit={distanceUnit}
        activeZones={activeZones}
        raceCapture={raceCapture}
        ghostLaps={availableGhostLaps}
        selectedGhostIds={selectedGhostIds}
        studioRiders={availableStudioRiders}
        sprintConfiguration={raceWorkspaceMode === 'straight-sprint'
          ? { distanceFeet: straightSprintDistanceFeet, airSetting: straightSprintAirSetting }
          : undefined}
        newPersonalRecordsByPlayer={newPersonalRecordsByPlayer}
        onRaceCaptureJsonExport={exportRaceCaptureJson}
        onRaceCaptureCsvExport={exportRaceCaptureCsv}
        onGhostToggle={toggleGhostLap}
        onGhostClear={clearSelectedGhosts}
        heartRateByPlayer={raceHeartRateByPlayer}
      />
    </Suspense>
  );

  return (
    <div
      className={`platform-shell${raceViewFullscreen ? ' race-fullscreen' : ''}${mappingFullscreen ? ' map-fullscreen' : ''}${exploreRideFullscreen ? ' explore-fullscreen' : ''}${utilityFullscreen ? ' utility-fullscreen' : ''}`}
      ref={raceShellRef}
    >
      {utilityFullscreen && <style>{`
        .platform-shell.utility-fullscreen{position:fixed;inset:0;z-index:2147480000;display:block;width:100vw;height:100dvh;min-height:0;overflow:hidden;background:#07100b}
        .utility-fullscreen .sidebar,.utility-fullscreen .platform-topbar{display:none}
        .utility-fullscreen .platform-main{width:100%;height:100%;min-height:0;padding:0;overflow:auto}
        .utility-fullscreen .get-pulled-view,.utility-fullscreen .monitor-panel,.utility-fullscreen .club-live-monitor{width:100%;min-height:100%;box-sizing:border-box}
        .utility-fullscreen .get-pulled-view{grid-template-rows:minmax(0,1fr) auto auto;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:#07100b}
        .utility-fullscreen .get-pulled-hero{height:100%;min-height:0}
        .utility-fullscreen .get-pulled-hero>.pull-sled-scene{height:100%!important;min-height:330px!important}
        .utility-fullscreen .get-pulled-config,.utility-fullscreen .get-pulled-privacy{display:none}
        .utility-fullscreen .monitor-panel,.utility-fullscreen .club-live-monitor{padding:max(14px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))}
        .utility-fullscreen .monitor-grid{min-height:calc(100dvh - 110px)}
      `}</style>}
      {heartRateStudioInviteDialog}
      {heartRateAccountBlockCoordinator}
      {watchConnectCoordinator}
      {!clubTabletKioskMode && (
        raceViewFullscreen || mappingFullscreen || exploreRideFullscreen || utilityFullscreen
      ) && <div className="watch-connect-indicator-slot fullscreen" id="watch-connect-indicator-slot" />}
      {clubOwnerPreparationDialogVisible && (
        <Suspense fallback={null}>
          <ClubOwnerTrainingPreparationDialog
            activityLabel={appMode === 'straight-sprint' ? 'Straight Sprint' : 'BMX Race'}
            clubId={ownedClub?.id}
            detail={clubOwnerRacePreparation.detail}
            heartRateActionsByRider={monitorHeartRateActionByRider}
            heartRateBlocks={monitorHeartRateBlocks}
            heartRateInvitations={monitorHeartRateInvitations}
            now={now}
            onCancel={handleCancel}
            onHeartRateOpen={setMonitorHeartRateOverlayPlayerId}
            onRetry={retryClubOwnerTrainingAction}
            onStart={() => { void handleStart(); }}
            phase={clubOwnerRacePreparation.phase === 'error'
              ? 'error'
              : clubOwnerRacePreparation.phase === 'ready'
                ? 'ready'
                : 'authorizing'}
            retryLabel={clubOwnerRacePreparation.failureStage === 'complete'
              || clubOwnerRacePreparation.failureStage === 'activate'
              ? 'Retry athlete save'
              : 'Retry preparation'}
            playerIds={clubOwnerRacePreparation.playerIds}
            players={racePlayers}
            watchConnectMode={watchConnectCapable !== false}
            watchConnectStatusByRider={ownerWatchConnectStatusByRider}
          />
        </Suspense>
      )}
      {watchConnectCapable === false
        && monitorHeartRateOverlayPlayer
        && monitorHeartRateOverlayRiderId
        && ownedClub && (
        <Suspense fallback={<div className="explore-loading">Loading Apple Watch setup…</div>}>
          <StudioHeartRateBlockOverlay
            action={monitorHeartRateOverlayAction}
            anchorContext={{
              appMode,
              monitorSessionId: monitorReservedSessionByPlayer[monitorHeartRateOverlayPlayer.id],
              group: clubOwnerTrainingGroupRef.current,
              preparation: clubOwnerRacePreparation,
            }}
            blocks={monitorHeartRateBlocks}
            clubId={ownedClub.id}
            invitations={monitorHeartRateInvitations}
            invitationSecretAvailable={Boolean(monitorHeartRateOverlaySecret)}
            now={now}
            onCancel={() => { void handleMonitorHeartRateCancel(monitorHeartRateOverlayRiderId); }}
            onClose={() => setMonitorHeartRateOverlayPlayerId(null)}
            onCopy={() => { void handleMonitorHeartRateCopy(monitorHeartRateOverlayRiderId); }}
            onCreate={() => { void handleMonitorHeartRateCreate(monitorHeartRateOverlayPlayer); }}
            onRetry={() => handleMonitorHeartRateRetry(monitorHeartRateOverlayPlayer)}
            onShare={() => { void handleMonitorHeartRateShare(monitorHeartRateOverlayRiderId); }}
            player={monitorHeartRateOverlayPlayer}
          />
        </Suspense>
      )}
      {clubLiveAthleteBridge}
      {clubTabletRuntime}
      {clubTabletSessionActive
        && appMode !== 'club-tablet'
        && (raceViewFullscreen || exploreRideFullscreen || utilityFullscreen) && (
        <button
          className="race-cancel-overlay"
          type="button"
          onClick={() => void handleClubTabletEndAthlete()}
          style={{
            position: 'fixed',
            top: 'max(70px, calc(env(safe-area-inset-top, 0px) + 70px))',
            right: 'max(14px, calc(env(safe-area-inset-right, 0px) + 14px))',
            left: 'auto',
            zIndex: 2147483001,
          }}
        >
          <TabletSmartphone size={18} /> End athlete session
        </button>
      )}
      {bluetoothPairingOpen && showBluetoothPairing && !liveBikeAccessLocked && !nativeBluetoothFailed && (
        <Suspense fallback={null}>
          <BluetoothPairingDialog
            authorizedCount={bluetooth.authorizedCount}
            busy={bluetooth.connection === 'connecting'}
            connectedDevices={bluetooth.devices}
            liveCount={bluetooth.connectedCount}
            maxPlayers={Math.max(1, liveBikeSeatLimit)}
            onClose={() => setBluetoothPairingOpen(false)}
            onPairBike={bluetooth.connectBike}
            onReconnectSaved={bluetooth.reconnectSavedBikes}
            open
            status={bluetooth.status}
          />
        </Suspense>
      )}
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
              <span>{connectedBikeDisplayCount} / {Math.max(1, liveBikeSeatLimit)} bikes connected</span>
            </div>
          </div>
          <p>{connectionStatus}</p>
          <div
            className={`connection-source-switch${developerUiActive ? '' : ' live-only'}`}
            aria-label="Connection method"
          >
            <button
              className={bikeConnectionSource === 'bluetooth' && !demoMode ? 'selected' : ''}
              type="button"
              onClick={() => handleBikeConnectionSourceChange('bluetooth')}
            >
              <Bluetooth size={15} />
              <span>Bluetooth</span>
            </button>
            {!clubTabletKioskMode && (
              <button
                className={bikeConnectionSource === 'advanced' && !demoMode ? 'selected' : ''}
                type="button"
                aria-label="Advanced Connector"
                onClick={() => handleBikeConnectionSourceChange('advanced')}
              >
                <Usb size={15} />
                <span>Connector</span>
              </button>
            )}
            {developerUiActive && (
              <button
                className={demoMode ? 'selected' : ''}
                type="button"
                onClick={() => handleBikeConnectionSourceChange('demo')}
              >
                <Bike size={15} />
                <span>Demo</span>
              </button>
            )}
          </div>
          {bikeConnectionSource === 'bluetooth' && !demoMode && !clubTabletKioskMode && (
            <button
              className="bluetooth-connect-button"
              type="button"
              onClick={liveBikeAccessLocked ? showLiveBikeUpgrade : () => setBluetoothPairingOpen(true)}
              disabled={clubMonitorReleasesLocalBikes || nativeBluetoothFailed || !bluetooth.supported || bluetooth.connection === 'connecting'}
            >
              <Bluetooth size={16} />
              <span>
                {clubMonitorReleasesLocalBikes
                  ? 'Bikes released for Club Monitor'
                  : liveBikeAccessLocked
                  ? 'Upgrade to Connect'
                  : bluetooth.connection === 'connecting'
                    ? 'Pairing...'
                    : bluetooth.connectedCount > 0
                      ? 'Pair Another Wattbike'
                      : 'Pair Wattbike'}
              </span>
            </button>
          )}
          {bikeConnectionSource === 'advanced' && !demoMode && (
            <div className="bridge-controls">
              {bridge.connection !== 'open' ? (
                <button
                  className="bridge-control-button start"
                  type="button"
                  aria-label={clubMonitorReleasesLocalBikes
                    ? 'Connector unavailable in Club Live Monitor'
                    : advancedConnectorAccessLocked ? 'Upgrade to Connect' : 'Open Mac Connector'}
                  onClick={advancedConnectorAccessLocked ? showAdvancedConnectorUpgrade : openMacConnector}
                  disabled={demoMode || clubMonitorReleasesLocalBikes}
                >
                  <Usb size={16} />
                  <span>{clubMonitorReleasesLocalBikes
                    ? 'Bikes released for Club Monitor'
                    : advancedConnectorAccessLocked ? 'Upgrade to Connect' : 'Open Connector'}</span>
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
                  <span aria-hidden="true">{bridgeRunning ? '■' : '▶'}</span>
                  <span>{bridgeButtonLabel}</span>
                </button>
              )}
              <span className={`bridge-live-pill ${activePlayers.length > 0 ? 'live' : bridgeRunning ? 'waiting' : ''}`}>
                {activePlayers.length > 0 ? 'Bike connected' : bridgeRunning ? 'Scanning' : 'Idle'}
              </span>
            </div>
          )}
          {bridgePrompt && <div className="bridge-prompt">{bridgePrompt}</div>}
          {nativeBluetoothFailed && bikeConnectionSource === 'bluetooth' && !demoMode && (
            <button
              className="bluetooth-connect-button"
              type="button"
              onClick={() => { void retryNativeBluetooth(); }}
            >
              <RefreshCcw size={16} />
              <span>Retry Native Bluetooth</span>
            </button>
          )}
        </section>

        {activeClubTrainingMemberships.length > 0 && (
          <section className="connection-card" aria-label="Training ownership">
            <div className="connection-row">
              <Users size={19} />
              <div>
                <strong>Save this session to</strong>
                <span>Choose before you begin training.</span>
              </div>
            </div>
            <div className="connection-source-switch">
              <button
                className={clubTrainingSelection == null ? 'selected' : ''}
                type="button"
                disabled={startGateStatus.active || raceState === 'racing'}
                onClick={() => setClubTrainingSelection(null)}
              >
                Personal · private to my account
              </button>
              {activeClubTrainingMemberships.map((club) => {
                const selected = clubTrainingSelection?.clubId === club.clubId
                  && clubTrainingSelection.studioRiderId === club.studioRiderId;
                return (
                  <button
                    className={selected ? 'selected club' : 'club'}
                    type="button"
                    disabled={startGateStatus.active || raceState === 'racing'}
                    onClick={() => setClubTrainingSelection({
                      clubId: club.clubId,
                      studioRiderId: club.studioRiderId,
                    })}
                    key={`${club.clubId}:${club.studioRiderId}`}
                  >
                    Training at {club.clubName} · {club.riderName}
                  </button>
                );
              })}
            </div>
            <Suspense fallback={null}>
              <ClubLiveAccessNotice
                accessActive={clubLiveAccessActive}
                accessStatus={clubLiveAccessStatus}
                authenticatedRacerAccess={authenticatedRacerAccess}
                selected={Boolean(clubTrainingSelection)}
              />
            </Suspense>
          </section>
        )}
        {clubTrainingStatus === 'error' && (
          <p className="bridge-prompt">Club Session choices are temporarily unavailable.</p>
        )}

        {appMode === 'club-tablet' ? (
          <section className="sidebar-workflow profile-sidebar-workflow" aria-label="Club Tablet summary">
            <div className="workflow-heading">
              <span>Club Tablet</span>
              <small>{clubTabletSessionActive ? 'Athlete and Wattbike ready' : 'Choose an athlete and bike'}</small>
            </div>
            <div className="workflow-list">
              <div className={`workflow-step ${clubTabletDeviceActive ? 'complete' : 'current'}`}>
                <span className="workflow-index">1</span>
                <span className="workflow-copy"><strong>Authorized tablet</strong><small>{clubTabletDevice?.device.name ?? 'Owner authorization required'}</small></span>
              </div>
              <div className={`workflow-step ${clubTabletSessionActive ? 'complete' : 'current'}`}>
                <span className="workflow-index">2</span>
                <span className="workflow-copy"><strong>Choose athlete</strong><small>{clubTabletRider?.name ?? 'No student selected'}</small></span>
              </div>
            </div>
          </section>
        ) : appMode === 'profile' ? (
          <section className="sidebar-workflow profile-sidebar-workflow" aria-label="My Profile summary">
            <div className="workflow-heading">
              <span>My Profile</span>
              <small>Photo and training history</small>
            </div>
            <div className="workflow-list">
              <div className="workflow-step complete">
                <span className="workflow-index">1</span>
                <span className="workflow-copy"><strong>Account photo</strong><small>Used on rider cards and results</small></span>
              </div>
              <div className="workflow-step complete">
                <span className="workflow-index">2</span>
                <span className="workflow-copy"><strong>Training calendar</strong><small>Review and download every session</small></span>
              </div>
            </div>
          </section>
        ) : settingsMode || appMode === 'friends' || resultsMode ? null : appMode === 'get-pulled' ? (
          <section className="sidebar-workflow explore-sidebar-workflow" aria-label="Get Pulled setup workflow">
            <div className="workflow-heading">
              <span>Get Pulled</span>
              <small>Timed Wattbike sled pull</small>
            </div>
            <div className="workflow-list">
              <div className={`workflow-step ${activePlayers.length > 0 ? 'complete' : 'current'}`}>
                <span className="workflow-index">1</span>
                <span className="workflow-copy"><strong>Connect athlete</strong><small>{activePlayers.length > 0 ? 'Wattbike ready' : 'Pair one Wattbike'}</small></span>
              </div>
              <div className="workflow-step current">
                <span className="workflow-index">2</span>
                <span className="workflow-copy"><strong>Choose pull</strong><small>Time and Wattbike Air 1–10</small></span>
              </div>
              <div className="workflow-step pending">
                <span className="workflow-index">3</span>
                <span className="workflow-copy"><strong>Pull and review</strong><small>Private watts and personal record</small></span>
              </div>
            </div>
          </section>
        ) : appMode === 'explore' ? (
          <section className="sidebar-workflow explore-sidebar-workflow" aria-label="Explore the World setup workflow">
            <div className="workflow-heading">
              <span>Explore the World</span>
              <small>Local or private multiplayer</small>
            </div>
            <div className="workflow-list">
              <div className={`workflow-step ${activePlayers.length > 0 ? 'complete' : 'current'}`}>
                <span className="workflow-index">1</span>
                <span className="workflow-copy">
                  <strong>Connect riders</strong>
                  <small>{activePlayers.length} / {maxPlayers} ready</small>
                </span>
              </div>
              <div className="workflow-step current">
                <span className="workflow-index">2</span>
                <span className="workflow-copy">
                  <strong>Choose two places</strong>
                  <small>Build a bicycle-safe route</small>
                </span>
              </div>
              <div className="workflow-step pending">
                <span className="workflow-index">3</span>
                <span className="workflow-copy">
                  <strong>Pedal together</strong>
                  <small>Maps split automatically</small>
                </span>
              </div>
            </div>
          </section>
        ) : (
        <section
          className="sidebar-workflow"
          aria-label={raceWorkspaceMode === 'straight-sprint'
            ? 'Straight Sprint setup workflow'
            : 'BMX Race Intervals setup workflow'}
        >
          <div className="workflow-heading">
            <span>{raceWorkspaceMode === 'straight-sprint' ? 'Straight Sprint' : 'BMX Race Intervals'}</span>
            <small>{raceWorkspaceMode === 'straight-sprint' ? 'Custom sprint course' : 'Normal session order'}</small>
          </div>
          <div className="workflow-list">
            {workflowSteps.map((step, index) => {
              if (step.kind === 'laps') {
                const lapControlsDisabled = startGateStatus.active || raceState === 'racing';
                return (
                  <div
                    className={`workflow-step workflow-loop-laps ${step.state}`}
                    role="group"
                    aria-label="Loop race lap count"
                    key={`${index}-laps`}
                  >
                    <span className="workflow-index">{index + 1}</span>
                    <span className="workflow-copy">
                      <strong>Number of laps</strong>
                      <span className="workflow-lap-controls">
                        <button
                          type="button"
                          aria-label="Decrease Start Here lap count"
                          title="Decrease laps"
                          onClick={() => setLapCount((current) => Math.max(1, current - 1))}
                          disabled={lapCount <= 1 || lapControlsDisabled}
                        >
                          <span aria-hidden="true">−</span>
                        </button>
                        <span aria-live="polite">
                          <b>{lapCount}</b> {lapCount === 1 ? 'lap' : 'laps'}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase Start Here lap count"
                          title="Increase laps"
                          onClick={() => setLapCount((current) => Math.min(20, current + 1))}
                          disabled={lapCount >= 20 || lapControlsDisabled}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                      </span>
                    </span>
                  </div>
                );
              }

              return (
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
              );
            })}
          </div>
          {!demoMode && !clubTabletKioskMode && (
            <StudioRaceEntry
              players={activePlayers}
              enteredDeviceIds={liveRaceReadyDeviceIds}
              riders={availableStudioRiders}
              accountRiderId={accountRider?.id}
              assignments={studioRiderAssignments}
              canEdit={canEditLiveRaceEntry}
              canManageRiders={canManageActiveStudioRiders}
              watchConnectStatusByRider={watchConnectCapable === true
                ? ownerWatchConnectStatusByRider
                : undefined}
              onToggleEntry={toggleLiveRaceEntry}
              onEnterAll={enterAllLiveRaceBikes}
              onClearEntries={clearLiveRaceEntries}
              onAssignRider={handleStudioRiderAssignment}
              onAddRider={handleStudioRiderAdd}
              onRenameRider={handleStudioRiderRename}
              onPhotoChange={handleStudioRiderPhotoChange}
              onRemoveRider={handleStudioRiderRemove}
            />
          )}
          {hasStartHereSplitChoices && (
            <div className="workflow-split-choice" aria-label="Start Here rider race line choices">
              <div className="workflow-split-choice-heading">
                <span>Race Line</span>
                <small>
                  Pro Set needs {formatSpeedFromKph(proSplitMinimumMph * 1.609344, speedUnit)}+ {speedUnitLabel(speedUnit)} at split
                </small>
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
        )}

        <nav className="side-nav" aria-label="Primary">
          {clubTabletKioskMode ? (
            <>
              <button
                className={appMode === 'club-tablet' ? 'selected' : ''}
                type="button"
                onClick={returnToClubTablet}
              >
                <TabletSmartphone size={17} />
                {appMode === 'club-tablet' ? 'Club Tablet' : 'Return to Club Tablet'}
              </button>
              {clubTabletSessionActive && (
                <>
                  <button className={appMode === 'race' ? 'selected' : ''} type="button" onClick={openBmxRaceIntervals}>
                    <Activity size={17} /> BMX Race Intervals
                  </button>
                  <button className={appMode === 'explore' ? 'selected' : ''} type="button" onClick={() => setAppMode('explore')}>
                    <Compass size={17} /> Explore the World
                  </button>
                  <button className={appMode === 'straight-sprint' ? 'selected' : ''} type="button" onClick={openStraightSprint}>
                    <Route size={17} /> Straight Sprint
                  </button>
                  <button className={appMode === 'get-pulled' ? 'selected' : ''} type="button" onClick={openGetPulled}>
                    <Gauge size={17} /> Get Pulled
                  </button>
                  <button type="button" onClick={() => void handleClubTabletEndAthlete()}>
                    <LogOut size={17} /> End athlete session
                  </button>
                </>
              )}
            </>
          ) : (
          <>
          {!(
            raceViewFullscreen || mappingFullscreen || exploreRideFullscreen || utilityFullscreen
          ) && <div className="watch-connect-indicator-slot" id="watch-connect-indicator-slot" />}
          <button
            className={appMode === 'profile' ? 'selected' : ''}
            type="button"
            onClick={() => {
              setMappingMode(false);
              setAppMode('profile');
            }}
          >
            <UserCircle size={17} />
            My Profile
          </button>
          <button
            className={appMode === 'friends' ? 'selected' : ''}
            type="button"
            onClick={() => {
              setMappingMode(false);
              setAppMode('friends');
            }}
          >
            <UserPlus size={17} />
            Friends
            {pendingFriendRequestCount > 0 && (
              <span className="side-nav-count" style={sideNavCountStyle} aria-label={`${pendingFriendRequestCount} new`}>
                {pendingFriendRequestCount > 99 ? '99+' : pendingFriendRequestCount}
              </span>
            )}
          </button>
          <button
            className={appMode === 'race' && !mappingMode ? 'selected' : ''}
            type="button"
            onClick={openBmxRaceIntervals}
          >
            <Activity size={17} />
            BMX Race Intervals
          </button>
          <button
            className={appMode === 'explore' ? 'selected' : ''}
            type="button"
            onClick={() => {
              setMappingMode(false);
              setAppMode('explore');
            }}
          >
            <Compass size={17} />
            Explore the World
          </button>
          <button
            className={appMode === 'straight-sprint' && !mappingMode ? 'selected' : ''}
            type="button"
            onClick={openStraightSprint}
          >
            <Route size={17} />
            Straight Sprint
          </button>
          <button
            className={appMode === 'get-pulled' ? 'selected' : ''}
            type="button"
            onClick={openGetPulled}
          >
            <Gauge size={17} />
            Get Pulled
          </button>
          <button
            type="button"
            onClick={() => {
              setAppMode(raceWorkspaceMode);
              window.setTimeout(() => document.querySelector('.platform-topbar')?.scrollIntoView({ behavior: 'smooth' }), 0);
            }}
          >
            <MapPinned size={17} />
            Track
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
          <button
            className={resultsMode ? 'selected' : ''}
            type="button"
            onClick={() => {
              if (raceWorkspaceActive) {
                document.querySelector('.analytics-panel')?.scrollIntoView();
              } else {
                setAppMode('results');
              }
            }}
          >
            <BarChart3 size={17} />
            Results
          </button>
          <button
            className={sidebarMoreOpen || settingsMode ? 'selected' : ''}
            type="button"
            aria-expanded={sidebarMoreOpen}
            onClick={() => setSidebarMoreOpen((open) => !open)}
          >
            <Settings size={17} />
            More
          </button>
          {sidebarMoreOpen && (
            <div className="side-nav-more">
              <button type="button" onClick={handleHeartRateAccountBlockOpenSettings}>
                <Settings size={17} /> Settings
              </button>
              <button type="button" onClick={() => handleHeartRateAccountBlockOpenSettings(true)}>
                Watch Connect
              </button>
              <button type="button" onClick={() => setShowMembershipLanding(true)}>
                <span aria-hidden="true">◎</span> Community
              </button>
              <button type="button" onClick={openTrackLocator}>
                <MapPinned size={17} /> Track Locator
              </button>
              <button className={appMode === 'monitor' ? 'selected' : ''} type="button" onClick={() => openFullscreenUtility('monitor')}>
                <Gauge size={17} /> Live Monitor
              </button>
              {clubOwnerActive && (
                <>
                  <button className={clubMonitorReleasesLocalBikes ? 'selected' : ''} type="button" onClick={() => openFullscreenUtility('club-monitor')}>
                    <Radio size={17} /> Club Live Monitor
                  </button>
                  <button className={appMode === 'club-tablet' ? 'selected' : ''} type="button" onClick={() => setAppMode('club-tablet')}>
                    <TabletSmartphone size={17} /> Club Tablets
                  </button>
                </>
              )}
              <button className={appMode === 'diagnostics' ? 'selected' : ''} type="button" onClick={() => setAppMode('diagnostics')}>
                <Settings size={17} /> Bike Check
              </button>
              {developerUiActive && (
                <>
                  <button
                    className={mappingMode ? 'selected' : ''}
                    type="button"
                    onClick={() => {
                      setAppMode(raceWorkspaceMode);
                      handleMappingModeChange(true);
                    }}
                  >
                    <Route size={17} /> Tracks & Maps
                  </button>
                  <button className={appMode === 'developer' ? 'selected' : ''} type="button" onClick={() => setAppMode('developer')}>
                    <span aria-hidden="true">&lt;/&gt;</span> Developer Tools
                  </button>
                </>
              )}
            </div>
          )}
          </>
          )}
        </nav>

        {!clubTabletKioskMode && <section className="membership-mini-card">
          <RiderAvatar
            name={authUser?.name ?? 'TrackLab rider'}
            photoUrl={accountProfile.photoUrl}
            accent="#7ade36"
          />
          <span className="eyebrow">Membership</span>
          <strong>{membershipLabel}</strong>
          <p>{membership.tier === 'racer' ? 'Live Wattbike racing unlocked.' : 'Live viewing access.'}</p>
          <small>{authUser ? `${authUser.name} / ${authUser.email}` : 'Signed out'}</small>
          <button type="button" onClick={() => setShowMembershipLanding(true)}>
            {membership.tier === 'racer' ? 'Manage Access' : 'Upgrade'}
          </button>
          <button type="button" onClick={handleSignOut}>
            Sign Out
          </button>
        </section>}

        {!clubTabletKioskMode && <PairingRail
          players={pairingPlayers}
          samplesByDevice={samplesByDevice}
          devices={demoMode ? undefined : connectedBikeDevices}
          onAssign={demoMode ? () => undefined : assignDevice}
          onAutoAssign={demoMode ? () => undefined : autoAssign}
          onRename={demoMode ? renameDemoPlayer : renamePlayer}
          onPhotoChange={demoMode ? handleDemoRiderPhotoChange : undefined}
          onBluetoothConnect={showBluetoothPairing && !liveBikeAccessLocked && !nativeBluetoothFailed ? () => setBluetoothPairingOpen(true) : undefined}
          bluetoothSupported={bluetooth.supported}
          bluetoothStatus={bluetooth.status}
          bluetoothDeviceCount={bluetooth.connectedCount}
          title={demoMode ? 'Demo Riders' : 'Connected Bikes'}
          subtitle={demoMode ? `${demoBikeCount} simulated / edit names below` : undefined}
          emptyMessage={pairingEmptyMessage}
          deviceLabel={demoMode ? 'Demo device' : pairingDeviceLabel}
          readOnly={demoMode}
          maxPlayers={Math.max(1, liveBikeSeatLimit)}
          demoRiderCount={demoMode ? demoBikeCount : undefined}
          onDemoRiderCountChange={demoMode ? handleDemoBikeCountChange : undefined}
        />}
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          {appMode === 'club-tablet' ? (
            <div className="explore-topbar-heading">
              <TabletSmartphone size={20} />
              <span>
                <strong>Club Tablet</strong>
                <small>Secure shared-device athlete access</small>
              </span>
            </div>
          ) : appMode === 'profile' ? (
            <div className="explore-topbar-heading">
              <UserCircle size={20} />
              <span>
                <strong>My Profile</strong>
                <small>Your photo, calendar, sessions, and downloads</small>
              </span>
            </div>
          ) : appMode === 'friends' ? (
            <div className="explore-topbar-heading">
              <UserPlus size={20} />
              <span>
                <strong>Friends</strong>
                <small>Find riders, manage requests, and invite people you already know</small>
              </span>
            </div>
          ) : settingsMode ? (
            <div className="explore-topbar-heading">
              <Settings size={20} />
              <span>
                <strong>Settings</strong>
                <small>Your saved display and unit preferences</small>
              </span>
            </div>
          ) : resultsMode ? null : clubMonitorReleasesLocalBikes ? (
            <div className="explore-topbar-heading">
              <Radio size={20} />
              <span>
                <strong>Club Live Monitor</strong>
                <small>Owner-only, read-only athlete training feed</small>
              </span>
            </div>
          ) : appMode === 'explore' ? (
            <div className="explore-topbar-heading">
              <Compass size={20} />
              <span>
                <strong>Explore the World</strong>
                <small>Satellite routes powered by your Wattbike</small>
              </span>
            </div>
          ) : appMode === 'straight-sprint' ? (
            <div className="explore-topbar-heading">
              <Route size={20} />
              <span>
                <strong>Straight Sprint</strong>
                <small>Custom locations and saved sprint routes</small>
              </span>
            </div>
          ) : appMode === 'get-pulled' ? (
            <div className="explore-topbar-heading">
              <Gauge size={20} />
              <span>
                <strong>Get Pulled</strong>
                <small>Timed Wattbike sled pulls at Preski Ranch</small>
              </span>
            </div>
          ) : (
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
          )}

          {adminProfileActive && (
            <label className={`developer-preview-toggle${regularUserPreview ? ' active' : ''}`}>
              <input
                type="checkbox"
                aria-label="Preview regular user interface"
                checked={regularUserPreview}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  if (enabled && demoMode) {
                    handleDemoModeChange(false, 'bluetooth');
                  }
                  setRegularUserPreview(enabled);
                  if (enabled) {
                    openBmxRaceIntervals();
                    setSidebarMoreOpen(false);
                  }
                }}
              />
              <span>
                <strong>Regular user preview</strong>
                <small>{regularUserPreview ? 'Developer tools hidden' : 'Developer view active'}</small>
              </span>
              <b>{regularUserPreview ? 'ON' : 'OFF'}</b>
            </label>
          )}

          {raceWorkspaceActive && (
          <div
            className="race-readiness-strip"
            aria-label={appMode === 'straight-sprint' ? 'Straight Sprint readiness' : 'Race readiness'}
          >
            <span>{connectedBikeDisplayCount} Bike{connectedBikeDisplayCount === 1 ? '' : 's'}</span>
            <span className={workflowMapReady ? 'ready' : ''}>
              {appMode === 'straight-sprint'
                ? workflowMapReady ? 'Sprint Ready' : 'Sprint Pending'
                : workflowMapReady ? 'Track Ready' : 'Track Pending'}
            </span>
            <span>{effectiveTrack.zones.length} Zones</span>
            <span className={raceCommentaryPreferences.enabled ? 'ready' : ''}>
              Commentary {raceCommentaryPreferences.enabled ? 'On' : 'Off'}
            </span>
            <button
              type="button"
              onClick={() => document.querySelector('.earth-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Focus Map
            </button>
          </div>
          )}
        </header>

        {authUser
          && !clubTabletKioskMode
          && !demoMode
          && (raceWorkspaceActive || appMode === 'get-pulled') && (
          <Suspense fallback={null}>
            <RecoveryAlertCoordinator
              accountId={authUser.id}
              mode={appMode}
              raceCapture={raceCapture}
              raceRiders={riders}
              getPulledResult={getPulledLiveState?.result ?? null}
              latestHeartRate={accountLiveHeartRate}
            />
          </Suspense>
        )}

        {appMode === 'club-tablet' ? (
          <Suspense fallback={<div className="explore-loading">Opening Club Tablet…</div>}>
            <ClubTabletMode
              canAuthorize={clubOwnerActive && !clubTabletDevice}
              deviceCredential={clubTabletDevice}
              deviceStatus={clubTabletDeviceStatus}
              accessReady={clubTabletDeviceActive}
              roster={clubTabletRoster}
              sessionCredential={clubTabletSessionActive ? clubTabletSession : null}
              bikes={connectedBikeDevices.map(({ deviceId, label }) => ({ deviceId, label }))}
              bluetoothSupported={bluetooth.supported}
              bluetoothBusy={bluetooth.connection === 'connecting'}
              authorizedBikeCount={bluetooth.authorizedCount}
              nativeBluetoothStatus={nativeBluetoothStatus}
              onDeviceChange={handleClubTabletDeviceChange}
              onRosterChange={handleClubTabletRosterChange}
              onSessionChange={handleClubTabletSessionChange}
              onOpenBikePairing={() => {
                if (!clubTabletDeviceActive || nativeBluetoothFailed || !bluetooth.supported) return;
                setBluetoothPairingOpen(true);
              }}
              onReconnectSavedBikes={async () => {
                await bluetooth.reconnectSavedBikes();
              }}
              onRetryAuthorization={retryClubTabletAuthorization}
              onOpenProgram={(mode) => {
                setMappingMode(false);
                if (mode === 'race') openBmxRaceIntervals();
                else if (mode === 'straight-sprint') openStraightSprint();
                else if (mode === 'get-pulled') openGetPulled();
                else setAppMode('explore');
              }}
            />
          </Suspense>
        ) : appMode === 'friends' && authUser ? (
          <Suspense fallback={<div className="explore-loading">Loading your TrackLab friends…</div>}>
            <FriendsView
              key={authUser.id}
              currentProfileId={authUser.id}
              api={friendsApi}
              distanceUnit={distanceUnit}
              refreshToken={friendNetworkRefreshRevision}
              onPendingCountChange={setPendingFriendRequestCount}
              onFriendGraphChange={handleFriendNetworkChange}
              onRaceGhost={handleRaceFriendGhost}
            />
          </Suspense>
        ) : settingsMode ? (
          <>
            <Suspense fallback={<div className="explore-loading">Loading settings…</div>}>
              <AppSettingsView
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                regionalSpeedUnit={regionalUnits.speedUnit}
                regionalDistanceUnit={regionalUnits.distanceUnit}
                regionCode={regionalUnitRegion}
                cloudStatus={unitPreferencesSyncStatus}
                cloudMessage={unitPreferencesSyncMessage}
                onSpeedUnitChange={handleSpeedUnitChange}
                onDistanceUnitChange={handleDistanceUnitChange}
                onUseRegionalDefaults={handleRegionalUnitDefaults}
              />
            </Suspense>
            {authUser && <div className="app-settings-view">
              <div id="watch" style={{ display: 'grid', gap: 16 }}>
                <div id="heart-rate-account-block-settings-slot" style={{ display: 'contents' }} />
                <div id="watch-connect-settings-slot" style={{ display: 'contents' }} />
                <Suspense fallback={<div className="explore-loading">Checking Apple Watch…</div>}>
                  {watchConnectCapable === false && <HeartRateSettingsCard
                    availability={heartRate.availability}
                    status={heartRate.status}
                    relayState={heartRate.relayState}
                    readingState={heartRate.readingState}
                    latest={heartRate.latest}
                    message={heartRateMessage}
                    showWorkoutActions={false}
                    onStart={() => undefined}
                    onPause={() => undefined}
                    onResume={() => undefined}
                    onEnd={() => undefined}
                    onRetry={() => { void heartRate.refreshAvailability(); }}
                    studioSharing={watchConnectCapable === false
                      && !heartRateAccountBlockPresent
                      && clubTrainingSelection
                      && selectedHeartRateClubName ? {
                      clubName: selectedHeartRateClubName,
                      liveConsent: heartRateStudioConsent.live,
                      sessionConsent: heartRateStudioConsent.session,
                      onLiveConsentChange: (live) => handleHeartRateStudioConsentChange('live', live),
                      onSessionConsentChange: (session) => handleHeartRateStudioConsentChange('session', session),
                    } : undefined}
                  />}
                </Suspense>
              </div>
            </div>}
          </>
        ) : appMode === 'profile' && authUser ? (
          <Suspense fallback={<div className="explore-loading">Loading your profile and training history…</div>}>
          <AccountProfileView
            key={authUser.profileKey}
            name={authUser.name}
            email={authUser.email}
            membershipLabel={membershipLabel}
            profile={accountProfile}
            studioRiders={canManageActiveStudioRiders
              ? activeStudioRiders(activeProfileStudioRiders)
              : []}
            historyRevision={trainingHistoryRevision}
            speedUnit={speedUnit}
            distanceUnit={distanceUnit}
            onPhotoChange={handleAccountPhotoChange}
            onClubProfileComplete={handleClubProfileComplete}
          />
          </Suspense>
        ) : resultsMode ? (
          analyticsPanel
        ) : appMode === 'club-monitor' && clubOwnerActive ? (
          <Suspense fallback={<div className="explore-loading">Opening Club Live Monitor…</div>}>
            <ClubLiveMonitor
              studioRiders={activeStudioRiders(activeProfileStudioRiders)}
              speedUnit={speedUnit}
              distanceUnit={distanceUnit}
              fullscreen={utilityFullscreen}
              onFullscreenChange={handleUtilityFullscreenChange}
            />
          </Suspense>
        ) : appMode === 'get-pulled' ? (
          <Suspense fallback={<div className="explore-loading">Loading Get Pulled…</div>}>
            <ClubOwnerUtilityMode
              {...clubOwnerUtilitySharedProps}
              mode="get-pulled"
              viewProps={{
                demoMode,
                players: activePlayers,
                riders: availableStudioRiders,
                riderAssignments: studioRiderAssignments,
                samplesByDevice,
                speedUnit,
                canAssignRiders: !clubTabletSessionActive,
                onAssignRider: handleStudioRiderAssignment,
                onLiveStateChange: setGetPulledLiveState,
                fullscreen: utilityFullscreen,
                onFullscreenChange: handleUtilityFullscreenChange,
                heartRateByPlayer,
                heartRateMeasurements: heartRate.measurements,
              }}
            />
          </Suspense>
        ) : appMode === 'explore' ? (
          <Suspense fallback={<div className="explore-loading">Loading Explore the World…</div>}>
            <ClubOwnerUtilityMode
              {...clubOwnerUtilitySharedProps}
              mode="explore"
              viewProps={{
                developerMode: developerUiActive,
                players: playMode === 'multiplayer'
                  ? explorePlayers.slice(0, localExploreSeatLimit)
                  : explorePlayers,
                demoPlayerOptions: exploreDemoCandidates,
                selectedDemoPlayerIds,
                liveRiderProfiles: availableStudioRiders,
                liveRiderAssignments: studioRiderAssignments,
                samplesByDevice,
                speedUnit,
                distanceUnit,
                onDistanceUnitChange: handleDistanceUnitChange,
                playMode,
                demoMode,
                multiplayerConnection: multiplayer.connection,
                currentRoom: multiplayer.currentRoom,
                currentUserId: multiplayer.clientId,
                accountProfileKey: exploreRecentRouteHistoryScope.profileKey,
                cloudRecentRoutesEnabled: exploreRecentRouteHistoryScope.cloudEnabled,
                inviteUrl: multiplayer.inviteUrl,
                remoteStates: multiplayer.roomExploreStates,
                voiceEnabled: roomVoice.enabled,
                voiceSupported: roomVoice.supported,
                voiceStatus: roomVoice.status,
                voiceRemoteCount: roomVoice.remoteCount,
                onPlayModeChange: setPlayMode,
                onCreatePrivateRoom: multiplayer.createPrivateRoom,
                onShareInvite: shareMultiplayerInvite,
                onSyncRoute: multiplayer.syncExploreRoute,
                onControlSession: multiplayer.controlExploreSession,
                onSendState: multiplayer.sendExploreState,
                onDemoPlayerSelectionChange: handleDemoPlayerSelectionChange,
                onLiveRiderAssignment: handleStudioRiderAssignment,
                onVoiceStart: roomVoice.start,
                onVoiceStop: roomVoice.stop,
                onDemoRideStatusChange: handleExploreDemoRideStatusChange,
                onLiveStateChange: setExploreClubLiveState,
                fullscreen: exploreRideFullscreen,
                onFullscreenChange: handleExploreFullscreenChange,
                heartRateByPlayer,
              }}
            />
          </Suspense>
        ) : appMode === 'monitor' ? (
          <Suspense fallback={<div className="explore-loading">Loading monitor…</div>}>
            <MonitorView
              players={explorePlayers}
              samplesByDevice={samplesByDevice}
              speedUnit={speedUnit}
              fullscreen={utilityFullscreen}
              onFullscreenChange={handleUtilityFullscreenChange}
              heartRateByPlayer={heartRateByPlayer}
              historyStatusByPlayer={monitorHistoryStatusByPlayer}
              studioHeartRateByPlayer={monitorStudioHeartRateByPlayer}
              onStudioHeartRateOpen={handleMonitorHeartRateOpen}
              onSprintArm={handleMonitorSprintArm}
              onSprintArmCancel={handleMonitorSprintArmCancel}
              onSprintStart={handleMonitorSprintStart}
              onSprintCancel={handleMonitorSprintCancel}
              onSprintComplete={handleMonitorSprintComplete}
            />
          </Suspense>
        ) : appMode === 'diagnostics' ? (
          <Suspense fallback={<div className="explore-loading">Loading diagnostics…</div>}>
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
            customRouteCount={availableCustomRoutes.length}
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
            onOpenMonitor={() => openFullscreenUtility('monitor')}
            />
          </Suspense>
        ) : appMode === 'developer' && developerUiActive ? (
          <Suspense fallback={<div className="explore-loading">Loading developer tools…</div>}>
            <DeveloperToolsPanel />
          </Suspense>
        ) : (
          <>
            <div className="dashboard-grid">
              <div className="dashboard-primary-column">
                <div className="race-canvas-shell">
                  <Suspense fallback={<div className="explore-loading">Loading track view…</div>}>
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
                  raceDistanceMeters={appMode === 'straight-sprint' ? straightSprintDistanceMeters : undefined}
                  raceAirSetting={straightSprintAirSetting}
                  raceViewFullscreen={raceViewFullscreen}
                  startGateActive={startGateStatus.active}
                  startGatePhase={startGateStatus.phase}
                  startGateLabel={startGateStatus.label}
                  startGateDetail={startGateStatus.detail}
                  startGateLightIndex={startGateStatus.lightIndex}
                  startCountdownPaused={startCountdownPaused}
                  canPauseStartCountdown={startCountdownControlsAvailable}
                  roomVoiceVisible={playMode === 'multiplayer' && Boolean(multiplayer.currentRoom)}
                  voiceEnabled={roomVoice.enabled}
                  voiceSupported={roomVoice.supported}
                  voiceStatus={roomVoice.status}
                  voiceRemoteCount={roomVoice.remoteCount}
                  cStartOffsetsByPlayer={cStartOffsetsByPlayer}
                  finishCountdownSeconds={finishCountdownSeconds}
                  reactionTimesByPlayer={reactionTimesByPlayer}
                  newPersonalRecordsByPlayer={newPersonalRecordsByPlayer}
                  heartRateByPlayer={heartRateByPlayer}
                  earthAngle={earthAngle}
                  earthHeading={earthHeading}
                  earthCenter={earthCenter}
                  earthZoom={earthZoom}
                  raceCameraLocked={raceCameraLocked}
                  canEditRaceLayout={developerRaceLayoutActive && !regularUserPreview}
                  riderOverlayPreference={riderOverlaysByTrack[effectiveTrack.id]}
                  activeZones={activeZones}
                  canCancelRace={canCancelRace}
                  mappingMode={mappingMode}
                  mappingFullscreen={mappingFullscreen}
                  mappingEditMode={mappingEditMode}
                  mappingObstacleView3D={mappingObstacleView3D}
                  raceViewMode={appMode === 'straight-sprint' && straightSprintGameArenaAvailable
                    ? straightSprintViewMode
                    : mappingMode
                      ? mappingRaceViewMode
                      : bmxRaceViewMode}
                  mappingRouteVariantId={mappingRouteVariantId}
                  mappingZoneBranchChoice={mappingZoneBranchChoice}
                  draftPoints={draftPoints}
                  draftZoneRoutePoints={draftZoneRidePoints}
                  draftZoneSectionId={draftZoneProSection?.id ?? null}
                  draftZoneMeters={draftZoneMeters}
                  draftZonePoints={draftZonePoints}
                  draftReferenceZones={draftReferenceZones}
                  draftSplitSections={draftSplitSections}
                  draftRouteSplitSections={draftRouteSplitSections}
                  draftSplitBuilder={draftSplitBuilder}
                  onEarthCameraChange={handleEarthCameraChange}
                  onEarthAngleChange={handleEarthAngleChange}
                  onEarthHeadingChange={handleEarthHeadingChange}
                  onRaceCameraLockedChange={handleRaceCameraLockedChange}
                  onRiderOverlayPreferenceChange={handleRiderOverlayPreferenceChange}
                  onRaceFullscreenInteraction={requestRaceFullscreen}
                  onStartCountdownPauseToggle={handleStartCountdownPauseToggle}
                  onStartCountdownForceStart={handleStartCountdownForceStart}
                  onVoiceStart={roomVoice.start}
                  onVoiceStop={roomVoice.stop}
                  onCancelRace={handleCancel}
                  onMappingFullscreenChange={handleMappingFullscreenChange}
                  onMappingObstacleView3DChange={setMappingObstacleView3D}
                  onMappingPathPointAdd={handleMappingPathPointAdd}
                  onMappingPathPointMove={handleMappingPathPointMove}
                  onMappingPathPointRemove={handleMappingPathPointRemove}
                  onMappingZonePointAdd={handleMappingZonePointAdd}
                  onMappingZonePointMove={handleMappingZonePointMove}
                  onMappingZonePointRemove={handleMappingZonePointRemove}
                  onMappingSplitPointAdd={handleMappingSplitPointAdd}
                  onMappingSplitDrawEnd={handleMappingSplitDrawEnd}
                  />
                  </Suspense>
                </div>

                {analyticsPanel}
              </div>

              <div className="dashboard-secondary-column">
                <Suspense fallback={<div className="panel-section">Loading race controls…</div>}>
                  <SessionControlPanel
                  track={effectiveTrack}
                  selectedMetrics={selectedMetrics}
                  speedUnit={speedUnit}
                  distanceUnit={distanceUnit}
                  customRouteName={customRouteName}
                  customRouteLocation={customRouteLocation}
                  customRouteStatus={customRouteStatus}
                  customRoutePredictions={customRoutePredictions}
                  customRoutePredictionStatus={customRoutePredictionStatus}
                  selectedCustomRoutePredictionId={selectedCustomRoutePrediction?.id ?? null}
                  customRoutes={availableCustomRoutes}
                  selectedTrackId={selectedTrack.id}
                  players={racePlayers}
                  demoPlayerOptions={exploreDemoCandidates}
                  selectedDemoPlayerIds={selectedDemoPlayerIds}
                  branchChoicesByPlayer={activeBranchChoicesByPlayer}
                  mappingRouteVariantId={mappingRouteVariantId}
                  mappingZoneBranchChoice={mappingZoneBranchChoice}
                  raceRouteVariantId={raceRouteVariantId}
                  savedRouteVariantIds={savedRouteVariantIds}
                  hasDualStartRoutes={hasDualStartRoutes}
                  isLoopTrack={isLoopTrack}
                  lapCount={lapCount}
                  straightSprintDistanceFeet={straightSprintDistanceFeet}
                  straightSprintAirSetting={straightSprintAirSetting}
                  straightSprintMappedFeet={straightSprintMappedFeet}
                  straightSprintMaximumRouteReady={straightSprintMaximumRouteReady}
                  straightSprintViewMode={straightSprintViewMode}
                  straightSprintGameArenaAvailable={straightSprintGameArenaAvailable}
                  isAdminProfile={developerUiActive}
                  showCustomRoutes={appMode === 'straight-sprint'}
                  sessionTrackAvailable={sessionTrackAvailable}
                  raceState={raceState}
                  activeBikeCount={racePlayers.length}
                  demoMode={demoMode}
                  mappingMode={mappingMode}
                  mappingFullscreen={mappingFullscreen}
                  mappingEditMode={mappingEditMode}
                  mappingObstacleView3D={mappingObstacleView3D}
                  mappingRaceViewMode={mappingRaceViewMode}
                  draftPointCount={draftPoints.length}
                  draftZonePinCount={draftZoneMeters.length}
                  draftZoneCount={allDraftZones.length}
                  draftZones={draftZones}
                  draftZoneRouteLengthMeters={draftZoneRouteLengthMeters}
                  draftZoneStartsAtRouteStart={draftZoneMeters[0] === 0}
                  draftZoneEndsAtRouteFinish={draftZoneMeters.length > 0
                    && Math.abs(draftZoneMeters[draftZoneMeters.length - 1] - draftZoneRouteLengthMeters) < 0.5}
                  draftLengthMeters={draftLengthMeters}
                  draftSplitSections={draftSplitSections}
                  draftSplitBuilder={draftSplitBuilder}
                  draftSplitBuilderStatus={draftSplitBuilderStatus}
                  canSaveDraftSplit={canSaveDraftSplit}
                  hasSavedMapping={Boolean(selectedTrackMapping)}
                  mappingSaveStatus={mappingSaveStatus}
                  mappingSaveMessage={mappingSaveMessage}
                  mappingRestSeconds={mappingRestSeconds}
                  startGateActive={startGateStatus.active}
                  startGateLabel={startGateStatus.label}
                  startGateDetail={startGateStatus.detail}
                  commentaryPreferences={raceCommentaryPreferences}
                  commentarySpeechStatus={raceCommentary.speechStatus}
                  onMetricToggle={toggleMetric}
                  onSpeedUnitChange={handleSpeedUnitChange}
                  onDistanceUnitChange={handleDistanceUnitChange}
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
                  onLapCountChange={(count) => setLapCount(Math.max(1, Math.min(20, Math.round(count))))}
                  onStraightSprintDistanceChange={(feet) => {
                    setStraightSprintDistanceFeet(normalizeStraightSprintDistance(feet));
                    setSelectedGhostIds([]);
                  }}
                  onStraightSprintAirSettingChange={(setting) => {
                    setStraightSprintAirSetting(normalizeStraightSprintAirSetting(setting));
                    setSelectedGhostIds([]);
                  }}
                  onStraightSprintViewModeChange={setStraightSprintViewMode}
                  onDemoModeChange={handleDemoModeChange}
                  onDemoPlayerSelectionChange={handleDemoPlayerSelectionChange}
                  onMappingModeChange={handleMappingModeChange}
                  onMappingFullscreenChange={handleMappingFullscreenChange}
                  onMappingEditModeChange={handleMappingEditModeChange}
                  onMappingObstacleView3DChange={setMappingObstacleView3D}
                  onMappingRaceViewModeChange={setMappingRaceViewMode}
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
                  onMappingRedrawRoute={redrawMappingRoute}
                  onMappingClearZones={clearMappingZones}
                  onMappingZoneRemove={removeMappingZone}
                  onMappingProZoneEndpointAdd={handleMappingProZoneEndpointAdd}
                  onMappingSave={saveMapping}
                  onMappingRemove={removeMapping}
                  onMappingExport={exportMapping}
                  onMappingImport={importMapping}
                  onCommentaryPreferencesChange={handleRaceCommentaryPreferencesChange}
                  onPrimeAudio={primeRaceAudio}
                  onStart={handleStart}
                  onCancel={handleCancel}
                  onReset={handleReset}
                  />
                </Suspense>

                <Suspense fallback={<div className="panel-section">Loading multiplayer…</div>}>
                  <MultiplayerPanel
                  playMode={playMode}
                  connection={multiplayer.connection}
                  status={multiplayer.status}
                  profileKey={multiplayer.profile.guestKey}
                  riderName={multiplayer.profile.name}
                  riderAvailable={multiplayer.profile.available}
                  profileReadOnly={multiplayer.profileReadOnly}
                  currentUserId={multiplayer.clientId}
                  currentRoom={multiplayer.currentRoom}
                  rooms={multiplayer.rooms}
                  onlineRiders={multiplayer.onlineRiders}
                  incomingChallenges={multiplayer.incomingChallenges}
                  incomingMatchInvites={multiplayer.incomingMatchInvites}
                  social={multiplayer.social}
                  inviteUrl={multiplayer.inviteUrl}
                  track={effectiveTrack}
                  speedUnit={speedUnit}
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
                  onOpenFriends={() => {
                    setMappingMode(false);
                    setAppMode('friends');
                  }}
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
                </Suspense>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
