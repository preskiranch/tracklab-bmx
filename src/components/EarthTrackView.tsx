import type { CSSProperties } from 'react';
import { ExternalLink, Flag, Map as MapIcon, MapPinned, Satellite, Signal } from 'lucide-react';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { SatelliteTrackLayer } from './SatelliteTrackLayer';
import { hasGoogleMapsApiKey, trackCenter } from '../lib/googleMaps';
import type { BikeSample, PlayerSlot, RaceState, RiderState, SpeedUnit, TrackPoint, TrackRecord, TrackZone } from '../types';

type EarthTrackViewProps = {
  track: TrackRecord;
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  raceState: RaceState;
  earthAngle: number;
  activeZones: TrackZone[];
  mappingMode: boolean;
  draftPoints: TrackPoint[];
  onMappingPointAdd: (point: TrackPoint) => void;
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
  raceState,
  earthAngle,
  activeZones,
  mappingMode,
  draftPoints,
  onMappingPointAdd,
}: EarthTrackViewProps) {
  const googleMapsConfigured = hasGoogleMapsApiKey();
  const center = trackCenter(track);
  const googleEarthUrl = `https://earth.google.com/web/search/${center.lat},${center.lng}`;
  const imageryLabel = googleMapsConfigured ? 'Google satellite imagery' : 'Esri satellite imagery';
  const routeStatusLabel = track.routeStatus === 'verified'
    ? 'Verified ride line'
    : track.routeStatus === 'user-mapped'
      ? 'User-mapped ride line'
    : track.routeStatus === 'locator-only'
      ? 'Locator-only route'
      : 'Estimated ride line';

  return (
    <section className="earth-panel">
      <div className="earth-header">
        <div>
          <div className="eyebrow">
            <Satellite size={14} />
            {imageryLabel}
          </div>
          <h2>{track.name}</h2>
          <p>{track.address ?? `${track.state}, ${track.country}`} / {track.lengthMeters} m / {track.surface}</p>
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

      <div className={`earth-stage ${googleMapsConfigured ? 'google-enabled' : 'satellite-enabled'}`}>
        {googleMapsConfigured ? (
          <GoogleMapsTrackLayer
            track={track}
            riders={riders}
            players={players}
            samplesByDevice={samplesByDevice}
            speedUnit={speedUnit}
            earthAngle={earthAngle}
            activeZones={activeZones}
            mappingMode={mappingMode}
            draftPoints={draftPoints}
            onMappingPointAdd={onMappingPointAdd}
          />
        ) : (
          <SatelliteTrackLayer
            track={track}
            riders={riders}
            players={players}
            samplesByDevice={samplesByDevice}
            speedUnit={speedUnit}
            raceState={raceState}
            earthAngle={earthAngle}
            activeZones={activeZones}
            mappingMode={mappingMode}
            draftPoints={draftPoints}
            onMappingPointAdd={onMappingPointAdd}
          />
        )}

        <div className="google-map-caption">{imageryLabel} with ride line overlay</div>

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {earthAngle} deg</span>
          <span>{mappingMode ? `${draftPoints.length} draft pin${draftPoints.length === 1 ? '' : 's'}` : 'Ride line'}</span>
          <span>{activeZones.length} active zone{activeZones.length === 1 ? '' : 's'}</span>
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
