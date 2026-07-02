import type { CSSProperties } from 'react';
import {
  Activity,
  Bike,
  CheckCircle2,
  Copy,
  Database,
  Flag,
  Gauge,
  Globe2,
  MapPinned,
  PlayCircle,
  RadioTower,
  Settings,
  Signal,
  StopCircle,
  TestTube2,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { formatDistanceMeters } from '../units';
import type {
  BikeProfile,
  BikeSample,
  BridgeMode,
  BridgeSourceState,
  DistanceUnit,
  PlayerSlot,
  PlayMode,
  RaceCapture,
  TrackRecord,
} from '../types';

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
export type CloudUserDataStatus = 'loading' | 'online' | 'offline';
type DiagnosticSeverity = 'ready' | 'warning' | 'blocked';

type DiagnosticsPanelProps = {
  bridgeConnection: ConnectionState;
  bridgeMode: BridgeMode | 'unknown';
  bridgeSourceState: BridgeSourceState | 'unknown';
  bridgeStatus: string;
  bridgeError: string | null;
  bridgeControlStatus: string | null;
  bridgeBusy: boolean;
  bridgeRunning: boolean;
  bluetoothSupported: boolean;
  bluetoothStatus: string;
  bluetoothConnectedCount: number;
  googleMapsConfigured: boolean;
  cloudStatus: CloudUserDataStatus;
  cloudMessage: string;
  profileKey: string;
  playMode: PlayMode;
  multiplayerConnection: ConnectionState;
  multiplayerStatus: string;
  currentRoomId: string | null;
  inviteUrl: string;
  onlineRiderCount: number;
  track: TrackRecord;
  hasSavedMapping: boolean;
  customRouteCount: number;
  catalogTrackCount: number;
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  bikeProfiles: BikeProfile[];
  maxPlayers: number;
  demoMode: boolean;
  demoBikeCount: number;
  demoVariableCount: number;
  distanceUnit: DistanceUnit;
  raceCapture: RaceCapture | null;
  onStartBridge: () => void;
  onStopBridge: () => void;
  onEnableDemoTest: () => void;
  onEnableMultiplayer: () => void;
  onCreatePrivateRoom: () => void;
  onCopyInvite: () => void;
  onCopyProfileKey: () => void;
  onOpenRace: () => void;
  onOpenMonitor: () => void;
};

function severityLabel(severity: DiagnosticSeverity) {
  if (severity === 'ready') {
    return 'Ready';
  }

  if (severity === 'warning') {
    return 'Needs attention';
  }

  return 'Blocked';
}

function CheckIcon({ severity }: { severity: DiagnosticSeverity }) {
  if (severity === 'ready') {
    return <CheckCircle2 size={19} />;
  }

  if (severity === 'warning') {
    return <TriangleAlert size={19} />;
  }

  return <TriangleAlert size={19} />;
}

function freshSampleCount(players: PlayerSlot[], samplesByDevice: Map<number, BikeSample>) {
  const now = Date.now();
  return players.filter((player) => {
    if (player.deviceId == null) {
      return false;
    }

    const sample = samplesByDevice.get(player.deviceId);
    return Boolean(sample && now - sample.at < 2400);
  }).length;
}

function latestSampleAge(players: PlayerSlot[], samplesByDevice: Map<number, BikeSample>) {
  const latest = players.reduce((latestAt, player) => {
    if (player.deviceId == null) {
      return latestAt;
    }

    const sample = samplesByDevice.get(player.deviceId);
    return sample ? Math.max(latestAt, sample.at) : latestAt;
  }, 0);

  if (latest === 0) {
    return 'No signal';
  }

  const seconds = Math.max(0, Math.round((Date.now() - latest) / 1000));
  return seconds <= 1 ? 'Live now' : `${seconds}s ago`;
}

function formatProfileKey(value: string) {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function DiagnosticsPanel({
  bridgeConnection,
  bridgeMode,
  bridgeSourceState,
  bridgeStatus,
  bridgeError,
  bridgeControlStatus,
  bridgeBusy,
  bridgeRunning,
  bluetoothSupported,
  bluetoothStatus,
  bluetoothConnectedCount,
  googleMapsConfigured,
  cloudStatus,
  cloudMessage,
  profileKey,
  playMode,
  multiplayerConnection,
  multiplayerStatus,
  currentRoomId,
  inviteUrl,
  onlineRiderCount,
  track,
  hasSavedMapping,
  customRouteCount,
  catalogTrackCount,
  players,
  samplesByDevice,
  bikeProfiles,
  maxPlayers,
  demoMode,
  demoBikeCount,
  demoVariableCount,
  distanceUnit,
  raceCapture,
  onStartBridge,
  onStopBridge,
  onEnableDemoTest,
  onEnableMultiplayer,
  onCreatePrivateRoom,
  onCopyInvite,
  onCopyProfileKey,
  onOpenRace,
  onOpenMonitor,
}: DiagnosticsPanelProps) {
  const liveCount = freshSampleCount(players, samplesByDevice);
  const savedBikeCount = bikeProfiles.length;
  const trackReady = track.routeStatus === 'user-mapped';
  const inputReady = demoMode ? demoBikeCount > 0 : liveCount > 0;
  const multiplayerReady = playMode === 'multiplayer' && multiplayerConnection === 'open';
  const checks = [
    {
      id: 'google',
      title: 'Google map',
      detail: googleMapsConfigured ? 'API key present' : 'API key missing',
      severity: googleMapsConfigured ? 'ready' : 'blocked',
      icon: Globe2,
    },
    {
      id: 'track',
      title: 'Track route',
      detail: trackReady ? `${formatDistanceMeters(track.lengthMeters, distanceUnit)} mapped` : 'Needs saved route',
      severity: trackReady ? 'ready' : 'blocked',
      icon: MapPinned,
    },
    {
      id: 'input',
      title: 'Bike input',
      detail: demoMode ? `${demoBikeCount} demo riders active` : `${liveCount}/${Math.max(1, players.length)} live signals`,
      severity: inputReady ? 'ready' : bridgeRunning ? 'warning' : 'blocked',
      icon: Bike,
    },
    {
      id: 'bridge',
      title: 'Local bridge',
      detail: demoMode ? 'Bypassed for demo' : `${bridgeMode.toString().toUpperCase()} / ${bridgeSourceState}`,
      severity: demoMode || bridgeConnection === 'open' ? 'ready' : 'warning',
      icon: RadioTower,
    },
    {
      id: 'multiplayer',
      title: 'Multiplayer',
      detail: multiplayerReady ? currentRoomId ?? 'Online' : playMode === 'multiplayer' ? multiplayerConnection : 'Local mode',
      severity: multiplayerReady ? 'ready' : playMode === 'multiplayer' ? 'warning' : 'warning',
      icon: Users,
    },
    {
      id: 'cloud',
      title: 'Cloud profile',
      detail: cloudStatus === 'online' ? 'Saved data online' : cloudStatus === 'loading' ? 'Syncing profile' : 'Local fallback',
      severity: cloudStatus === 'online' ? 'ready' : 'warning',
      icon: Database,
    },
  ] satisfies Array<{
    id: string;
    title: string;
    detail: string;
    severity: DiagnosticSeverity;
    icon: typeof Activity;
  }>;
  const readyCount = checks.filter((check) => check.severity === 'ready').length;
  const blockedCount = checks.filter((check) => check.severity === 'blocked').length;
  const readinessLabel = blockedCount === 0 ? 'Session ready' : `${blockedCount} blocker${blockedCount === 1 ? '' : 's'}`;
  const canCreateRoom = playMode === 'multiplayer' && multiplayerConnection === 'open';
  const canCopyInvite = Boolean(inviteUrl);

  return (
    <main className="diagnostics-panel">
      <section className="diagnostics-hero">
        <div>
          <div className="eyebrow">
            <Settings size={14} />
            Preflight
          </div>
          <h2>{readinessLabel}</h2>
          <p>{readyCount} of {checks.length} systems ready for this setup.</p>
        </div>
        <div className={`readiness-ring ${blockedCount === 0 ? 'ready' : 'blocked'}`}>
          <strong>{readyCount}/{checks.length}</strong>
          <span>ready</span>
        </div>
      </section>

      <section className="diagnostic-grid" aria-label="System readiness">
        {checks.map(({ id, title, detail, severity, icon: Icon }) => (
          <div className={`diagnostic-card ${severity}`} key={id}>
            <div className="diagnostic-card-head">
              <span><Icon size={18} /></span>
              <CheckIcon severity={severity} />
            </div>
            <strong>{title}</strong>
            <small>{detail}</small>
            <em>{severityLabel(severity)}</em>
          </div>
        ))}
      </section>

      <section className="diagnostics-columns">
        <div className="diagnostics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Input</span>
              <h3>Bike readiness</h3>
            </div>
            <Signal size={18} />
          </div>
          <div className="diagnostic-stat-list">
            <span><strong>{players.length}</strong> staged riders</span>
            <span><strong>{liveCount}</strong> live signals</span>
            <span><strong>{savedBikeCount}</strong> remembered bikes</span>
            <span><strong>{latestSampleAge(players, samplesByDevice)}</strong> latest sample</span>
          </div>
          <p className="diagnostic-note">{bridgeError ?? bridgeControlStatus ?? bridgeStatus}</p>
          <div className="diagnostic-actions">
            <button type="button" onClick={bridgeRunning ? onStopBridge : onStartBridge} disabled={demoMode || bridgeBusy || bridgeConnection !== 'open'}>
              {bridgeRunning ? <StopCircle size={16} /> : <PlayCircle size={16} />}
              {bridgeRunning ? 'Stop bridge' : 'Start bridge'}
            </button>
            <button type="button" onClick={onOpenMonitor}>
              <Gauge size={16} />
              Monitor
            </button>
          </div>
          <div className="diagnostic-minor">
            <span>Bluetooth: {bluetoothSupported ? bluetoothStatus : 'Not available in this browser'}</span>
            <span>BLE bikes: {bluetoothConnectedCount}</span>
          </div>
        </div>

        <div className="diagnostics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Track</span>
              <h3>Route data</h3>
            </div>
            <Flag size={18} />
          </div>
          <div className="diagnostic-track-card">
            <strong>{track.name}</strong>
            <span>{track.city ?? track.state}, {track.country}</span>
            <div>
              <small>{formatDistanceMeters(track.lengthMeters, distanceUnit)}</small>
              <small>{hasSavedMapping ? 'Saved mapping' : track.routeStatus ?? 'Locator only'}</small>
              <small>{track.zones.length} zones</small>
            </div>
          </div>
          <div className="diagnostic-stat-list compact">
            <span><strong>{catalogTrackCount}</strong> locator records</span>
            <span><strong>{customRouteCount}</strong> custom locations</span>
            <span><strong>{raceCapture?.samples.length ?? 0}</strong> last capture samples</span>
          </div>
          <div className="diagnostic-actions">
            <button type="button" onClick={onOpenRace}>
              <MapPinned size={16} />
              Race setup
            </button>
          </div>
        </div>

        <div className="diagnostics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">No-bike lab</span>
              <h3>Demo and multiplayer</h3>
            </div>
            <TestTube2 size={18} />
          </div>
          <div className="diagnostic-stat-list">
            <span><strong>{demoMode ? 'On' : 'Off'}</strong> demo mode</span>
            <span><strong>{demoBikeCount}</strong> demo riders</span>
            <span><strong>{demoVariableCount}</strong> race variables</span>
            <span><strong>{onlineRiderCount}</strong> riders online</span>
          </div>
          <div className="diagnostic-actions stacked">
            <button type="button" onClick={onEnableDemoTest}>
              <Bike size={16} />
              Enable demo test
            </button>
            <button type="button" onClick={onEnableMultiplayer}>
              <Users size={16} />
              Multiplayer online
            </button>
            <button type="button" onClick={onCreatePrivateRoom} disabled={!canCreateRoom}>
              <PlayCircle size={16} />
              Create private room
            </button>
            <button type="button" onClick={onCopyInvite} disabled={!canCopyInvite}>
              <Copy size={16} />
              Copy invite
            </button>
          </div>
          <p className="diagnostic-note">{multiplayerStatus}</p>
        </div>

        <div className="diagnostics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Profile</span>
              <h3>Saved identity</h3>
            </div>
            <Database size={18} />
          </div>
          <div className="profile-key-card">
            <span>Profile key</span>
            <strong>{formatProfileKey(profileKey)}</strong>
            <button type="button" onClick={onCopyProfileKey}>
              <Copy size={15} />
              Copy
            </button>
          </div>
          <p className="diagnostic-note">{cloudMessage}</p>
          <div className="diagnostic-bike-list">
            {bikeProfiles.slice(0, maxPlayers).map((profile) => (
              <span key={profile.deviceId}>
                <i style={{ '--player-color': profile.accent } as CSSProperties} />
                {profile.name}
                <small>{profile.deviceId}</small>
              </span>
            ))}
            {bikeProfiles.length === 0 && <em>No remembered bikes yet</em>}
          </div>
        </div>
      </section>
    </main>
  );
}
