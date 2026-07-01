import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bike,
  Database,
  Gauge,
  Globe2,
  Radio,
  Route,
  Settings,
  Users,
} from 'lucide-react';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { EarthTrackView } from './components/EarthTrackView';
import { type ChatMessage, MultiplayerPanel } from './components/MultiplayerPanel';
import { MonitorView } from './components/MonitorView';
import { PairingRail } from './components/PairingRail';
import { SessionControlPanel } from './components/SessionControlPanel';
import {
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
import { useRaceEngine } from './hooks/useRaceEngine';
import { useBluetoothBikes } from './hooks/useBluetoothBikes';
import { createDemoPlayers, useDemoBikes } from './hooks/useDemoBikes';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import { useZoneAudioCues } from './hooks/useZoneAudioCues';
import type {
  AppMode,
  DistanceUnit,
  IntervalMode,
  LeaderboardMetric,
  MappingEditMode,
  MetricKey,
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

function readStoredPlayers(): PlayerSlot[] {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return defaultPlayerSlots;
    }

    const parsed = JSON.parse(stored) as Array<Pick<PlayerSlot, 'id' | 'deviceId'>>;
    return defaultPlayerSlots.map((slot) => ({
      ...slot,
      deviceId: parsed.find((item) => item.id === slot.id)?.deviceId ?? null,
    }));
  } catch {
    return defaultPlayerSlots;
  }
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

const idleStartGateStatus: StartGateStatus = {
  active: false,
  label: '',
  detail: '',
  lightIndex: null,
};

const startTreeLabels = ['RED', 'YELLOW 1', 'YELLOW 2', 'GREEN'] as const;

function isReactionBikeSample(sample: { cadence: number | null; speedKph: number | null; watts: number }) {
  return (sample.cadence ?? 0) > 0 || (sample.speedKph ?? 0) > 0.1 || sample.watts > 5;
}

export default function App() {
  const bridge = useWattbikeBridge();
  const bluetooth = useBluetoothBikes();
  const raceShellRef = useRef<HTMLDivElement | null>(null);
  const startGateTimeoutsRef = useRef<number[]>([]);
  const capturedSampleKeysRef = useRef<Set<string>>(new Set());
  const [initialTrack] = useState(readInitialTrack);
  const [catalogTracks, setCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [storedMappings, setStoredMappings] = useState<StoredTrackMappings>(readStoredTrackMappings);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingFullscreen, setMappingFullscreen] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneMeters, setDraftZoneMeters] = useState<number[]>([]);
  const [mappingRestSeconds, setMappingRestSeconds] = useState(1);
  const [players, setPlayers] = useState<PlayerSlot[]>(readStoredPlayers);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(maxPlayers);
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
  const [startCadenceMode, setStartCadenceMode] = useState<StartCadenceMode>('countdown');
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [startGateStatus, setStartGateStatus] = useState<StartGateStatus>(idleStartGateStatus);
  const [reactionStartAt, setReactionStartAt] = useState<number | null>(null);
  const [reactionTimesByPlayer, setReactionTimesByPlayer] = useState<ReactionTimesByPlayer>({});
  const [raceCapture, setRaceCapture] = useState<RaceCapture | null>(readStoredRaceCapture);
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [accountsEnabled, setAccountsEnabled] = useState(false);
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
          setCatalogTracks(database.tracks);
        }
      })
      .catch((error: Error) => {
        console.warn(`Using bundled seed catalog: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestedTrackId = new URLSearchParams(window.location.search).get('track');
    const nextTrack = catalogTracks.find((track) => track.id === requestedTrackId)
      ?? catalogTracks.find((track) => track.id === selectedTrackId)
      ?? catalogTracks[0]
      ?? defaultTrack;

    if (nextTrack.id !== selectedTrackId || nextTrack.country !== selectedCountry || nextTrack.state !== selectedState) {
      setSelectedCountry(nextTrack.country);
      setSelectedState(nextTrack.state);
      setSelectedTrackId(nextTrack.id);
    }
  }, [catalogTracks]);

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
  const availablePlayers = demoMode ? demoPlayers : players;

  const discoveredDeviceIds = useMemo(
    () => [...samplesByDevice.keys()].sort((a, b) => a - b),
    [samplesByDevice],
  );
  const liveDeviceIds = useMemo(
    () => discoveredDeviceIds
      .filter((deviceId) => {
        const sample = samplesByDevice.get(deviceId);
        return sample && now - sample.at < liveBikeTimeoutMs;
      })
      .slice(0, maxPlayers),
    [discoveredDeviceIds, now, samplesByDevice],
  );
  const activePlayers = useMemo(
    () => availablePlayers
      .filter((player) => player.deviceId != null && liveDeviceIds.includes(player.deviceId))
      .slice(0, maxPlayers),
    [availablePlayers, liveDeviceIds],
  );
  const pairingPlayers = useMemo(
    () => (demoMode ? demoPlayers : players.slice(0, Math.min(maxPlayers, liveDeviceIds.length))),
    [demoMode, demoPlayers, liveDeviceIds.length, players],
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
  const shellFullscreenActive = raceViewFullscreen || mappingFullscreen;

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
            : current.status;

      return {
        ...current,
        status,
        startedAt: type === 'race-start' ? at : current.startedAt,
        endedAt: type === 'race-finish' || type === 'race-reset' ? at : current.endedAt,
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
    window.localStorage.setItem(storageKey, JSON.stringify(players.map(({ id, deviceId }) => ({ id, deviceId }))));
  }, [players]);

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

  const assignDevice = useCallback((playerId: PlayerSlot['id'], deviceId: number | null) => {
    setPlayers((current) => current.map((player) => (
      player.id === playerId
        ? { ...player, deviceId }
        : player.deviceId === deviceId && deviceId !== null
          ? { ...player, deviceId: null }
          : player
    )));
  }, []);

  const autoAssign = useCallback(() => {
    setPlayers((current) => {
      const assigned = new Set<number>();
      return current.map((player, index) => {
        const existingIsPresent = player.deviceId != null && liveDeviceIds.includes(player.deviceId);
        if (existingIsPresent) {
          assigned.add(player.deviceId as number);
          return player;
        }

        const nextDevice = liveDeviceIds.find((deviceId) => !assigned.has(deviceId));
        if (nextDevice == null || index >= maxPlayers) {
          return { ...player, deviceId: null };
        }

        assigned.add(nextDevice);
        return { ...player, deviceId: nextDevice };
      });
    });
  }, [liveDeviceIds]);

  useEffect(() => {
    if (demoMode) {
      return;
    }

    const assignedLiveDevices = new Set(players.map((player) => player.deviceId).filter(Boolean));
    const needsLiveAssignment = liveDeviceIds.some((deviceId) => !assignedLiveDevices.has(deviceId));
    const staleAssignment = players.some((player) => player.deviceId != null && !liveDeviceIds.includes(player.deviceId));

    if ((needsLiveAssignment || staleAssignment) && liveDeviceIds.length > 0) {
      autoAssign();
    }
  }, [autoAssign, demoMode, liveDeviceIds, players]);

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

  const sendChatMessage = () => {
    const text = chatDraft.trim();
    if (!text) {
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

    return bridge.connection === 'open'
      ? `${bridge.mode.toString().toUpperCase()} bridge online`
      : 'Bridge offline';
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
  const connectionState = demoMode || bluetooth.connectedCount > 0 ? 'open' : bridge.connection;

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
              <span>{activePlayers.length} / 4 bikes connected</span>
            </div>
          </div>
          <p>{connectionStatus}</p>
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
          onBluetoothConnect={demoMode ? undefined : bluetooth.connectBike}
          bluetoothSupported={bluetooth.supported}
          bluetoothStatus={bluetooth.status}
          bluetoothDeviceCount={bluetooth.connectedCount}
          title={demoMode ? 'Demo Riders' : 'Bike Pairing'}
          subtitle={demoMode ? `${demoBikeCount} simulated / max 4` : undefined}
          emptyMessage={demoMode ? 'Choose demo riders to generate live race samples.' : 'Pedal a Wattbike for bridge discovery, or use Bluetooth pairing for BLE bikes.'}
          deviceLabel={demoMode ? 'Demo device' : 'Bike device'}
          readOnly={demoMode}
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
                mappingMode={mappingMode}
                mappingFullscreen={mappingFullscreen}
                mappingEditMode={mappingEditMode}
                draftPoints={draftPoints}
                draftZoneMeters={draftZoneMeters}
                draftZonePoints={draftZonePoints}
                onEarthCameraChange={handleEarthCameraChange}
                onEarthAngleChange={setEarthAngle}
                onEarthHeadingChange={setEarthHeading}
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
                raceState={raceState}
                activeBikeCount={activePlayers.length}
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
                accountsEnabled={accountsEnabled}
                roomCode={`${effectiveTrack.countryCode}-${effectiveTrack.id.slice(0, 4).toUpperCase()}-${activePlayers.length || 1}24`}
                track={effectiveTrack}
                players={activePlayers}
                riders={riders}
                samplesByDevice={samplesByDevice}
                chatMessages={chatMessages}
                chatDraft={chatDraft}
                onPlayModeChange={setPlayMode}
                onAccountsEnabledChange={setAccountsEnabled}
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
