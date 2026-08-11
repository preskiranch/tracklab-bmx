import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Flag,
  Gamepad2,
  Lock,
  Map as MapIcon,
  MapPinned,
  Maximize2,
  Mic,
  MicOff,
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
import { RiderAvatar } from './RiderAvatar';
import { hasGoogleMapsApiKey, trackCenter } from '../lib/googleMaps';
import { mapping3DCenterForTrack } from '../lib/googleMaps3d';
import { trackGoogleMapsUrl } from '../lib/mapLinks';
import { raceProgressPercent } from '../lib/raceProgress';
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
  TrackRaceViewMode,
  TrackRecord,
  TrackRouteVariantId,
  TrackSplitSection,
  TrackZone,
} from '../types';
import type { CStartOffsetsByPlayer } from '../lib/bmxGateStart';

const GoogleMaps3DTrackLayer = lazy(async () => {
  const module = await import('./GoogleMaps3DTrackLayer');
  return { default: module.GoogleMaps3DTrackLayer };
});

const DragStripGameArenaLayer = lazy(async () => {
  const module = await import('./DragStripGameArenaLayer');
  return { default: module.DragStripGameArenaLayer };
});

const RaceRiderOverlay = lazy(async () => {
  const module = await import('./RaceRiderOverlay');
  return { default: module.RaceRiderOverlay };
});

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
  raceDistanceMeters?: number;
  raceAirSetting?: number;
  raceViewFullscreen: boolean;
  startGateActive: boolean;
  startGatePhase: 'idle' | 'staging' | 'cadence' | 'false-start' | 'go';
  startGateLabel: string;
  startGateDetail: string;
  startGateLightIndex: 0 | 1 | 2 | 3 | null;
  startCountdownPaused: boolean;
  canPauseStartCountdown: boolean;
  roomVoiceVisible: boolean;
  voiceEnabled: boolean;
  voiceSupported: boolean;
  voiceStatus: string;
  voiceRemoteCount: number;
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
  raceViewMode: TrackRaceViewMode;
  canCancelRace: boolean;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  mappingObstacleView3D: boolean;
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
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onCancelRace: () => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingObstacleView3DChange: (enabled: boolean) => void;
  onMappingPathPointAdd: (point: TrackPoint) => void;
  onMappingPathPointMove: (index: number, point: TrackPoint) => void;
  onMappingPathPointRemove: (index: number) => void;
  onMappingZonePointAdd: (point: TrackPoint) => void;
  onMappingZonePointMove: (index: number, point: TrackPoint) => void;
  onMappingZonePointRemove: (index: number) => void;
  onMappingSplitPointAdd: (point: TrackPoint) => void;
  onMappingSplitDrawEnd: () => void;
};

