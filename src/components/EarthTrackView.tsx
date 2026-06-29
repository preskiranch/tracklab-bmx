import type { CSSProperties } from 'react';
import { Bike, ExternalLink, KeyRound, Map as MapIcon, MapPinned, Satellite, Signal } from 'lucide-react';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { hasGoogleMapsApiKey, trackCenter } from '../lib/googleMaps';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, RaceState, RiderState, SpeedUnit, TrackPoint, TrackRecord, TrackZone } from '../types';

type ProjectedPoint = {
  x: number;
  y: number;
};

type EarthTrackViewProps = {
  track: TrackRecord;
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  raceState: RaceState;
  earthAngle: number;
  activeZones: TrackZone[];
};

const viewWidth = 1000;
const viewHeight = 620;
const padding = 82;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function projectOutline(outline: TrackPoint[]): ProjectedPoint[] {
  const averageLat = outline.reduce((sum, point) => sum + point.lat, 0) / outline.length;
  const lngScale = Math.cos((averageLat * Math.PI) / 180);
  const normalized = outline.map((point) => ({
    x: point.lng * lngScale,
    y: point.lat,
  }));

  const minX = Math.min(...normalized.map((point) => point.x));
  const maxX = Math.max(...normalized.map((point) => point.x));
  const minY = Math.min(...normalized.map((point) => point.y));
  const maxY = Math.max(...normalized.map((point) => point.y));
  const spanX = Math.max(0.000001, maxX - minX);
  const spanY = Math.max(0.000001, maxY - minY);
  const scale = Math.min((viewWidth - padding * 2) / spanX, (viewHeight - padding * 2) / spanY);
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const offsetX = (viewWidth - drawnWidth) / 2;
  const offsetY = (viewHeight - drawnHeight) / 2;

  return normalized.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (maxY - point.y) * scale,
  }));
}

function pathFromPoints(points: ProjectedPoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function segmentLengths(points: ProjectedPoint[]) {
  const lengths: number[] = [];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(total);
  }

  return { lengths, total };
}

function pointAtProgress(points: ProjectedPoint[], progress: number): ProjectedPoint {
  const { lengths, total } = segmentLengths(points);
  const target = total * clamp(progress, 0, 1);
  const segmentIndex = lengths.findIndex((length) => length >= target);

  if (segmentIndex === -1) {
    return points[points.length - 1];
  }

  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const previousLength = segmentIndex === 0 ? 0 : lengths[segmentIndex - 1];
  const segmentLength = Math.max(1, lengths[segmentIndex] - previousLength);
  const localProgress = (target - previousLength) / segmentLength;

  return {
    x: start.x + (end.x - start.x) * localProgress,
    y: start.y + (end.y - start.y) * localProgress,
  };
}

function zonePath(points: ProjectedPoint[], zone: TrackZone, trackLengthMeters: number) {
  const samples = Array.from({ length: 18 }, (_, index) => {
    const t = index / 17;
    const progress = (zone.startMeter + (zone.endMeter - zone.startMeter) * t) / trackLengthMeters;
    return pointAtProgress(points, progress);
  });

  return pathFromPoints(samples);
}

function formatElapsed(milliseconds: number | null) {
  if (milliseconds == null) {
    return '--';
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}

function calculateRiderPosition(rider: RiderState, points: ProjectedPoint[], trackLengthMeters: number) {
  const progress = clamp(rider.distance / trackLengthMeters, 0, 1);
  const point = pointAtProgress(points, progress);

  return {
    ...point,
    progress,
  };
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
}: EarthTrackViewProps) {
  const projected = projectOutline(track.outline);
  const path = pathFromPoints(projected);
  const tilt = clamp(72 - earthAngle, 4, 54);
  const googleMapsConfigured = hasGoogleMapsApiKey();
  const center = trackCenter(track);
  const googleEarthUrl = `https://earth.google.com/web/search/${center.lat},${center.lng}`;

  return (
    <section className="earth-panel">
      <div className="earth-header">
        <div>
          <div className="eyebrow">
            <Satellite size={14} />
            {googleMapsConfigured ? 'Google satellite imagery' : 'Google imagery required'}
          </div>
          <h2>{track.name}</h2>
          <p>{track.state}, {track.country} / {track.lengthMeters} m / {track.surface}</p>
        </div>
        <div className="earth-meta">
          <span><MapPinned size={15} /> {track.source}</span>
          <span><MapIcon size={15} /> {track.elevationMeters} m elevation</span>
          <a href={googleEarthUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open Earth
          </a>
        </div>
      </div>

      <div className={`earth-stage ${googleMapsConfigured ? 'google-enabled' : 'google-missing'}`}>
        {googleMapsConfigured ? (
          <GoogleMapsTrackLayer
            track={track}
            riders={riders}
            players={players}
            samplesByDevice={samplesByDevice}
            speedUnit={speedUnit}
            earthAngle={earthAngle}
            activeZones={activeZones}
          />
        ) : (
          <div className="google-required-card">
            <KeyRound size={28} />
            <strong>Google Earth imagery is not configured.</strong>
            <p>Add `VITE_GOOGLE_MAPS_API_KEY` in local `.env` or Render environment variables to show the real satellite/Google imagery layer for this track.</p>
            <a href={googleEarthUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Open this track in Google Earth
            </a>
          </div>
        )}

        {!googleMapsConfigured && (
          <div
            className="earth-map-plane outline-only"
            style={{ transform: `rotateX(${tilt}deg) rotateZ(-8deg)` }}
          >
            <svg className="track-svg" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={`${track.name} GPS outline`}>
              <path className="track-shadow" d={path} />
              <path className="track-base" d={path} />
              <path className="track-centerline" d={path} />
              {activeZones.map((zone) => (
                <path
                  className={`zone-stroke zone-${zone.type}`}
                  d={zonePath(projected, zone, track.lengthMeters)}
                  key={zone.id}
                />
              ))}
              <circle className="start-dot" cx={projected[0].x} cy={projected[0].y} r="10" />
            </svg>

            {riders.map((rider) => {
              const player = players.find((slot) => slot.id === rider.playerId);
              if (!player) {
                return null;
              }

              const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
              const position = calculateRiderPosition(rider, projected, track.lengthMeters);
              const startOffset = raceState === 'ready' && position.progress < 0.025 ? player.id - 2.5 : 0;
              const startYOffset = startOffset === 0 ? 0 : Math.abs(startOffset) === 0.5 ? -12 : 12;
              const style = {
                '--player-color': player.accent,
                '--rider-pitch': `${rider.pitch}deg`,
                '--rider-air': `${rider.air}px`,
                left: `${position.x + startOffset * 22}px`,
                top: `${position.y + startYOffset}px`,
              } as CSSProperties;

              return (
                <div className={`rider-token ${rider.phase}`} style={style} key={rider.playerId}>
                  <span className="rider-bike">
                    <Bike size={24} strokeWidth={2.6} />
                  </span>
                  <span className="rider-label">P{player.id}</span>
                  <span className="rider-speed">
                    {formatSpeedFromKph(sample?.speedKph, speedUnit)} {speedUnitLabel(speedUnit)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {googleMapsConfigured && (
          <div className="google-map-caption">Google satellite imagery with GPS outline overlay</div>
        )}

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {earthAngle} deg</span>
          <span>GPS outline</span>
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
