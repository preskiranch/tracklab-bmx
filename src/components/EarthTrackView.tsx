import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Flag,
  Map as MapIcon,
  MapPinned,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Satellite,
  Signal,
  X,
} from 'lucide-react';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { hasGoogleMapsApiKey, trackCenter } from '../lib/googleMaps';
import { formatDistanceMeters, formatReactionTime } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  MappingEditMode,
  PlayerSlot,
  RaceState,
  ReactionTimesByPlayer,
  RouteViewMode,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackZone,
} from '../types';

type EarthTrackViewProps = {
  track: TrackRecord;
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  raceState: RaceState;
  raceViewFullscreen: boolean;
  startGateActive: boolean;
  startGateLightIndex: 0 | 1 | 2 | 3 | null;
  reactionTimesByPlayer: ReactionTimesByPlayer;
  earthAngle: number;
  earthHeading: number;
  routeViewMode: RouteViewMode;
  activeZones: TrackZone[];
  canCancelRace: boolean;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  draftPoints: TrackPoint[];
  draftZoneMeters: number[];
  draftZonePoints: TrackPoint[];
  onEarthCameraChange: (camera: { angle?: number; heading?: number }) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onRouteViewModeChange: (mode: RouteViewMode) => void;
  onCancelRace: () => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingPathPointAdd: (point: TrackPoint) => void;
  onMappingPathPointMove: (index: number, point: TrackPoint) => void;
  onMappingZonePointAdd: (point: TrackPoint) => void;
};

