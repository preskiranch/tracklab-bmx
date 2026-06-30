import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Flag,
  Map as MapIcon,
  MapPinned,
  RotateCcw,
  RotateCw,
  Satellite,
  Signal,
} from 'lucide-react';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { hasGoogleMapsApiKey, trackCenter } from '../lib/googleMaps';
import { formatDistanceMeters } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  MappingEditMode,
  PlayerSlot,
  RaceState,
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
  earthAngle: number;
  earthHeading: number;
  activeZones: TrackZone[];
  mappingMode: boolean;
  mappingEditMode: MappingEditMode;
  draftPoints: TrackPoint[];
  draftZoneMeters: number[];
  draftZonePoints: TrackPoint[];
  onEarthCameraChange: (camera: { angle?: number; heading?: number }) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onMappingPathPointAdd: (point: TrackPoint) => void;
  onMappingZonePointAdd: (point: TrackPoint) => void;
};

function formatElapsed(milliseconds: number | null) {
  if (milliseconds == null) {
    return '--';
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}

export function EarthTrackView({
  track,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  raceState,
  earthAngle,
  earthHeading,
  activeZones,
  mappingMode,
  mappingEditMode,
  draftPoints,
  draftZoneMeters,
  draftZonePoints,
  onEarthCameraChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onMappingPathPointAdd,
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
            earthAngle={earthAngle}
            earthHeading={earthHeading}
            activeZones={activeZones}
            mappingMode={mappingMode}
            mappingEditMode={mappingEditMode}
            draftPoints={draftPoints}
            draftZoneMeters={draftZoneMeters}
            draftZonePoints={draftZonePoints}
            onEarthCameraChange={onEarthCameraChange}
            onMappingPathPointAdd={onMappingPathPointAdd}
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
          {track.routeStatus === 'user-mapped' ? `${imageryLabel} with saved ride line` : imageryLabel}
        </div>

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {earthAngle} deg</span>
          <span>Heading {earthHeading} deg</span>
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
      </div>

      <div className="rider-strip">
        {players.length === 0 ? (
          <div className="empty-compact">No live bikes detected. Start pedaling or run the simulator bridge.</div>
        ) : riders.map((rider) => {
          const player = players.find((slot) => slot.id === rider.playerId);
          const sample = player?.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);

          return (
            <div className="rider-stat" style={{ '--player-color': player?.accent ?? '#111827' } as CSSProperties} key={rider.playerId}>
              <span className="player-chip">P{rider.playerId}</span>
              <div>
                <strong>{player?.name ?? `Player ${rider.playerId}`}</strong>
                <span>{Math.round((rider.distance / track.lengthMeters) * 100)}% / rank {rider.rank}</span>
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
