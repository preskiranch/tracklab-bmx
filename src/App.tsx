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
import { defaultPlayerSlots, liveBikeTimeoutMs, maxPlayers, speedUnitStorageKey, storageKey } from './data';
import { countriesForCatalog, statesForCountry, trackCatalog, tracksForLocation } from './data/trackCatalog';
import { primeAudioCues } from './lib/audioCues';
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
import { createDemoPlayers, useDemoBikes } from './hooks/useDemoBikes';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import { useZoneAudioCues } from './hooks/useZoneAudioCues';
import type {
  AppMode,
  IntervalMode,
  LeaderboardMetric,
  MappingEditMode,
  MetricKey,
  PlayerSlot,
  PlayMode,
  SessionMode,
  SpeedUnit,
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

function formatClock() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const bridge = useWattbikeBridge();
  const raceShellRef = useRef<HTMLDivElement | null>(null);
  const [initialTrack] = useState(readInitialTrack);
  const [catalogTracks, setCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [storedMappings, setStoredMappings] = useState<StoredTrackMappings>(readStoredTrackMappings);
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingEditMode, setMappingEditMode] = useState<MappingEditMode>('navigate');
  const [draftPoints, setDraftPoints] = useState<TrackPoint[]>([]);
  const [draftZoneMeters, setDraftZoneMeters] = useState<number[]>([]);
  const [mappingRestSeconds, setMappingRestSeconds] = useState(1);
  const [players, setPlayers] = useState<PlayerSlot[]>(readStoredPlayers);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBikeCount, setDemoBikeCount] = useState(maxPlayers);
  const [demoRaceSeed, setDemoRaceSeed] = useState(() => Date.now());
  const [appMode, setAppMode] = useState<AppMode>('race');
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(readStoredSpeedUnit);
  const [now, setNow] = useState(Date.now());
  const [selectedCountry, setSelectedCountry] = useState(initialTrack.country);
  const [selectedState, setSelectedState] = useState(initialTrack.state);
  const [selectedTrackId, setSelectedTrackId] = useState(initialTrack.id);
  const [sessionMode, setSessionMode] = useState<SessionMode>('sprint');
  const [intervalMode, setIntervalMode] = useState<IntervalMode>('auto');
  const [manualZoneIds, setManualZoneIds] = useState<string[]>(['z2', 'z4']);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['cadence', 'speed', 'power']);
  const [earthAngle, setEarthAngle] = useState(45);
  const [earthHeading, setEarthHeading] = useState(0);
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>('rpm');
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 1, author: 'Coach', text: 'Gate cadence looked strong through the first straight.', at: '10:24 AM' },
    { id: 2, author: 'System', text: "Private room opened for today's session.", at: '10:25 AM' },
  ]);
  const demo = useDemoBikes({ enabled: demoMode, bikeCount: demoBikeCount, raceSeed: demoRaceSeed });

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
  const demoPlayers = useMemo(() => createDemoPlayers(demoBikeCount), [demoBikeCount]);
  const samplesByDevice = demoMode ? demo.samplesByDevice : bridge.samplesByDevice;
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
  const { raceState, riders, startRace, resetRace } = useRaceEngine(
    activePlayers,
    samplesByDevice,
    effectiveTrack.lengthMeters,
  );
  useZoneAudioCues(raceState, riders, activeZones);

  useEffect(() => {
    if (raceState === 'racing' || document.fullscreenElement !== raceShellRef.current) {
      return;
    }

    void document.exitFullscreen?.().catch(() => undefined);
  }, [raceState]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(players.map(({ id, deviceId }) => ({ id, deviceId }))));
  }, [players]);

  useEffect(() => {
    window.localStorage.setItem(speedUnitStorageKey, speedUnit);
  }, [speedUnit]);

  useEffect(() => {
    setManualZoneIds((current) => {
      const valid = current.filter((zoneId) => mappedZones.some((zone) => zone.id === zoneId));
      return valid.length > 0 ? valid : mappedZones.filter((zone) => zone.type === 'pedal').slice(0, 2).map((zone) => zone.id);
    });
    resetRace();
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
  }, [selectedTrack.id]);

  const handleMappingModeChange = (enabled: boolean) => {
    if (enabled && draftPoints.length === 0 && selectedTrackMapping) {
      setDraftPoints(selectedTrackMapping.centerline);
      setDraftZoneMeters(zoneBoundariesFromMapping(selectedTrackMapping));
      setMappingRestSeconds(selectedTrackMapping.restAfterSeconds);
    }

    if (enabled) {
      setMappingEditMode('navigate');
    }

    setMappingMode(enabled);
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
        resetRace();
      } catch (error) {
        console.error(error);
      }
    };
    reader.readAsText(file);
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

  const handleDemoModeChange = (enabled: boolean) => {
    setDemoMode(enabled);
    setDemoRaceSeed(Date.now());
    resetRace();
  };

  const handleDemoBikeCountChange = (count: number) => {
    setDemoBikeCount(Math.max(1, Math.min(maxPlayers, Math.round(count))));
    setDemoRaceSeed(Date.now() + count);
    resetRace();
  };

  const handleReset = () => {
    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 7919);
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
    if (effectiveTrack.routeStatus !== 'user-mapped') {
      return;
    }

    if (demoMode) {
      setDemoRaceSeed((seed) => seed + 104729);
    }

    primeAudioCues();
    if (!document.fullscreenElement) {
      void raceShellRef.current?.requestFullscreen?.().catch(() => undefined);
    }
    startRace();
  };

  const connectionLabel = demoMode
    ? 'DEMO race source online'
    : bridge.connection === 'open'
      ? `${bridge.mode.toString().toUpperCase()} bridge online`
      : 'Bridge offline';
  const connectionStatus = demoMode
    ? `Simulating ${demoBikeCount} bike${demoBikeCount === 1 ? '' : 's'} with ${demo.variableCount} race variables.`
    : bridge.error ?? bridge.status;
  const connectionState = demoMode ? 'open' : bridge.connection;

  return (
    <div className={`platform-shell${raceState === 'racing' ? ' race-fullscreen' : ''}`} ref={raceShellRef}>
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
          title={demoMode ? 'Demo Riders' : 'Bike Pairing'}
          subtitle={demoMode ? `${demoBikeCount} simulated / max 4` : undefined}
          emptyMessage={demoMode ? 'Choose demo riders to generate live race samples.' : undefined}
          deviceLabel={demoMode ? 'Demo device' : 'ANT device'}
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
                raceState={raceState}
                earthAngle={earthAngle}
                earthHeading={earthHeading}
                activeZones={activeZones}
                mappingMode={mappingMode}
                mappingEditMode={mappingEditMode}
                draftPoints={draftPoints}
                draftZonePoints={draftZonePoints}
                onEarthCameraChange={handleEarthCameraChange}
                onMappingPathPointAdd={handleMappingPathPointAdd}
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
                earthAngle={earthAngle}
                earthHeading={earthHeading}
                raceState={raceState}
                activeBikeCount={activePlayers.length}
                demoMode={demoMode}
                demoBikeCount={demoBikeCount}
                demoVariableCount={demo.variableCount}
                mappingMode={mappingMode}
                mappingEditMode={mappingEditMode}
                draftPointCount={draftPoints.length}
                draftZoneCount={draftPoints.length > 1 ? draftZoneMeters.length + 1 : 0}
                hasSavedMapping={Boolean(selectedTrackMapping)}
                mappingRestSeconds={mappingRestSeconds}
                onSessionModeChange={setSessionMode}
                onIntervalModeChange={setIntervalMode}
                onManualZoneToggle={toggleManualZone}
                onMetricToggle={toggleMetric}
                onSpeedUnitChange={setSpeedUnit}
                onEarthAngleChange={setEarthAngle}
                onEarthHeadingChange={setEarthHeading}
                onDemoModeChange={handleDemoModeChange}
                onDemoBikeCountChange={handleDemoBikeCountChange}
                onMappingModeChange={handleMappingModeChange}
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
                samplesByDevice={samplesByDevice}
                selectedMetrics={selectedMetrics}
                leaderboardMetric={leaderboardMetric}
                speedUnit={speedUnit}
                activeZones={activeZones}
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
