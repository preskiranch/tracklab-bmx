import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Flag,
  Lock,
  Map as MapIcon,
  MapPinned,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Satellite,
  ShieldCheck,
  Signal,
  Unlock,
  X,
} from 'lucide-react';
import { GoogleMapsTrackLayer } from './GoogleMapsTrackLayer';
import { RaceRiderOverlay } from './RaceRiderOverlay';
import { hasGoogleMapsApiKey } from '../lib/googleMaps';
import { trackGoogleMapsUrl } from '../lib/mapLinks';
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
  RaceRiderOverlayLayout,
  RiderState,
  SplitBranchChoice,
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
  startCountdownPaused: boolean;
  canPauseStartCountdown: boolean;
  cStartOffsetsByPlayer: CStartOffsetsByPlayer;
  finishCountdownSeconds: number | null;
  reactionTimesByPlayer: ReactionTimesByPlayer;
  earthAngle: number;
  earthHeading: number;
  earthCenter: TrackPoint | null;
  earthZoom: number | null;
  raceCameraLocked: boolean;
  canEditRaceLayout: boolean;
  riderOverlayPreference?: RaceRiderOverlayLayout;
  activeZones: TrackZone[];
  canCancelRace: boolean;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  mappingRouteVariantId: TrackRouteVariantId;
  mappingZoneBranchChoice: SplitBranchChoice;
  draftPoints: TrackPoint[];
  draftZoneRoutePoints: TrackPoint[];
  draftZoneSectionId: string | null;
  draftZoneMeters: number[];
  draftZonePoints: TrackPoint[];
  draftReferenceZones: TrackZone[];
  draftSplitSections: TrackSplitSection[];
  draftRouteSplitSections: TrackSplitSection[];
  draftSplitBuilder: DraftTrackSplit | null;
  onEarthCameraChange: (camera: Partial<EarthCamera>) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onRaceCameraLockedChange: (locked: boolean) => void;
  onRiderOverlayPreferenceChange: (trackId: string, layout: RaceRiderOverlayLayout) => void;
  onRaceFullscreenInteraction: () => void;
  onStartCountdownPauseToggle: () => void;
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
  startCountdownPaused,
  canPauseStartCountdown,
  cStartOffsetsByPlayer,
  finishCountdownSeconds,
  reactionTimesByPlayer,
  earthAngle,
  earthHeading,
  earthCenter,
  earthZoom,
  raceCameraLocked,
  canEditRaceLayout,
  riderOverlayPreference,
  activeZones,
  canCancelRace,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  mappingRouteVariantId,
  mappingZoneBranchChoice,
  draftPoints,
  draftZoneRoutePoints,
  draftZoneSectionId,
  draftZoneMeters,
  draftZonePoints,
  draftReferenceZones,
  draftSplitSections,
  draftRouteSplitSections,
  draftSplitBuilder,
  onEarthCameraChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onRaceCameraLockedChange,
  onRiderOverlayPreferenceChange,
  onRaceFullscreenInteraction,
  onStartCountdownPauseToggle,
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
  const googleMapsUrl = trackGoogleMapsUrl(track);
  const imageryLabel = 'Google satellite view';
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
          <a href={googleMapsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open Maps
          </a>
        </div>
      </div>

      <div className="earth-stage google-enabled">
        {googleMapsConfigured ? (
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
              cameraLocked={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
              raceState={raceState}
              earthAngle={earthAngle}
              earthHeading={earthHeading}
              earthCenter={earthCenter}
              earthZoom={earthZoom}
              activeZones={activeZones}
              mappingMode={mappingMode}
              mappingEditMode={mappingEditMode}
              mappingRouteVariantId={mappingRouteVariantId}
              mappingZoneBranchChoice={mappingZoneBranchChoice}
              draftPoints={draftPoints}
              draftZoneRoutePoints={draftZoneRoutePoints}
              draftZoneSectionId={draftZoneSectionId}
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

        {canPauseStartCountdown && (
          <button
            className={`race-countdown-pause-overlay${startCountdownPaused ? ' paused' : ''}`}
            type="button"
            onClick={onStartCountdownPauseToggle}
            aria-pressed={startCountdownPaused}
          >
            {startCountdownPaused ? <Play size={18} /> : <Pause size={18} />}
            {startCountdownPaused ? 'Resume Countdown' : 'Pause Countdown'}
          </button>
        )}

        {raceViewFullscreen && canEditRaceLayout && (
          <button
            className={`race-camera-lock-overlay${raceCameraLocked ? ' locked' : ''}`}
            type="button"
            onClick={() => onRaceCameraLockedChange(!raceCameraLocked)}
            aria-pressed={raceCameraLocked}
            title={raceCameraLocked ? 'Unlock satellite view' : 'Lock camera angle and track position'}
          >
            {raceCameraLocked ? <Lock size={17} /> : <Unlock size={17} />}
            {raceCameraLocked ? 'View Locked' : 'Lock View'}
          </button>
        )}
        {raceViewFullscreen && !canEditRaceLayout && (
          <div className="race-camera-lock-overlay locked" aria-label="Race layout locked">
            <Lock size={17} />
            Layout Locked
          </div>
        )}

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {earthAngle} deg</span>
          <span>Heading {earthHeading} deg</span>
          <span>Satellite</span>
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
            <span>Finish window — remaining riders still racing</span>
          </div>
        )}

        <RaceRiderOverlay
          trackId={track.id}
          riders={riders}
          ghostRiders={ghostRiders}
          remoteRaceStates={remoteRaceStates}
          players={players}
          raceState={raceState}
          visible={raceViewFullscreen && !mappingMode}
          speedUnit={speedUnit}
          trackLengthMeters={track.lengthMeters}
          preference={riderOverlayPreference}
          canEditLayout={canEditRaceLayout}
          onPreferenceChange={onRiderOverlayPreferenceChange}
          onFullscreenInteraction={onRaceFullscreenInteraction}
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

        <div
          className={`map-camera-pad${raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked) ? ' locked' : ''}`}
          aria-label="Map camera controls"
        >
          <button
            aria-label="Rotate map left"
            title="Rotate left"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => onEarthHeadingChange((earthHeading + 345) % 360)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            aria-label="Tilt map up"
            title="Tilt up"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => onEarthAngleChange(Math.min(67, earthAngle + 5))}
          >
            <ChevronUp size={16} />
          </button>
          <button
            aria-label="Reset map north"
            title="Reset north"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => onEarthHeadingChange(0)}
          >
            <Compass size={16} />
          </button>
          <button
            aria-label="Tilt map down"
            title="Tilt down"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => onEarthAngleChange(Math.max(0, earthAngle - 5))}
          >
            <ChevronDown size={16} />
          </button>
          <button
            aria-label="Rotate map right"
            title="Rotate right"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
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