function formatPlacement(rank: number) {
  const suffix = rank === 1 ? 'ST' : rank === 2 ? 'ND' : rank === 3 ? 'RD' : 'TH';
  return `${rank}${suffix}`;
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
          className={`tree-lamp ${lamp.className}${activeIndex != null && index <= activeIndex ? ' active' : ''}`}
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
  raceDistanceMeters,
  raceAirSetting,
  raceViewFullscreen,
  startGateActive,
  startGatePhase,
  startGateLabel,
  startGateDetail,
  startGateLightIndex,
  startCountdownPaused,
  canPauseStartCountdown,
  roomVoiceVisible,
  voiceEnabled,
  voiceSupported,
  voiceStatus,
  voiceRemoteCount,
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
  raceViewMode,
  canCancelRace,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  mappingObstacleView3D,
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
  onVoiceStart,
  onVoiceStop,
  onCancelRace,
  onMappingFullscreenChange,
  onMappingObstacleView3DChange,
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
  const [race3DFallbackTrackId, setRace3DFallbackTrackId] = useState<string | null>(null);
  useEffect(() => {
    setRace3DFallbackTrackId(null);
  }, [raceViewMode, track.id]);
  const showingPedalZone3D = mappingMode
    && mappingEditMode === 'zones'
    && mappingObstacleView3D
    && !raceViewFullscreen;
  const showingRace3D = raceViewMode === '3d'
    && !mappingMode
    && race3DFallbackTrackId !== track.id;
  const showingGameArena = raceViewMode === 'game' && !mappingMode;
  const showingAny3D = showingPedalZone3D || showingRace3D;
  const mapping3DTrackCenter = trackCenter(track);
  const mapping3DSafeCenter = mapping3DCenterForTrack(
    earthCenter,
    mapping3DTrackCenter,
    track.lengthMeters,
  );
  const [mapping3DCamera, setMapping3DCamera] = useState(() => ({
    angle: Math.max(55, earthAngle),
    heading: earthHeading,
    center: mapping3DSafeCenter,
    zoom: earthZoom,
  }));
  useEffect(() => {
    setMapping3DCamera({
      angle: Math.max(55, earthAngle),
      heading: earthHeading,
      center: mapping3DSafeCenter,
      zoom: earthZoom,
    });
  // Keep this temporary camera isolated so moving it never changes the saved satellite race view.
  }, [
    earthAngle,
    earthHeading,
    earthZoom,
    mapping3DSafeCenter.lat,
    mapping3DSafeCenter.lng,
    track.id,
  ]);
  const race3DCamera = {
    angle: Math.max(55, earthAngle),
    heading: earthHeading,
    center: mapping3DSafeCenter,
    zoom: earthZoom,
  };
  const active3DCamera = showingPedalZone3D ? mapping3DCamera : race3DCamera;
  const activeEarthAngle = showingAny3D ? active3DCamera.angle : earthAngle;
  const activeEarthHeading = showingAny3D ? active3DCamera.heading : earthHeading;
  const imageryLabel = showingPedalZone3D
    ? '3D obstacle view'
    : showingRace3D
      ? 'Google 3D race view'
      : showingGameArena
        ? 'BMX game arena'
      : 'Google satellite view';
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
  const progressLengthMeters = raceDistanceMeters ?? track.lengthMeters;

  return (
    <section className="earth-panel">
      <div className="earth-header">
        <div>
          <div className="eyebrow">
            {showingGameArena ? <Gamepad2 size={14} /> : showingAny3D ? <Box size={14} /> : <Satellite size={14} />}
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
        {showingGameArena ? (
          <Suspense fallback={<div className="google-map-status loading">Loading Drag Strip game arena…</div>}>
            <DragStripGameArenaLayer
              riders={mapRiders}
              ghostRiders={mapGhostRiders}
              remoteRaceStates={mapRemoteRaceStates}
              players={players}
              samplesByDevice={samplesByDevice}
              raceState={raceState}
              raceDistanceMeters={progressLengthMeters}
            />
          </Suspense>
        ) : googleMapsConfigured ? (
          showingAny3D ? (
            <Suspense
              fallback={(
                <div className="google-map-status loading" role="status">
                  <Box size={20} />
                  <strong>{showingPedalZone3D ? 'Opening 3D obstacle view' : 'Opening 3D race view'}</strong>
                  <span>{showingPedalZone3D
                    ? 'Loading terrain tools only for this pedal-zone edit.'
                    : 'Loading this track’s saved route, pedal zones, and 3D terrain.'}</span>
                </div>
              )}
            >
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
                raceViewFullscreen={showingRace3D ? raceViewFullscreen : false}
                raceState={raceState}
                raceDistanceMeters={raceDistanceMeters}
                earthAngle={active3DCamera.angle}
                earthHeading={active3DCamera.heading}
                earthCenter={active3DCamera.center}
                earthZoom={active3DCamera.zoom}
                cameraLocked={showingRace3D && raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
                mappingMode={showingPedalZone3D}
                mappingEditMode={showingPedalZone3D ? 'zones' : 'navigate'}
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
                onEarthCameraChange={(camera) => {
                  if (showingPedalZone3D) {
                    setMapping3DCamera((current) => ({
                      angle: camera.angle ?? current.angle,
                      heading: camera.heading ?? current.heading,
                      center: camera.center ?? current.center,
                      zoom: camera.zoom ?? current.zoom,
                    }));
                  } else {
                    onEarthCameraChange(camera);
                  }
                }}
                onMappingZonePointAdd={onMappingZonePointAdd}
                onMappingZonePointMove={onMappingZonePointMove}
                onMappingZonePointRemove={onMappingZonePointRemove}
                onUseSatellite={() => {
                  if (showingPedalZone3D) {
                    onMappingObstacleView3DChange(false);
                  } else {
                    setRace3DFallbackTrackId(track.id);
                  }
                }}
              />
            </Suspense>
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
              cameraLocked={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
              raceState={raceState}
              raceDistanceMeters={raceDistanceMeters}
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

        {raceViewFullscreen && roomVoiceVisible && (
          <button
            className={`race-countdown-pause-overlay race-room-voice-overlay${voiceEnabled ? ' paused' : ''}`}
            type="button"
            disabled={!voiceSupported}
            onClick={voiceEnabled ? onVoiceStop : onVoiceStart}
            aria-label={voiceEnabled ? 'Mute room microphone' : 'Enable room microphone'}
            aria-pressed={voiceEnabled}
            title={`${voiceStatus}${voiceEnabled ? ` ${voiceRemoteCount} connected.` : ''}`}
          >
            {voiceEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            {voiceEnabled ? 'Mic On' : 'Mic Off'}
          </button>
        )}

        {raceViewFullscreen && canEditRaceLayout && !showingGameArena && (
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
        {raceViewFullscreen && !canEditRaceLayout && !showingGameArena && (
          <div className="race-camera-lock-overlay locked" aria-label="Race layout locked">
            <Lock size={17} />
            Layout Locked
          </div>
        )}

        {raceViewFullscreen && raceDistanceMeters != null && raceState !== 'ready' && (
          <div className="race-countdown-pause-overlay">
            <span>
              {formatDistanceMeters(raceDistanceMeters, distanceUnit)} Sprint
              <br />
              <small>Wattbike Air {raceAirSetting}</small>
            </span>
          </div>
        )}

        <div className="earth-overlay top-left">
          <span className={`race-dot ${raceState}`} />
          <strong>{raceState === 'racing' ? 'Live Race' : raceState === 'finished' ? 'Session Complete' : 'Ready'}</strong>
        </div>
        <div className="earth-overlay bottom-left">
          <span>Angle {activeEarthAngle} deg</span>
          <span>Heading {activeEarthHeading} deg</span>
          <span>{showingPedalZone3D ? '3D obstacles' : showingRace3D ? '3D terrain' : showingGameArena ? 'Game arena' : 'Satellite'}</span>
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
                  : mappingEditMode === 'adjust'
                    ? 'Adjust points'
                    : mappingEditMode === 'curve'
                      ? 'Curve'
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

        <Suspense fallback={null}>
          <RaceRiderOverlay
            trackId={track.id}
            riders={riders}
            ghostRiders={ghostRiders}
            remoteRaceStates={remoteRaceStates}
            players={players}
            raceState={raceState}
            visible={raceViewFullscreen && !mappingMode}
            speedUnit={speedUnit}
            trackLengthMeters={progressLengthMeters}
            preference={riderOverlayPreference}
            canEditLayout={canEditRaceLayout}
            onPreferenceChange={onRiderOverlayPreferenceChange}
            onFullscreenInteraction={onRaceFullscreenInteraction}
          />
        </Suspense>

        {showMappingUi && (
          <div className="map-edit-toolbar" aria-label="Map edit view controls">
            {mappingEditMode === 'zones' && (
              <button
                className={showingPedalZone3D ? 'active' : ''}
                type="button"
                onClick={() => onMappingObstacleView3DChange(!showingPedalZone3D)}
                aria-label={showingPedalZone3D ? 'Use satellite for pedal zone mapping' : 'Use 3D obstacle view for pedal zone mapping'}
                aria-pressed={showingPedalZone3D}
                title={showingPedalZone3D ? 'Return to satellite mapping' : 'Tilt the terrain to identify jumps'}
              >
                {showingPedalZone3D ? <Satellite size={16} /> : <Box size={16} />}
                <span>{showingPedalZone3D ? 'Satellite' : '3D jumps'}</span>
              </button>
            )}
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

        {!showingGameArena && <div
          className={`map-camera-pad${raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked) ? ' locked' : ''}`}
          aria-label="Map camera controls"
        >
          <button
            aria-label="Rotate map left"
            title="Rotate left"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => {
              const next = (activeEarthHeading + 345) % 360;
              if (showingPedalZone3D) {
                setMapping3DCamera((current) => ({ ...current, heading: next }));
              } else {
                onEarthHeadingChange(next);
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
          <button
            aria-label="Tilt map up"
            title="Tilt up"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => {
              const next = Math.min(67, activeEarthAngle + 5);
              if (showingPedalZone3D) {
                setMapping3DCamera((current) => ({ ...current, angle: next }));
              } else {
                onEarthAngleChange(next);
              }
            }}
          >
            <ChevronUp size={16} />
          </button>
          <button
            aria-label="Reset map north"
            title="Reset north"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => {
              if (showingPedalZone3D) {
                setMapping3DCamera((current) => ({ ...current, heading: 0 }));
              } else {
                onEarthHeadingChange(0);
              }
            }}
          >
            <Compass size={16} />
          </button>
          <button
            aria-label="Tilt map down"
            title="Tilt down"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => {
              const next = Math.max(0, activeEarthAngle - 5);
              if (showingPedalZone3D) {
                setMapping3DCamera((current) => ({ ...current, angle: next }));
              } else {
                onEarthAngleChange(next);
              }
            }}
          >
            <ChevronDown size={16} />
          </button>
          <button
            aria-label="Rotate map right"
            title="Rotate right"
            type="button"
            disabled={raceViewFullscreen && (!canEditRaceLayout || raceCameraLocked)}
            onClick={() => {
              const next = (activeEarthHeading + 15) % 360;
              if (showingPedalZone3D) {
                setMapping3DCamera((current) => ({ ...current, heading: next }));
              } else {
                onEarthHeadingChange(next);
              }
            }}
          >
            <RotateCw size={16} />
          </button>
        </div>}

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
                <RiderAvatar
                  name={player?.name ?? `Player ${rider.playerId}`}
                  photoUrl={player?.photoUrl}
                  accent={player?.accent}
                  className="rider-stat-avatar"
                />
                <div className="rider-stat-identity">
                  <strong>{player?.name ?? `Player ${rider.playerId}`}</strong>
                  <span>Gate P{rider.playerId} / {raceProgressPercent(rider.distance, progressLengthMeters)}% / RT {formatReactionTime(reactionTime)}</span>
                </div>
                <div className="rider-stat-live">
                  <Signal size={14} />
                  <span>{sample ? `${Math.round(sample.signal * 100)}%` : 'Waiting'}</span>
                </div>
                <strong className={`rider-card-place ${raceState === 'ready' ? 'ready' : ''}`}>
                  {raceState === 'ready' ? 'READY' : formatPlacement(rider.rank)}
                </strong>
              </div>
            );
          })}
          {remoteRaceStates.flatMap((state) => state.riders.map((rider) => (
            <div className="rider-stat remote" style={{ '--player-color': rider.accent } as CSSProperties} key={`${state.clientId}-${rider.id}`}>
              <RiderAvatar name={rider.name} photoUrl={rider.photoUrl} accent={rider.accent} className="rider-stat-avatar" />
              <div className="rider-stat-identity">
                <strong>{rider.name}</strong>
                <span>Remote / {raceProgressPercent(rider.distance, progressLengthMeters)}% / {state.raceState}</span>
              </div>
              <div className="rider-stat-live">
                <Signal size={14} />
                <span>{rider.sampleAt ? `${Math.round(rider.signal * 100)}%` : 'Remote'}</span>
              </div>
              <strong className="rider-card-place">{formatPlacement(rider.rank)}</strong>
            </div>
          )))}
          {ghostRiders.map((rider, index) => (
            <div className="rider-stat ghost" style={{ '--player-color': rider.accent } as CSSProperties} key={rider.id}>
              <RiderAvatar name={rider.name} accent={rider.accent} className="rider-stat-avatar" />
              <div className="rider-stat-identity">
                <strong>{rider.name}</strong>
                <span>Ghost {index + 1} / {raceProgressPercent(rider.distance, progressLengthMeters)}%</span>
              </div>
              <div className="rider-stat-live">
                <Signal size={14} />
                <span>Replay</span>
              </div>
              <strong className="rider-card-place">{formatPlacement(rider.rank)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
