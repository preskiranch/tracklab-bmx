import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bike,
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
  Users,
} from 'lucide-react';
import { AnalyticsPanel } from './components/AnalyticsPanel';
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
  readStoredTrackMappings,
  routeLengthMeters,
  writeStoredTrackMappings,
  type StoredTrackMappings,
  zoneBoundariesFromMapping,
} from './lib/trackMapping';
import {
  fetchLocationPredictions,
  resetPlaceAutocompleteSession,
  resolveLocationText,
  resolvePlacePrediction,
  type PlacePredictionOption,
} from './lib/googleMaps';
import { patchBridgeUserData, readBridgeUserData } from './lib/localBridgeStore';
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
  IntervalMode,
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
  UserTrackMapping,
} from './types';

const defaultTrack = trackCatalog.find((track) => track.id === 'chula-vista-elite-bmx') ?? trackCatalog[0];

function readInitialTrack() {
  try {
    const requestedTrackId = new URLSearchParams(window.location.search).get('track');
    return trackCatalog.find((track) => track.id === requestedTrackId) ?? defaultTrack;
  } catch {
    return defaultTrack;
  }
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
  ];

  const rows = capture.samples.map((sample) => [
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
  ]);

  return [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\n');
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
  return (sample.cadence ?? 0) > 18 || (sample.speedKph ?? 0) > 2 || sample.watts > 10;
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
  const capturedSampleKeysRef = useRef<Set<string>>(new Set());
  const initialUrlTrackSyncedRef = useRef(false);
  const bridgeUserDataLoadedRef = useRef(false);
  const roomTrackApplyRef = useRef<string | null>(null);
  const latestRaceSyncRef = useRef<OutgoingMultiplayerRaceState | null>(null);
  const [initialTrack] = useState(readInitialTrack);
  const [baseCatalogTracks, setBaseCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [customRoutes, setCustomRoutes] = useState<TrackRecord[]>(readStoredCustomRoutes);
  const [storedMappings, setStoredMappings] = useState<StoredTrackMappings>(readStoredTrackMappings);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingFullscreen, setMappingFullscreen] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneMeters, setDraftZoneMeters] = useState<number[]>([]);
  const [mappingRestSeconds, setMappingRestSeconds] = useState(1);
  const [bikeProfiles, setBikeProfiles] = useState<BikeProfile[]>(readStoredBikeProfiles);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(Math.min(4, maxPlayers));
  const [demoRaceSeed, setDemoRaceSeed] = useState(() => Date.now());
  const [demoRaceStartedAt, setDemoRaceStartedAt] = useState<number | null>(null);
  const [demoSignalsStopped, setDemoSignalsStopped] = useState(false);
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
  const [earthAngle, setEarthAngle] = useState(45);
  const [earthHeading, setEarthHeading] = useState(0);
  const [customRouteName, setCustomRouteName] = useState('');
  const [customRouteLocation, setCustomRouteLocation] = useState('');
  const [customRouteStatus, setCustomRouteStatus] = useState<string | null>(null);
  const [customRoutePredictions, setCustomRoutePredictions] = useState<PlacePredictionOption[]>([]);
  const [customRoutePredictionStatus, setCustomRoutePredictionStatus] = useState<string | null>(null);
  const [selectedCustomRoutePrediction, setSelectedCustomRoutePrediction] = useState<PlacePredictionOption | null>(null);
  const [startCadenceMode, setStartCadenceMode] = useState<StartCadenceMode>('countdown');
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [startGateStatus, setStartGateStatus] = useState<StartGateStatus>(idleStartGateStatus);
  const [reactionStartAt, setReactionStartAt] = useState<number | null>(null);
  const [reactionTimesByPlayer, setReactionTimesByPlayer] = useState<ReactionTimesByPlayer>({});
  const [raceCapture, setRaceCapture] = useState<RaceCapture | null>(readStoredRaceCapture);
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>('rpm');
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
        if (!cancelled && Array.isArray(database.tracks) && database.tracks.length > 0) {
          setBaseCatalogTracks(database.tracks);
        }
      })
      .catch((error: Error) => {
        console.warn(`Using bundled seed catalog: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const catalogTracks = useMemo(
    () => [...baseCatalogTracks, ...customRoutes],
    [baseCatalogTracks, customRoutes],
  );

  useEffect(() => {
    const requestedTrackId = initialUrlTrackSyncedRef.current
      ? null
      : new URLSearchParams(window.location.search).get('track');
    const requestedTrack = requestedTrackId ? catalogTracks.find((track) => track.id === requestedTrackId) : undefined;
    const selectedTrackExists = catalogTracks.find((track) => track.id === selectedTrackId);
    const nextTrack = requestedTrack
      ?? selectedTrackExists
      ?? catalogTracks[0]
      ?? defaultTrack;
    initialUrlTrackSyncedRef.current = true;

    if (nextTrack.id !== selectedTrackId || nextTrack.country !== selectedCountry || nextTrack.state !== selectedState) {
      setSelectedCountry(nextTrack.country);
      setSelectedState(nextTrack.state);
      setSelectedTrackId(nextTrack.id);
    }
  }, [catalogTracks, selectedCountry, selectedState, selectedTrackId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('track', selectedTrackId);
    window.history.replaceState(null, '', url);
  }, [selectedTrackId]);

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
  const selectedTrackMapping = storedMappings[selectedTrack.id];
  const effectiveTrack = useMemo(
    () => (selectedTrackMapping ? applyUserTrackMapping(selectedTrack, selectedTrackMapping) : selectedTrack),
    [selectedTrack, selectedTrackMapping],
  );
  const draftZonePoints = useMemo(
    () => draftZoneMeters
      .map((meter) => pointAtRouteMeter(draftPoints, meter))
      .filter((point): point is TrackPoint => point != null),
    [draftPoints, draftZoneMeters],
  );
  const draftLengthMeters = useMemo(
    () => (draftPoints.length > 1 ? routeLengthMeters(draftPoints) : 0),
    [draftPoints],
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
  const { raceState, riders, raceSummary, startRace, resetRace } = useRaceEngine(
    activePlayers,
    samplesByDevice,
    effectiveTrack.lengthMeters,
  );
  useZoneAudioCues(raceState, riders, activeZones);
  const raceViewFullscreen = startGateStatus.active || raceState === 'racing';
  const canCancelRace = startGateStatus.active || raceState === 'racing';
  const shellFullscreenActive = raceViewFullscreen || mappingFullscreen;

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
    setSelectedCountry(roomTrack.country);
    setSelectedState(roomTrack.state);
    setSelectedTrackId(roomTrack.id);
  }, [catalogTracks, multiplayer.currentRoom?.track.id, playMode, selectedTrackId]);

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
            watts: sample?.watts ?? rider.lastWatts,
            cadence: sample?.cadence ?? null,
            speedKph: sample?.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null),
            signal: sample?.signal ?? 0,
            sampleAt: sample?.at ?? null,
          };
        })
        .filter((rider): rider is OutgoingMultiplayerRaceState['riders'][number] => rider != null),
      summary: raceSummary,
    };
  }, [activePlayers, effectiveTrack.id, multiplayer.currentRoom, playMode, raceState, raceSummary, riders, samplesByDevice]);

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
    if (shellFullscreenActive) {
      if (!document.fullscreenElement && raceShellRef.current) {
        void raceShellRef.current.requestFullscreen?.().catch(() => undefined);
      }
      return;
    }

    if (document.fullscreenElement === raceShellRef.current) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, [shellFullscreenActive]);

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
    writeStoredBikeProfiles(bikeProfiles);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      return;
    }

    void patchBridgeUserData({ bikeProfiles }).catch((error: Error) => {
      console.warn(`Could not save bike profiles to TrackLab bridge: ${error.message}`);
    });
  }, [bikeProfiles, bridge.connection]);

  useEffect(() => {
    writeStoredCustomRoutes(customRoutes);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      return;
    }

    void patchBridgeUserData({ customRoutes }).catch((error: Error) => {
      console.warn(`Could not save custom routes to TrackLab bridge: ${error.message}`);
    });
  }, [bridge.connection, customRoutes]);

  useEffect(() => {
    writeStoredTrackMappings(storedMappings);
    if (bridge.connection !== 'open' || !bridgeUserDataLoadedRef.current) {
      return;
    }

    void patchBridgeUserData({ trackMappings: storedMappings }).catch((error: Error) => {
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
  }, [effectiveTrack.id, mappedZones, resetRace]);

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

  const handleCountryChange = (country: string) => {
    const nextState = statesForCountry(country, catalogTracks)[0];
    const nextTrack = tracksForLocation(country, nextState, catalogTracks)[0];
    setSelectedCountry(country);
    setSelectedState(nextState);
    setSelectedTrackId(nextTrack.id);
  };

  const handleStateChange = (state: string) => {
    const nextTrack = tracksForLocation(selectedCountry, state, catalogTracks)[0];
    setSelectedState(state);
    setSelectedTrackId(nextTrack.id);
  };

  const handleTrackChange = (trackId: string) => {
    const nextTrack = catalogTracks.find((track) => track.id === trackId);
    if (!nextTrack) {
      return;
    }

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
    setSelectedCustomRoutePrediction(prediction);
    setCustomRouteLocation(prediction.label);
    setCustomRoutePredictions([]);
    setCustomRoutePredictionStatus('Address selected. Add the custom route to center the map there.');
    setCustomRouteStatus(null);

    if (!customRouteName.trim()) {
      setCustomRouteName(prediction.mainText);
    }
  }, [customRouteName]);

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
      const resolved = selectedCustomRoutePrediction && selectedCustomRoutePrediction.label === location
        ? await resolvePlacePrediction(selectedCustomRoutePrediction)
        : await resolveLocationText(location);
      const customRoute = createCustomRouteRecord(name, resolved.label ?? location, resolved.point);
      setCustomRoutes((current) => {
        const next = [...current, customRoute];
        writeStoredCustomRoutes(next);
        return next;
      });
      setSelectedCountry(customRoute.country);
      setSelectedState(customRoute.state);
      setSelectedTrackId(customRoute.id);
      setCustomRouteName('');
      setCustomRouteLocation('');
      setCustomRoutePredictions([]);
      setCustomRoutePredictionStatus(null);
      setSelectedCustomRoutePrediction(null);
      setCustomRouteStatus('Custom route added. Trace the path and save it.');
      setDraftPoints([]);
      setDraftZoneMeters([]);
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

  useEffect(() => {
    const mapping = storedMappings[selectedTrack.id];
    setDraftPoints(mapping?.centerline ?? []);
    setDraftZoneMeters(mapping ? zoneBoundariesFromMapping(mapping) : []);
    setMappingRestSeconds(mapping?.restAfterSeconds ?? 1);
    setMappingEditMode('navigate');
    setMappingMode(false);
    setMappingFullscreen(false);
  }, [selectedTrack.id]);

  const handleMappingModeChange = (enabled: boolean) => {
    if (enabled && draftPoints.length === 0 && selectedTrackMapping) {
      setDraftPoints(selectedTrackMapping.centerline);
      setDraftZoneMeters(zoneBoundariesFromMapping(selectedTrackMapping));
      setMappingRestSeconds(selectedTrackMapping.restAfterSeconds);
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

  const handleMappingPathPointAdd = useCallback((point: TrackPoint) => {
    setDraftPoints((current) => {
      const previous = current[current.length - 1];
      if (previous && distanceBetweenTrackPoints(previous, point) < 0.75) {
        return current;
      }

      return [...current, point];
    });
  }, []);

  const handleMappingPathPointMove = useCallback((index: number, point: TrackPoint) => {
    setDraftPoints((current) => {
      if (index < 0 || index >= current.length) {
        return current;
      }

      const next = current.map((draftPoint, draftIndex) => (draftIndex === index ? point : draftPoint));
      const nextLength = next.length > 1 ? routeLengthMeters(next) : 0;
      setDraftZoneMeters((currentZones) => currentZones.filter((meter) => meter > 2 && meter < nextLength - 2));
      return next;
    });
  }, []);

  const undoMappingPoint = () => {
    if (mappingEditMode === 'zones') {
      setDraftZoneMeters((current) => current.slice(0, -1));
      return;
    }

    const nextPoints = draftPoints.slice(0, -1);
    const nextLength = nextPoints.length > 1 ? routeLengthMeters(nextPoints) : 0;
    setDraftPoints(nextPoints);
    setDraftZoneMeters((currentZones) => currentZones.filter((meter) => meter < nextLength - 1));
  };

  const clearMappingDraft = () => {
    setDraftPoints([]);
    setDraftZoneMeters([]);
  };

  const updateMappingRestSeconds = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.min(30, Number.isFinite(seconds) ? seconds : 0));
    setMappingRestSeconds(safeSeconds);
  };

  const saveMapping = () => {
    if (draftPoints.length < 2) {
      return;
    }

    const mapping = createUserTrackMapping(selectedTrack, draftPoints, mappingRestSeconds, draftZoneMeters);
    setStoredMappings((current) => {
      const next = { ...current, [selectedTrack.id]: mapping };
      writeStoredTrackMappings(next);
      return next;
    });
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
          setSelectedCountry(importedTrack.country);
          setSelectedState(importedTrack.state);
          setSelectedTrackId(importedTrack.id);
        }

        setDraftPoints(mapping.centerline);
        setDraftZoneMeters(zoneBoundariesFromMapping(mapping));
        setMappingRestSeconds(mapping.restAfterSeconds);
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
      if (draftPoints.length < 2) {
        return current;
      }

      const routeLength = draftPoints.reduce((total, draftPoint, index) => (
        index === 0 ? total : total + distanceBetweenTrackPoints(draftPoints[index - 1], draftPoint)
      ), 0);
      const meter = Math.round(nearestRouteMeter(draftPoints, point));
      if (meter <= 2 || meter >= routeLength - 2 || current.some((boundary) => Math.abs(boundary - meter) < 3)) {
        return current;
      }

      return [...current, meter].sort((a, b) => a - b);
    });
  }, [draftPoints]);

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

  const handleEarthCameraChange = useCallback((camera: { angle?: number; heading?: number }) => {
    if (typeof camera.angle === 'number' && Number.isFinite(camera.angle)) {
      const nextAngle = Math.max(0, Math.min(67, Math.round(camera.angle)));
      setEarthAngle((current) => (current === nextAngle ? current : nextAngle));
    }

    if (typeof camera.heading === 'number' && Number.isFinite(camera.heading)) {
      const nextHeading = ((Math.round(camera.heading) % 360) + 360) % 360;
      setEarthHeading((current) => (current === nextHeading ? current : nextHeading));
    }
  }, []);

  const clearStartGateSequence = useCallback(() => {
    startGateTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startGateTimeoutsRef.current = [];
    stopStartGateAudio();
    setStartGateStatus(idleStartGateStatus);
    setReactionStartAt(null);
    setReactionTimesByPlayer({});
  }, []);

  useEffect(() => () => clearStartGateSequence(), [clearStartGateSequence]);

  const scheduleStartGateStep = useCallback((delayMs: number, action: () => void) => {
    const timeoutId = window.setTimeout(action, delayMs);
    startGateTimeoutsRef.current.push(timeoutId);
  }, []);

  const armReactionTimer = useCallback(() => {
    setReactionStartAt(Date.now());
    setReactionTimesByPlayer({});
  }, []);

  const beginRaceAtGateDrop = useCallback(() => {
    const gateDropAt = Date.now();
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

  const handleDemoModeChange = (enabled: boolean) => {
    clearStartGateSequence();
    setDemoMode(enabled);
    setDemoRaceSeed(Date.now());
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const handleDemoBikeCountChange = (count: number) => {
    clearStartGateSequence();
    setDemoBikeCount(Math.max(1, Math.min(maxPlayers, Math.round(count))));
    setDemoRaceSeed(Date.now() + count);
    setDemoRaceStartedAt(null);
    setDemoSignalsStopped(false);
    resetRace();
  };

  const handleReset = () => {
    appendRaceCaptureEvent('race-reset', 'Race reset');
    clearStartGateSequence();
    if (!demoMode) {
      bridge.sendControlCommand('race-reset');
    }

    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 7919);
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(false);
    }

    resetRace();
  };

  const handleCancel = () => {
    const label = raceState === 'racing'
      ? 'Race cancelled mid-race'
      : 'Race cancelled before gate drop';
    appendRaceCaptureEvent('race-cancel', label);
    clearStartGateSequence();
    setMappingFullscreen(false);

    if (!demoMode) {
      bridge.sendControlCommand('race-reset');
    }

    if (demoMode) {
      setDemoRaceStartedAt(null);
      setDemoSignalsStopped(true);
    }

    resetRace();
  };

  const shareMultiplayerInvite = useCallback(() => {
    if (!multiplayer.inviteUrl) {
      return;
    }

    void navigator.clipboard?.writeText(multiplayer.inviteUrl).catch(() => {
      window.prompt('Copy this TrackLab room invite link:', multiplayer.inviteUrl);
    });
  }, [multiplayer.inviteUrl]);

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

    setSelectedCountry(nextTrack.country);
    setSelectedState(nextTrack.state);
    setSelectedTrackId(nextTrack.id);
    void multiplayer.syncTrack(nextTrack);
  }, [catalogTracks, multiplayer.syncTrack]);

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

  const handleStart = () => {
    if (effectiveTrack.routeStatus !== 'user-mapped' || startGateStatus.active || raceState === 'racing') {
      return;
    }

    clearStartGateSequence();
    setMappingFullscreen(false);
    setDemoSignalsStopped(false);
    createRaceCapture();
    if (!demoMode) {
      bridge.sendControlCommand('race-arm');
    }

    primeAudioCues();
    if (!document.fullscreenElement) {
      void raceShellRef.current?.requestFullscreen?.().catch(() => undefined);
    }

    if (startCadenceMode === 'uci') {
      const randomDelayMs = 100 + Math.round(Math.random() * 2600);
      const firstToneAtMs = uciVoiceWatchGateOffsetMs + randomDelayMs;

      setStartGateStatus({
        active: true,
        label: 'OK RIDERS',
        detail: 'UCI random start voice',
        lightIndex: null,
      });
      playUciRandomStartVoice();

      scheduleStartGateStep(3300, () => {
        setStartGateStatus({
          active: true,
          label: 'RIDERS READY',
          detail: 'Watch the gate',
          lightIndex: null,
        });
      });

      scheduleStartGateStep(uciVoiceWatchGateOffsetMs, () => {
        setStartGateStatus({
          active: true,
          label: 'RANDOM DELAY',
          detail: `${(randomDelayMs / 1000).toFixed(2)}s to gate tones`,
          lightIndex: null,
        });
      });

      [0, 120, 240].forEach((offsetMs, index) => {
        scheduleStartGateStep(firstToneAtMs + offsetMs, () => {
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

      scheduleStartGateStep(firstToneAtMs + 360, () => {
        playStartGateTone('uci-green');
        beginRaceAtGateDrop();
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
      beginRaceAtGateDrop();
    });
  };

  const connectionLabel = (() => {
    if (demoMode) {
      return 'DEMO race source online';
    }

    if (bluetooth.connectedCount > 0 && bridge.connection === 'open') {
      return 'ANT+ / Bluetooth inputs online';
    }

    if (bluetooth.connectedCount > 0) {
      return 'Bluetooth bikes online';
    }

    if (bridge.connection !== 'open') {
      return 'Local bridge offline';
    }

    if (bridge.sourceState === 'idle') {
      return 'Local helper online';
    }

    if (bridge.sourceState === 'starting') {
      return 'Starting ANT+ bridge';
    }

    if (bridge.sourceState === 'error') {
      return 'ANT+ bridge error';
    }

    return activePlayers.length > 0
      ? `${livePlayerCount}/${activePlayers.length} bike${activePlayers.length === 1 ? '' : 's'} live`
      : `${bridge.mode.toString().toUpperCase()} bridge scanning`;
  })();
  const connectionStatus = (() => {
    if (demoMode) {
      return `Simulating ${demoBikeCount} bike${demoBikeCount === 1 ? '' : 's'} with ${demo.variableCount} race variables.`;
    }

    const bridgeControlStatus = bridge.controlStatus ? ` ${bridge.controlStatus}` : '';

    if (bluetooth.connectedCount > 0) {
      return `${bluetooth.status} ${bridge.connection === 'open' ? bridge.status : bridge.error ?? bridge.status}${bridgeControlStatus}`;
    }

    return `${bridge.error ?? `${bridge.status} ${bluetooth.status}`}${bridgeControlStatus}`;
  })();
  const bridgeBusy = bridge.sourceState === 'starting' || bridge.sourceState === 'stopping';
  const bridgeRunning = bridge.sourceState === 'running';
  const bridgeButtonDisabled = demoMode || bridge.connection !== 'open' || bridgeBusy;
  const bridgeButtonLabel = bridgeBusy
    ? bridge.sourceState === 'stopping' ? 'Stopping Bridge' : 'Starting Bridge'
    : bridgeRunning ? 'Stop Bridge' : 'Start Local Bridge';
  const bridgePrompt = (() => {
    if (demoMode) {
      return 'Demo mode is generating bike data.';
    }

    if (bridge.connection !== 'open') {
      return 'Start the TrackLab local helper first, then reload this page.';
    }

    if (bridge.sourceState === 'idle') {
      return 'Press Start Local Bridge, then put each Wattbike in Just Ride.';
    }

    if (bridge.sourceState === 'running' && activePlayers.length === 0) {
      return 'Waiting for bike signal. Put each Wattbike in Just Ride and pedal for a few seconds.';
    }

    if (activePlayers.length > 0) {
      return 'Bike signal live. Saved bike IDs will be remembered after refresh.';
    }

    return bridge.status;
  })();
  const connectionState = demoMode || bluetooth.connectedCount > 0 || activePlayers.length > 0
    ? 'open'
    : bridge.connection === 'open' && (bridge.sourceState === 'running' || bridge.sourceState === 'starting')
      ? 'connecting'
      : bridge.connection;
  const showBluetoothPairing = !demoMode && bridge.mode !== 'ant';
  const pairingEmptyMessage = bridge.mode === 'ant'
    ? 'Put each Wattbike in Just Ride and pedal for a few seconds so the ANT+ bridge can detect it.'
    : 'Pedal a Wattbike for bridge discovery, or use Bluetooth pairing for BLE bikes.';
  const pairingDeviceLabel = bridge.mode === 'ant' ? 'ANT+ device' : 'Bike device';

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
          <button type="button">
            <Settings size={17} />
            Settings
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
          title={demoMode ? 'Demo Riders' : 'Bike Pairing'}
          subtitle={demoMode ? `${demoBikeCount} simulated / max ${maxPlayers}` : undefined}
          emptyMessage={demoMode ? 'Choose demo riders to generate live race samples.' : pairingEmptyMessage}
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
        ) : (
          <>
            <div className="dashboard-grid">
              <EarthTrackView
                track={effectiveTrack}
                riders={riders}
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
                activeZones={activeZones}
                canCancelRace={canCancelRace}
                mappingMode={mappingMode}
                mappingFullscreen={mappingFullscreen}
                mappingEditMode={mappingEditMode}
                draftPoints={draftPoints}
                draftZoneMeters={draftZoneMeters}
                draftZonePoints={draftZonePoints}
                onEarthCameraChange={handleEarthCameraChange}
                onEarthAngleChange={setEarthAngle}
                onEarthHeadingChange={setEarthHeading}
                onCancelRace={handleCancel}
                onMappingFullscreenChange={handleMappingFullscreenChange}
                onMappingPathPointAdd={handleMappingPathPointAdd}
                onMappingPathPointMove={handleMappingPathPointMove}
                onMappingZonePointAdd={handleMappingZonePointAdd}
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
                onEarthAngleChange={setEarthAngle}
                onEarthHeadingChange={setEarthHeading}
                onCustomRouteNameChange={setCustomRouteName}
                onCustomRouteLocationChange={handleCustomRouteLocationChange}
                onCustomRoutePredictionSelect={handleCustomRoutePredictionSelect}
                onCustomRouteCreate={handleCustomRouteCreate}
                onDemoModeChange={handleDemoModeChange}
                onDemoBikeCountChange={handleDemoBikeCountChange}
                onStartCadenceModeChange={setStartCadenceMode}
                onCountdownSecondsChange={(seconds) => setCountdownSeconds(Math.max(3, Math.min(6, Math.round(seconds))))}
                onMappingModeChange={handleMappingModeChange}
                onMappingFullscreenChange={handleMappingFullscreenChange}
                onMappingEditModeChange={setMappingEditMode}
                onMappingRestSecondsChange={updateMappingRestSeconds}
                onMappingUndoPoint={undoMappingPoint}
                onMappingClearDraft={clearMappingDraft}
                onMappingSave={saveMapping}
                onMappingRemove={removeMapping}
                onMappingExport={exportMapping}
                onMappingImport={importMapping}
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
                onRiderNameChange={(name) => multiplayer.setProfile({ name })}
                onRiderAvailableChange={(available) => multiplayer.setProfile({ available })}
                onCreatePrivateRoom={multiplayer.createPrivateRoom}
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
