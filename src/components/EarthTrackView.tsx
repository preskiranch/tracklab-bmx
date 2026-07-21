import { useState, type CSSProperties } from 'react';
import {
  Box,
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
  ShieldCheck,
  Signal,
  X,
} from 'lucide-react';
import { GoogleMaps3DTrackLayer } from './GoogleMaps3DTrackLayer';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { RaceRiderOverlay } from './RaceRiderOverlay';
import { hasGoogleMapsApiKey } from '../lib/googleMaps';
import { trackGoogleEarthUrl } from '../lib/mapLinks';
import { formatDistanceMeters, formatReactionTime } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  GhostPlaybackRider,
  MappingEditMode,
  MultiplayerRaceState,
  PlayerSlot,
  RaceState,
  ReactionTimesByPlayer,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackRouteVariantId,
  TrackSplitSection,
  TrackZone,
} from '../types';
import type { CStartOffsetsByPlayer } from '../lib/bmxGateStart';

type EarthTrackViewProps = {
  track: TrackRecord;
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  raceState: RaceState;
  raceViewFullscreen: boolean;
  startGateActive: boolean;
  startGatePhase: 'idle' | 'staging' | 'cadence' | 'false-start' | 'go';
  startGateLabel: string;
  startGateDetail: string;
  startGateLightIndex: 0 | 1 | 2 | 3 | null;
  cStartOffsetsByPlayer: CStartOffsetsByPlayer;
  finishCountdownSeconds: number | null;
  reactionTimesByPlayer: ReactionTimesByPlayer;
  earthAngle: number;
  earthHeading: number;
  earthCenter: TrackPoint | null;
  earthZoom: number | null;
  activeZones: TrackZone[];
  canCancelRace: boolean;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  mappingRouteVariantId: TrackRouteVariantId;
  draftPoints: TrackPoint[];
  draftZoneRoutePoints: TrackPoint[];
  draftZoneMeters: number[];
  draftZonePoints: TrackPoint[];
  draftReferenceZones: TrackZone[];
  draftSplitSections: TrackSplitSection[];
  draftRouteSplitSections: TrackSplitSection[];
  draftSplitBuilder: DraftTrackSplit | null;
  onEarthCameraChange: (camera: Partial<EarthCamera>) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onCancelRace: () => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingPathPointAdd: (point: TrackPoint) => void;
  onMappingPathPointMove: (index: number, point: TrackPoint) => void;
  onMappingPathPointRemove: (index: number) => void;
  onMappingZonePointAdd: (point: TrackPoint) => void;
  onMappingZonePointMove: (index: number, point: TrackPoint) => void;
  onMappingZonePointRemove: (index: number) => void;
  onMappingSplitPointAdd: (point: TrackPoint) => void;
  onMappingSplitDrawEnd: () => void;
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
  ghostRiders,
  remoteRaceStates,
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  raceState,
  raceViewFullscreen,
  startGateActive,
  startGatePhase,
  startGateLabel,
  startGateDetail,
  startGateLightIndex,
  cStartOffsetsByPlayer,
  finishCountdownSeconds,
  reactionTimesByPlayer,
  earthAngle,
  earthHeading,
  earthCenter,
  earthZoom,
  activeZones,
  canCancelRace,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  mappingRouteVariantId,
  draftPoints,
  draftZoneRoutePoints,
  draftZoneMeters,
  draftZonePoints,
  draftReferenceZones,
  draftSplitSections,
  draftRouteSplitSections,
  draftSplitBuilder,
  onEarthCameraChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onCancelRace,
  onMappingFullscreenChange,
  onMappingPathPointAdd,
  onMappingPathPointMove,
  onMappingPathPointRemove,
  onMappingZonePointAdd,
  onMappingZonePointMove,
  onMappingZonePointRemove,
  onMappingSplitPointAdd,
  onMappingSplitDrawEnd,
}: EarthTrackViewProps) {
  const googleMapsConfigured = hasGoogleMapsApiKey();
  const [imageryMode, setImageryMode] = useState<'satellite' | '3d'>(
    googleMapsConfigured ? '3d' : 'satellite',
  );
  const googleEarthUrl = trackGoogleEarthUrl(track);
  const threeDAllowed = googleMapsConfigured;
  const showing3D = imageryMode === '3d' && threeDAllowed;
  const imageryLabel = showing3D ? 'Photorealistic 3D' : 'Google Earth view';
  const routeStatusLabel = track.routeStatus === 'user-mapped'
    ? 'User-mapped ride line'
    : 'Needs manual mapping';
  const verificationLabel = track.countryCode === 'CUSTOM'
    ? 'Personal route'
    : track.verificationStatus === 'official-track-directory'
    ? 'Official track directory'
    : track.verificationStatus === 'federation-directory'
      ? 'Federation directory'
      : track.verificationStatus === 'supplemental'
        ? 'Supplemental locator'
        : 'Source pending verification';
  const showMappingUi = mappingMode && !raceViewFullscreen;
  const mapRiders = mappingMode ? [] : riders;
  const mapGhostRiders = mappingMode ? [] : ghostRiders;
  const mapRemoteRaceStates = mappingMode ? [] : remoteRaceStates;

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
          <span title="Catalog source confidence"><ShieldCheck size={15} /> {verificationLabel}</span>
          <span><MapIcon size={15} /> {track.elevationMeters} m elevation</span>
          <span><Flag size={15} /> {routeStatusLabel}</span>
          <div className="earth-imagery-switch" aria-label="Map imagery">
            <button
              className={showing3D ? '' : 'active'}
              type="button"
              onClick={() => setImageryMode('satellite')}
              aria-pressed={!showing3D}
            >
              <Satellite size={14} />
              Satellite
            </button>
            <button
              className={showing3D ? 'active' : ''}
              type="button"
              onClick={() => setImageryMode('3d')}
              aria-pressed={showing3D}
              disabled={!threeDAllowed}
              title="Open photorealistic 3D mode"
            >
              <Box size={14} />
              3D
            </button>
          </div>
          <a href={googleEarthUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open Earth
          </a>
        </div>
      </div>

      <div className="earth-stage google-enabled">
        {googleMapsConfigured ? (
          showing3D ? (
            <GoogleMaps3DTrackLayer
              track={track}
              activeZones={activeZones}
              riders={mapRiders}
              ghostRiders={mapGhostRiders}
              remoteRaceStates={mapRemoteRaceStates}
              players={players}
              samplesByDevice={samplesByDevice}
              speedUnit={speedUnit}
              cStartOffsetsByPlayer={cStartOffsetsByPlayer}
              raceViewFullscreen={raceViewFullscreen}
              raceState={raceState}
              earthAngle={earthAngle}
              earthHeading={earthHeading}
              earthCenter={earthCenter}
              earthZoom={earthZoom}
              mappingMode={mappingMode}
              mappingEditMode={mappingEditMode}
              mappingRouteVariantId={mappingRouteVariantId}
              draftPoints={draftPoints}
              draftZoneRoutePoints={draftZoneRoutePoints}
              draftZoneMeters={draftZoneMeters}
              draftZonePoints={draftZonePoints}
              draftReferenceZones={draftReferenceZones}
              draftSplitSections={draftSplitSections}
              draftRouteSplitSections={draftRouteSplitSections}
              draftSplitBuilder={draftSplitBuilder}
              onEarthCameraChange={onEarthCameraChange}
              onMappingPathPointAdd={onMappingPathPointAdd}
              onMappingPathPointMove={onMappingPathPointMove}
              onMappingPathPointRemove={onMappingPathPointRemove}
              onMappingZonePointAdd={onMappingZonePointAdd}
              onMappingZonePointMove={onMappingZonePointMove}
              onMappingZonePointRemove={onMappingZonePointRemove}
              onMappingSplitPointAdd={onMappingSplitPointAdd}
              onMappingSplitDrawEnd={onMappingSplitDrawEnd}
              onUseSatellite={() => setImageryMode('satellite')}
            />
          ) : (
            <GoogleMapsTrackLayer
              track={track}
              riders={mapRiders}
              ghostRiders={mapGhostRiders}
              remoteRaceStates={mapRemoteRaceStates}
              players={players}
              samplesByDevice={samplesByDevice}
              speedUnit={speedUnit}
              distanceUnit={distanceUnit}
              cStartOffsetsByPlayer={cStartOffsetsByPlayer}
              raceViewFullscreen={raceViewFullscreen}
              raceState={raceState}
              earthAngle={earthAngle}
              earthHeading={earthHeading}
              earthCenter={earthCenter}
              earthZoom={earthZoom}
              activeZones={activeZones}
              mappingMode={mappingMode}
              mappingEditMode={mappingEditMode}
              mappingRouteVariantId={mappingRouteVariantId}
              draftPoints={draftPoints}
              draftZoneRoutePoints={draftZoneRoutePoints}
              draftZoneMeters={draftZoneMeters}
              draftZonePoints={draftZonePoints}
              draftReferenceZones={draftReferenceZones}
              draftSplitSections={draftSplitSections}
              draftRouteSplitSections={draftRouteSplitSections}
              draftSplitBuilder={draftSplitBuilder}
              onEarthCameraChange={onEarthCameraChange}
              onMappingPathPointAdd={onMappingPathPointAdd}
              onMappingPathPointMove={onMappingPathPointMove}
              onMappingPathPointRemove={onMappingPathPointRemove}
              onMappingZonePointAdd={onMappingZonePointAdd}
              onMappingZonePointMove={onMappingZonePointMove}
              onMappingZonePointRemove={onMappingZonePointRemove}
              onMappingSplitPointAdd={onMappingSplitPointAdd}
              onMappingSplitDrawEnd={onMappingSplitDrawEnd}
            />
          )
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
          <span>{showing3D ? '3D' : 'Satellite'}</span>
          <span>
            {showMappingUi
              ? `${draftPoints.length} route pt${draftPoints.length === 1 ? '' : 's'}`
              : track.splitSections && track.splitSections.length > 0
                ? `${track.splitSections.length} split${track.splitSections.length === 1 ? '' : 's'}`
              : track.routeStatus === 'user-mapped'
                ? 'Saved ride line'
                : 'No ride line'}
          </span>
          {showMappingUi && (
            <span>
              {mappingEditMode === 'navigate'
                ? 'Move map'
                : mappingEditMode === 'draw'
                  ? 'Draw path'
                  : mappingEditMode === 'zones'
                    ? 'Pedal Zones'
                    : 'Split'}
            </span>
          )}
          <span>{activeZones.length} pedal zone{activeZones.length === 1 ? '' : 's'}</span>
        </div>

        {raceViewFullscreen && startGateActive && (startGatePhase === 'staging' || startGatePhase === 'false-start') && (
          <div className="race-staging-countdown" role="status" aria-live="polite">
            <strong>{startGateLabel}</strong>
            <span>{startGateDetail}</span>
          </div>
        )}

        {raceViewFullscreen && startGateActive && (startGatePhase === 'cadence' || startGatePhase === 'go') && (
          <StartTreeLight activeIndex={startGateLightIndex} />
        )}

        {raceViewFullscreen && finishCountdownSeconds != null && (
          <div className="race-staging-countdown race-finish-countdown" role="status" aria-live="polite">
            <strong>{finishCountdownSeconds}</strong>
            <span>Race closes after the first finisher</span>
          </div>
        )}

        <RaceRiderOverlay
          trackId={track.id}
          riders={riders}
          ghostRiders={ghostRiders}
          remoteRaceStates={remoteRaceStates}
          players={players}
          visible={raceViewFullscreen && !mappingMode}
          speedUnit={speedUnit}
          trackLengthMeters={track.lengthMeters}
        />

        {showMappingUi && (
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

      </div>

      {!mappingMode && (
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
          {remoteRaceStates.flatMap((state) => state.riders.map((rider) => (
            <div className="rider-stat remote" style={{ '--player-color': rider.accent } as CSSProperties} key={`${state.clientId}-${rider.id}`}>
              <span className="player-chip">R</span>
              <div>
                <strong>{rider.name}</strong>
                <span>{Math.round((rider.distance / track.lengthMeters) * 100)}% / rank {rider.rank} / {state.raceState}</span>
              </div>
              <div className="rider-stat-live">
                <Signal size={14} />
                <span>{rider.sampleAt ? `${Math.round(rider.signal * 100)}%` : 'Remote'}</span>
              </div>
              <strong>{formatElapsed(rider.finishedAt)}</strong>
            </div>
          )))}
          {ghostRiders.map((rider, index) => (
            <div className="rider-stat ghost" style={{ '--player-color': rider.accent } as CSSProperties} key={rider.id}>
              <span className="player-chip">G{index + 1}</span>
              <div>
                <strong>{rider.name}</strong>
                <span>{Math.round((rider.distance / track.lengthMeters) * 100)}% / ghost</span>
              </div>
              <div className="rider-stat-live">
                <Signal size={14} />
                <span>Replay</span>
              </div>
              <strong>{formatElapsed(rider.finishedAt)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
