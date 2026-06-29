import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRaceEngine } from './hooks/useRaceEngine';
import { useWattbikeBridge } from './hooks/useWattbikeBridge';
import type {
  AppMode,
  IntervalMode,
  LeaderboardMetric,
  MetricKey,
  PlayerSlot,
  PlayMode,
  SessionMode,
  SpeedUnit,
  TrackRecord,
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

function formatClock() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const bridge = useWattbikeBridge();
  const [initialTrack] = useState(readInitialTrack);
  const [catalogTracks, setCatalogTracks] = useState<TrackRecord[]>(trackCatalog);
  const [players, setPlayers] = useState<PlayerSlot[]>(readStoredPlayers);
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
  const [playMode, setPlayMode] = useState<PlayMode>('local');
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>('rpm');
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 1, author: 'Coach', text: 'Gate cadence looked strong through the first straight.', at: '10:24 AM' },
    { id: 2, author: 'System', text: "Private room opened for today's session.", at: '10:25 AM' },
  ]);

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

  const discoveredDeviceIds = useMemo(
    () => [...bridge.samplesByDevice.keys()].sort((a, b) => a - b),
    [bridge.samplesByDevice],
  );
  const liveDeviceIds = useMemo(
    () => discoveredDeviceIds
      .filter((deviceId) => {
        const sample = bridge.samplesByDevice.get(deviceId);
        return sample && now - sample.at < liveBikeTimeoutMs;
      })
      .slice(0, maxPlayers),
    [bridge.samplesByDevice, discoveredDeviceIds, now],
  );
  const activePlayers = useMemo(
    () => players
      .filter((player) => player.deviceId != null && liveDeviceIds.includes(player.deviceId))
      .slice(0, maxPlayers),
    [liveDeviceIds, players],
  );
  const pairingPlayers = useMemo(
    () => players.slice(0, Math.min(maxPlayers, liveDeviceIds.length)),
    [liveDeviceIds.length, players],
  );
  const activeZones = useMemo(() => {
    if (sessionMode === 'sprint') {
      return selectedTrack.zones;
    }

    if (intervalMode === 'auto') {
      return selectedTrack.zones.filter((zone) => zone.type === 'pedal');
    }

    return selectedTrack.zones.filter((zone) => manualZoneIds.includes(zone.id));
  }, [intervalMode, manualZoneIds, selectedTrack.zones, sessionMode]);
  const { raceState, riders, startRace, resetRace } = useRaceEngine(
    activePlayers,
    bridge.samplesByDevice,
    selectedTrack.lengthMeters,
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(players.map(({ id, deviceId }) => ({ id, deviceId }))));
  }, [players]);

  useEffect(() => {
    window.localStorage.setItem(speedUnitStorageKey, speedUnit);
  }, [speedUnit]);

  useEffect(() => {
    setManualZoneIds((current) => {
      const valid = current.filter((zoneId) => selectedTrack.zones.some((zone) => zone.id === zoneId));
      return valid.length > 0 ? valid : selectedTrack.zones.filter((zone) => zone.type === 'pedal').slice(0, 2).map((zone) => zone.id);
    });
    resetRace();
  }, [resetRace, selectedTrack.id, selectedTrack.zones]);

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
    const assignedLiveDevices = new Set(players.map((player) => player.deviceId).filter(Boolean));
    const needsLiveAssignment = liveDeviceIds.some((deviceId) => !assignedLiveDevices.has(deviceId));
    const staleAssignment = players.some((player) => player.deviceId != null && !liveDeviceIds.includes(player.deviceId));

    if ((needsLiveAssignment || staleAssignment) && liveDeviceIds.length > 0) {
      autoAssign();
    }
  }, [autoAssign, liveDeviceIds, players]);

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

  const connectionLabel = bridge.connection === 'open'
    ? `${bridge.mode.toString().toUpperCase()} bridge online`
    : 'Bridge offline';

  return (
    <div className="platform-shell">
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
            <span className={`connection-dot ${bridge.connection}`} />
            <div>
              <strong>{connectionLabel}</strong>
              <span>{activePlayers.length} / 4 bikes connected</span>
            </div>
          </div>
          <p>{bridge.error ?? bridge.status}</p>
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
          samplesByDevice={bridge.samplesByDevice}
          onAssign={assignDevice}
          onAutoAssign={autoAssign}
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
            samplesByDevice={bridge.samplesByDevice}
            speedUnit={speedUnit}
          />
        ) : (
          <>
            <div className="dashboard-grid">
              <EarthTrackView
                track={selectedTrack}
                riders={riders}
                players={activePlayers}
                samplesByDevice={bridge.samplesByDevice}
                speedUnit={speedUnit}
                raceState={raceState}
                earthAngle={earthAngle}
                activeZones={activeZones}
              />

              <SessionControlPanel
                track={selectedTrack}
                sessionMode={sessionMode}
                intervalMode={intervalMode}
                activeZones={activeZones}
                manualZoneIds={manualZoneIds}
                selectedMetrics={selectedMetrics}
                speedUnit={speedUnit}
                earthAngle={earthAngle}
                raceState={raceState}
                activeBikeCount={activePlayers.length}
                onSessionModeChange={setSessionMode}
                onIntervalModeChange={setIntervalMode}
                onManualZoneToggle={toggleManualZone}
                onMetricToggle={toggleMetric}
                onSpeedUnitChange={setSpeedUnit}
                onEarthAngleChange={setEarthAngle}
                onStart={startRace}
                onReset={resetRace}
              />
            </div>

            <div className="lower-grid">
              <AnalyticsPanel
                track={selectedTrack}
                players={activePlayers}
                riders={riders}
                samplesByDevice={bridge.samplesByDevice}
                selectedMetrics={selectedMetrics}
                leaderboardMetric={leaderboardMetric}
                speedUnit={speedUnit}
                activeZones={activeZones}
                onLeaderboardMetricChange={setLeaderboardMetric}
              />

              <MultiplayerPanel
                playMode={playMode}
                accountsEnabled={accountsEnabled}
                roomCode={`${selectedTrack.countryCode}-${selectedTrack.id.slice(0, 4).toUpperCase()}-${liveDeviceIds.length || 1}24`}
                track={selectedTrack}
                players={activePlayers}
                riders={riders}
                samplesByDevice={bridge.samplesByDevice}
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