function formatElapsed(milliseconds: number | null) {
  if (milliseconds == null) {
    return '--';
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}

const startTreeLamps = [
  { className: 'red', label: 'Red' },
  { className: 'yellow', label: 'Yellow one' },
  { className: 'yellow', label: 'Yellow two' },
  { className: 'green', label: 'Green' },
] as const;

function StartTreeLight({ activeIndex }: { activeIndex: 0 | 1 | 2 | 3 | null }) {
  return (
    <div className="start-tree-light" aria-label="BMX start tree light">
      {startTreeLamps.map((lamp, index) => (
        <span
          className={`tree-lamp ${lamp.className}${activeIndex === index ? ' active' : ''}`}
          aria-label={lamp.label}
          key={`${lamp.className}-${index}`}
        />
      ))}
    </div>
  );
}

export function EarthTrackView({
  track,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  raceState,
  raceViewFullscreen,
  startGateActive,
  startGateLightIndex,
  reactionTimesByPlayer,
  earthAngle,
  earthHeading,
  routeViewMode,
  activeZones,
  canCancelRace,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  draftPoints,
  draftZoneMeters,
  draftZonePoints,
  onEarthCameraChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onRouteViewModeChange,
  onCancelRace,
  onMappingFullscreenChange,
  onMappingPathPointAdd,
  onMappingPathPointMove,
  onMappingZonePointAdd,
}: EarthTrackViewProps) {
  const googleMapsConfigured = hasGoogleMapsApiKey();
  const center = trackCenter(track);
  const googleEarthUrl = `https://earth.google.com/web/search/${center.lat},${center.lng}`;
  const imageryLabel = 'Google Earth view';
  const routeStatusLabel = track.routeStatus === 'user-mapped'
    ? 'User-mapped ride line'
    : 'Needs manual mapping';

  return (
    <section className="earth-panel">
      <div className="earth-header">
        <div>
          <div className="eyebrow">
            <Satellite size={14} />
            {imageryLabel}
          </div>
          <h2>{track.name}</h2>
          <p>{track.address ?? `${track.state}, ${track.country}`} / {formatDistanceMeters(track.lengthMeters, distanceUnit)} / {track.surface}</p>
        </div>
        <div className="earth-meta">
          <span><MapPinned size={15} /> {track.source}</span>
          <span><MapIcon size={15} /> {track.elevationMeters} m elevation</span>
          <span><Flag size={15} /> {routeStatusLabel}</span>
          <a href={googleEarthUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open Earth
          </a>
        </div>
      </div>

      <div className="earth-stage google-enabled">
        {googleMapsConfigured ? (
          <GoogleMapsTrackLayer
            track={track}
            riders={riders}
            players={players}
            samplesByDevice={samplesByDevice}
            speedUnit={speedUnit}
            distanceUnit={distanceUnit}
            raceViewFullscreen={raceViewFullscreen}
            raceState={raceState}
            earthAngle={earthAngle}
            earthHeading={earthHeading}
            routeViewMode={routeViewMode}
            activeZones={activeZones}
            mappingMode={mappingMode}
            mappingEditMode={mappingEditMode}
            draftPoints={draftPoints}
            draftZoneMeters={draftZoneMeters}
            draftZonePoints={draftZonePoints}
            onEarthCameraChange={onEarthCameraChange}
            onMappingPathPointAdd={onMappingPathPointAdd}
            onMappingPathPointMove={onMappingPathPointMove}
            onMappingZonePointAdd={onMappingZonePointAdd}
          />
        ) : (
          <div className="google-key-required">
            <div>
              <Satellite size={24} />
              <strong>Google API key required</strong>
              <span>Set VITE_GOOGLE_MAPS_API_KEY to load the Google Earth-style satellite view.</span>
            </div>
            <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Google credentials
            </a>
          </div>
        )}

        <div className="google-map-caption">
          {routeViewMode === 'street-view'
            ? 'Google Street View ride camera'
            : track.routeStatus === 'user-mapped'
              ? `${imageryLabel} with saved ride line`
              : imageryLabel}
        </div>

        {canCancelRace && (
          <button className="race-cancel-overlay" type="button" onClick={onCancelRace}>
            <X size={18} />
            Cancel Race
          </button>
        )}

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {earthAngle} deg</span>
          <span>Heading {earthHeading} deg</span>
          <span>{routeViewMode === 'street-view' ? 'Street View' : 'Satellite'}</span>
          <span>
            {mappingMode
              ? `${draftPoints.length} route pt${draftPoints.length === 1 ? '' : 's'}`
              : track.routeStatus === 'user-mapped'
                ? 'Saved ride line'
                : 'No ride line'}
          </span>
          {mappingMode && (
            <span>
              {mappingEditMode === 'navigate' ? 'Move map' : mappingEditMode === 'draw' ? 'Draw path' : 'Add zones'}
            </span>
          )}
          <span>{activeZones.length} active zone{activeZones.length === 1 ? '' : 's'}</span>
        </div>

        {raceViewFullscreen && startGateActive && (
          <StartTreeLight activeIndex={startGateLightIndex} />
        )}

        {mappingMode && raceState !== 'racing' && (
          <div className="map-edit-toolbar" aria-label="Map edit view controls">
            <button
              type="button"
              onClick={() => onMappingFullscreenChange(!mappingFullscreen)}
              aria-label={mappingFullscreen ? 'Exit full screen editing' : 'Full screen editing'}
              title={mappingFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {mappingFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              <span>{mappingFullscreen ? 'Exit' : 'Full screen'}</span>
            </button>
          </div>
        )}

        <div className="map-camera-pad" aria-label="Map camera controls">
          <button
            aria-label="Rotate map left"
            title="Rotate left"
            type="button"
            onClick={() => onEarthHeadingChange((earthHeading + 345) % 360)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            aria-label="Tilt map up"
            title="Tilt up"
            type="button"
            onClick={() => onEarthAngleChange(Math.min(67, earthAngle + 5))}
          >
            <ChevronUp size={16} />
          </button>
          <button
            aria-label="Reset map north"
            title="Reset north"
            type="button"
            onClick={() => onEarthHeadingChange(0)}
          >
            <Compass size={16} />
          </button>
          <button
            aria-label="Tilt map down"
            title="Tilt down"
            type="button"
            onClick={() => onEarthAngleChange(Math.max(0, earthAngle - 5))}
          >
            <ChevronDown size={16} />
          </button>
          <button
            aria-label="Rotate map right"
            title="Rotate right"
            type="button"
            onClick={() => onEarthHeadingChange((earthHeading + 15) % 360)}
          >
            <RotateCw size={16} />
          </button>
        </div>

        <div className="route-view-switch" aria-label="Route view">
          <button
            className={routeViewMode === 'satellite' ? 'selected' : ''}
            type="button"
            onClick={() => onRouteViewModeChange('satellite')}
          >
            Map
          </button>
          <button
            className={routeViewMode === 'street-view' ? 'selected' : ''}
            type="button"
            onClick={() => onRouteViewModeChange('street-view')}
          >
            Street
          </button>
        </div>
      </div>

      <div className="rider-strip">
        {players.length === 0 ? (
          <div className="empty-compact">No live bikes detected. Start pedaling or run the simulator bridge.</div>
        ) : riders.map((rider) => {
          const player = players.find((slot) => slot.id === rider.playerId);
          const sample = player?.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
          const reactionTime = player ? reactionTimesByPlayer[player.id] : null;

          return (
            <div className="rider-stat" style={{ '--player-color': player?.accent ?? '#111827' } as CSSProperties} key={rider.playerId}>
              <span className="player-chip">P{rider.playerId}</span>
              <div>
                <strong>{player?.name ?? `Player ${rider.playerId}`}</strong>
                <span>{Math.round((rider.distance / track.lengthMeters) * 100)}% / rank {rider.rank} / RT {formatReactionTime(reactionTime)}</span>
              </div>
              <div className="rider-stat-live">
                <Signal size={14} />
                <span>{sample ? `${Math.round(sample.signal * 100)}%` : 'Waiting'}</span>
              </div>
              <strong>{formatElapsed(rider.finishedAt)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
