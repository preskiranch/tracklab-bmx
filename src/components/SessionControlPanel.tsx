import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  Activity,
  Bike,
  CheckCircle2,
  Circle,
  Compass,
  Download,
  Flag,
  Gauge,
  MapPinned,
  Maximize2,
  Medal,
  Mic2,
  Minimize2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Save,
  SlidersHorizontal,
  Timer,
  Trash2,
  Undo2,
  Upload,
  X,
  Zap,
  Volume2,
} from 'lucide-react';
import { formatDistanceMeters, formatDistanceRangeMeters } from '../units';
import type { PlacePredictionOption } from '../lib/googleMaps';
import type { PreRaceReport } from '../lib/preRaceReport';
import { distanceBetweenTrackPoints, routeLengthMeters } from '../lib/trackMapping';
import type {
  DistanceUnit,
  DraftTrackSplit,
  GhostLap,
  IntervalMode,
  MappingEditMode,
  MetricKey,
  RaceCommentaryPreferences,
  RaceState,
  SessionMode,
  SpeedUnit,
  PlayerSlot,
  TrackPoint,
  TrackRecord,
  TrackRouteVariantId,
  TrackSplitBranch,
  TrackSplitSection,
  TrackZone,
} from '../types';

const splitBranchMinInteriorPoints = 2;
const splitBranchEndpointSnapMeters = 8;

function splitBranchInteriorPoints(
  points: DraftTrackSplit['branchA'],
  splitPoint: DraftTrackSplit['splitPoint'],
  mergePoint: DraftTrackSplit['mergePoint'],
) {
  if (!splitPoint) {
    return points;
  }

  return points.filter((point) => {
    if (distanceBetweenTrackPoints(point, splitPoint) <= 0.5) {
      return false;
    }

    return !mergePoint || distanceBetweenTrackPoints(point, mergePoint) > 0.5;
  });
}

function splitBranchPath(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint) {
  return [splitPoint, ...points, mergePoint];
}

function splitBranchDraftPath(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint) {
  const interiorPoints = splitBranchInteriorPoints(points, splitPoint, mergePoint);
  const reachedMerge = points.some((point) => (
    distanceBetweenTrackPoints(point, mergePoint) <= splitBranchEndpointSnapMeters
  ));

  return reachedMerge ? splitBranchPath(interiorPoints, splitPoint, mergePoint) : [splitPoint, ...interiorPoints];
}

type SessionControlPanelProps = {
  track: TrackRecord;
  sessionMode: SessionMode;
  intervalMode: IntervalMode;
  activeZones: TrackZone[];
  manualZoneIds: string[];
  selectedMetrics: MetricKey[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  earthAngle: number;
  earthHeading: number;
  customRouteName: string;
  customRouteLocation: string;
  customRouteStatus: string | null;
  customRoutePredictions: PlacePredictionOption[];
  customRoutePredictionStatus: string | null;
  selectedCustomRoutePredictionId: string | null;
  customRoutes: TrackRecord[];
  selectedTrackId: string;
  players: PlayerSlot[];
  branchChoicesByPlayer: Partial<Record<PlayerSlot['id'], TrackSplitBranch['id']>>;
  mappingRouteVariantId: TrackRouteVariantId;
  mappingZoneBranchChoice: TrackSplitBranch['id'];
  raceRouteVariantId: TrackRouteVariantId;
  savedRouteVariantIds: TrackRouteVariantId[];
  hasDualStartRoutes: boolean;
  isLoopTrack: boolean;
  lapCount: number;
  currentProfileKey: string;
  raceState: RaceState;
  activeBikeCount: number;
  maxPlayers: number;
  demoMode: boolean;
  demoBikeCount: number;
  demoVariableCount: number;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  draftPointCount: number;
  draftZonePinCount: number;
  draftZoneCount: number;
  draftZones: TrackZone[];
  draftZoneRouteLengthMeters: number;
  draftZoneStartsAtRouteStart: boolean;
  draftZoneEndsAtRouteFinish: boolean;
  draftLengthMeters: number;
  draftSplitSections: TrackSplitSection[];
  draftSplitBuilder: DraftTrackSplit | null;
  draftSplitBuilderStatus: string;
  canSaveDraftSplit: boolean;
  hasSavedMapping: boolean;
  mappingSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  mappingSaveMessage: string | null;
  mappingRestSeconds: number;
  startGateActive: boolean;
  startGateLabel: string;
  startGateDetail: string;
  ghostLaps: GhostLap[];
  selectedGhostIds: string[];
  commentaryPreferences: RaceCommentaryPreferences;
  commentaryServiceMode: 'checking' | 'ai' | 'browser';
  commentaryPlaybackStatus: 'idle' | 'thinking' | 'speaking';
  commentaryPlaybackError: string | null;
  commentaryPreRaceReport: PreRaceReport | null;
  onSessionModeChange: (mode: SessionMode) => void;
  onIntervalModeChange: (mode: IntervalMode) => void;
  onManualZoneToggle: (zoneId: string) => void;
  onMetricToggle: (metric: MetricKey) => void;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onDistanceUnitChange: (unit: DistanceUnit) => void;
  onEarthAngleChange: (angle: number) => void;
  onEarthHeadingChange: (heading: number) => void;
  onCustomRouteNameChange: (value: string) => void;
  onCustomRouteLocationChange: (value: string) => void;
  onCustomRoutePredictionSelect: (prediction: PlacePredictionOption) => void;
  onCustomRouteCreate: () => void;
  onCustomRouteSelect: (trackId: string) => void;
  onCustomRouteDelete: (trackId: string) => void;
  onBranchChoiceChange: (playerId: PlayerSlot['id'], branch: TrackSplitBranch['id']) => void;
  onMappingRouteVariantChange: (variantId: TrackRouteVariantId) => void;
  onMappingZoneBranchChange: (branch: TrackSplitBranch['id']) => void;
  onRaceRouteVariantChange: (variantId: TrackRouteVariantId) => void;
  onLapCountChange: (count: number) => void;
  onDemoModeChange: (enabled: boolean) => void;
  onDemoBikeCountChange: (count: number) => void;
  onMappingModeChange: (enabled: boolean) => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingEditModeChange: (mode: MappingEditMode) => void;
  onMappingSplitStart: (branch?: TrackSplitBranch['id']) => void;
  onMappingSplitBranchChange: (branch: TrackSplitBranch['id']) => void;
  onMappingSplitSave: () => void;
  onMappingSplitCancel: () => void;
  onMappingSplitRemove: (splitId: string) => void;
  onMappingRestSecondsChange: (seconds: number) => void;
  canUndoMapping: boolean;
  canRedoMapping: boolean;
  onMappingUndoPoint: () => void;
  onMappingRedoPoint: () => void;
  onMappingClearDraft: () => void;
  onMappingRedrawRoute: () => void;
  onMappingClearZones: () => void;
  onMappingZoneRemove: (zoneIndex: number) => void;
  onMappingProZoneEndpointAdd: (endpoint: 'split' | 'merge') => void;
  onMappingSave: () => void;
  onMappingRemove: () => void;
  onMappingExport: () => void;
  onMappingImport: (file: File) => void;
  onGhostToggle: (ghostId: string) => void;
  onGhostClear: () => void;
  onGhostAnalyticsSharingChange: (ghostId: string, analyticsPublic: boolean) => void;
  onCommentaryPreferencesChange: (preferences: RaceCommentaryPreferences) => void;
  onCommentaryPreview: () => void;
  onPrimeAudio: () => void;
  onStart: () => void;
  onCancel: () => void;
  onReset: () => void;
};

const metricOptions: Array<{ key: MetricKey; label: string; icon: typeof Activity }> = [
  { key: 'cadence', label: 'Cadence', icon: Activity },
  { key: 'speed', label: 'Speed', icon: Gauge },
  { key: 'power', label: 'Power', icon: Zap },
  { key: 'reaction', label: 'Reaction', icon: Timer },
];

function formatGhostRaceTime(milliseconds: number) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(2)}s`;
}

function ghostSourceLabel(ghost: GhostLap) {
  if (ghost.source === 'friend') {
    return 'Friend best';
  }

  if (ghost.source === 'top') {
    return 'Top rider';
  }

  return 'My best';
}

function ghostMedalLabel(rank: GhostLap['medalRank']) {
  return rank === 1 ? 'Gold' : rank === 2 ? 'Silver' : rank === 3 ? 'Bronze' : null;
}

export function SessionControlPanel({
  track,
  sessionMode,
  intervalMode,
  activeZones,
  manualZoneIds,
  selectedMetrics,
  speedUnit,
  distanceUnit,
  earthAngle,
  earthHeading,
  customRouteName,
  customRouteLocation,
  customRouteStatus,
  customRoutePredictions,
  customRoutePredictionStatus,
  selectedCustomRoutePredictionId,
  customRoutes,
  selectedTrackId,
  players,
  branchChoicesByPlayer,
  mappingRouteVariantId,
  mappingZoneBranchChoice,
  raceRouteVariantId,
  savedRouteVariantIds,
  hasDualStartRoutes,
  isLoopTrack,
  lapCount,
  currentProfileKey,
  raceState,
  activeBikeCount,
  maxPlayers,
  demoMode,
  demoBikeCount,
  demoVariableCount,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  draftPointCount,
  draftZonePinCount,
  draftZoneCount,
  draftZones,
  draftZoneRouteLengthMeters,
  draftZoneStartsAtRouteStart,
  draftZoneEndsAtRouteFinish,
  draftLengthMeters,
  draftSplitSections,
  draftSplitBuilder,
  draftSplitBuilderStatus,
  canSaveDraftSplit,
  hasSavedMapping,
  mappingSaveStatus,
  mappingSaveMessage,
  mappingRestSeconds,
  startGateActive,
  startGateLabel,
  startGateDetail,
  ghostLaps,
  selectedGhostIds,
  commentaryPreferences,
  commentaryServiceMode,
  commentaryPlaybackStatus,
  commentaryPlaybackError,
  commentaryPreRaceReport,
  onSessionModeChange,
  onIntervalModeChange,
  onManualZoneToggle,
  onMetricToggle,
  onSpeedUnitChange,
  onDistanceUnitChange,
  onEarthAngleChange,
  onEarthHeadingChange,
  onCustomRouteNameChange,
  onCustomRouteLocationChange,
  onCustomRoutePredictionSelect,
  onCustomRouteCreate,
  onCustomRouteSelect,
  onCustomRouteDelete,
  onBranchChoiceChange,
  onMappingRouteVariantChange,
  onMappingZoneBranchChange,
  onRaceRouteVariantChange,
  onLapCountChange,
  onDemoModeChange,
  onDemoBikeCountChange,
  onMappingModeChange,
  onMappingFullscreenChange,
  onMappingEditModeChange,
  onMappingSplitStart,
  onMappingSplitBranchChange,
  onMappingSplitSave,
  onMappingSplitCancel,
  onMappingSplitRemove,
  onMappingRestSecondsChange,
  canUndoMapping,
  canRedoMapping,
  onMappingUndoPoint,
  onMappingRedoPoint,
  onMappingClearDraft,
  onMappingRedrawRoute,
  onMappingClearZones,
  onMappingZoneRemove,
  onMappingProZoneEndpointAdd,
  onMappingSave,
  onMappingRemove,
  onMappingExport,
  onMappingImport,
  onGhostToggle,
  onGhostClear,
  onGhostAnalyticsSharingChange,
  onCommentaryPreferencesChange,
  onCommentaryPreview,
  onPrimeAudio,
  onStart,
  onCancel,
  onReset,
}: SessionControlPanelProps) {
  const [pendingCustomRouteDeleteId, setPendingCustomRouteDeleteId] = useState<string | null>(null);
  const [customRouteFilter, setCustomRouteFilter] = useState('');
  const [mappingToolsCollapsed, setMappingToolsCollapsed] = useState(false);
  const hasMappedRoute = track.routeStatus === 'user-mapped';
  const canStart = !startGateActive && raceState !== 'racing' && activeBikeCount > 0 && hasMappedRoute;
  const canCancel = startGateActive || raceState === 'racing';
  const canSaveMapping = draftPointCount >= 2;
  const activeMappingToolLabel = mappingEditMode === 'navigate'
    ? 'Move map'
    : mappingEditMode === 'draw'
      ? 'Draw path'
      : mappingEditMode === 'curve'
        ? 'Curve'
        : mappingEditMode === 'zones'
          ? 'Pedal Zones'
          : 'Split';
  const splitDrawHint = mappingMode && mappingEditMode === 'draw'
    ? draftSplitSections.length > 0
      ? 'Draw shared path: start to S1, then start again at M1 and continue to finish.'
      : 'For a loop, finish by tapping or dragging the final point onto the start point.'
    : null;
  const shouldCollapseMappingTools = mappingFullscreen && mappingMode;
  const draftSplitPoint = draftSplitBuilder?.splitPoint ?? null;
  const draftMergePoint = draftSplitBuilder?.mergePoint ?? null;
  const splitReadyForBranches = Boolean(draftSplitPoint && draftMergePoint);
  const draftSplitBranchMetrics = draftSplitBuilder && draftSplitPoint && draftMergePoint
    ? ([
      ['a', 'Amateur Line', draftSplitBuilder.branchA],
      ['b', 'Pro Set', draftSplitBuilder.branchB],
    ] as const).map((branch) => {
      const interiorPoints = splitBranchInteriorPoints(
        branch[2],
        draftSplitPoint,
        draftMergePoint,
      );
      const reachedMerge = branch[2].some((point) => (
        distanceBetweenTrackPoints(point, draftMergePoint) <= splitBranchEndpointSnapMeters
      ));
      const distanceMeters = interiorPoints.length > 0
        ? routeLengthMeters(splitBranchDraftPath(branch[2], draftSplitPoint, draftMergePoint))
        : 0;

      return {
        id: branch[0],
        label: branch[1],
        distanceMeters,
        pointCount: interiorPoints.length,
        ready: interiorPoints.length >= splitBranchMinInteriorPoints && reachedMerge,
        reachedMerge,
      };
    })
    : [];
  const splitBranchOneReady = Boolean(draftSplitBranchMetrics[0]?.ready);
  const canChooseSplitLine = raceState !== 'racing' && !startGateActive;
  const hasRaceSplitChoices = players.length > 0 && (track.splitSections?.length ?? 0) > 0;
  const canChooseRaceLayout = raceState !== 'racing' && !startGateActive;
  const undoLabel = mappingEditMode === 'zones' ? 'Undo pedal pin' : mappingEditMode === 'split' ? 'Undo split' : 'Undo path';
  const redoLabel = mappingEditMode === 'zones' ? 'Redo pedal pin' : mappingEditMode === 'split' ? 'Redo split' : 'Redo path';
  const availableZones = hasMappedRoute ? track.zones : [];
  const visibleTrackDistance = draftPointCount > 1 ? draftLengthMeters : hasMappedRoute ? track.lengthMeters : null;
  const filteredCustomRoutes = customRoutes.filter((customRoute) => {
    const filter = customRouteFilter.trim().toLowerCase();
    if (!filter) {
      return true;
    }

    return [
      customRoute.name,
      customRoute.address,
      customRoute.city,
      customRoute.state,
      customRoute.country,
    ].some((value) => value?.toLowerCase().includes(filter));
  });
  const personalGhosts = ghostLaps.filter((ghost) => ghost.source === 'personal' && ghost.raceSource === 'live');
  const friendGhosts = ghostLaps.filter((ghost) => ghost.source === 'friend').slice(0, 4);
  const topGhosts = ghostLaps.filter((ghost) => ghost.source === 'top').slice(0, 6);
  const selectedGhostCount = selectedGhostIds.filter((ghostId) => ghostLaps.some((ghost) => ghost.id === ghostId)).length;
  const ghostGroups = [
    {
      id: 'personal',
      label: 'My Ghosts',
      ghosts: personalGhosts,
      emptyMessage: 'Complete a live Wattbike race on this track to create your personal ghost.',
      alwaysVisible: true,
    },
    { id: 'friend', label: 'Friends', ghosts: friendGhosts },
    { id: 'top', label: 'Worldwide', ghosts: topGhosts },
  ].filter((group) => group.alwaysVisible || group.ghosts.length > 0);
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onMappingImport(file);
    }

    event.target.value = '';
  };
  const collapseMappingToolsIfNeeded = () => {
    if (shouldCollapseMappingTools) {
      setMappingToolsCollapsed(true);
    }
  };
  const handleMappingEditModeChange = (mode: MappingEditMode) => {
    onMappingEditModeChange(mode);
    collapseMappingToolsIfNeeded();
  };
  const handleMappingSplitStart = () => {
    onMappingSplitStart(draftSplitBuilder?.activeBranch ?? 'a');
    collapseMappingToolsIfNeeded();
  };
  const handleMappingSplitBranchChange = (branch: TrackSplitBranch['id']) => {
    onMappingSplitBranchChange(branch);
    collapseMappingToolsIfNeeded();
  };

  useEffect(() => {
    if (!shouldCollapseMappingTools) {
      setMappingToolsCollapsed(false);
    }
  }, [shouldCollapseMappingTools]);

  return (
    <aside className={mappingToolsCollapsed ? 'control-panel mapping-tools-collapsed' : 'control-panel'}>
      <section className="panel-section custom-route-section" id="custom-route-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Custom Route</span>
            <h3>Create location</h3>
          </div>
          <MapPinned size={18} />
        </div>

        <label className="text-field">
          <span>Name</span>
          <input
            type="text"
            value={customRouteName}
            placeholder="Childhood route"
            onChange={(event) => onCustomRouteNameChange(event.target.value)}
          />
        </label>

        <div className="location-field">
          <label className="text-field">
            <span>Start location</span>
            <input
              id="custom-route-location-input"
              type="text"
              value={customRouteLocation}
              placeholder="Start typing an address"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={customRoutePredictions.length > 0}
              aria-controls="custom-route-location-suggestions"
              onChange={(event) => onCustomRouteLocationChange(event.target.value)}
            />
          </label>

          {customRoutePredictions.length > 0 && (
            <div
              className="location-suggestions"
              id="custom-route-location-suggestions"
              role="listbox"
              aria-label="Google address suggestions"
            >
              {customRoutePredictions.map((prediction) => (
                <button
                  className={selectedCustomRoutePredictionId === prediction.id ? 'selected' : ''}
                  key={prediction.id}
                  type="button"
                  role="option"
                  aria-selected={selectedCustomRoutePredictionId === prediction.id}
                  onClick={() => onCustomRoutePredictionSelect(prediction)}
                >
                  <strong>{prediction.mainText}</strong>
                  {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                </button>
              ))}
            </div>
          )}

          {customRoutePredictionStatus && <p className="autocomplete-status">{customRoutePredictionStatus}</p>}
        </div>

        {customRouteStatus && <p className="field-status">{customRouteStatus}</p>}

        <button className="mapping-fullscreen-button" type="button" onClick={onCustomRouteCreate}>
          <Plus size={15} />
          Add Custom Route
        </button>

        {customRoutes.length > 0 && (
          <div className="custom-route-list" aria-label="Saved custom locations">
            <div className="custom-route-list-header">
              <span>Saved locations</span>
              <small>{customRoutes.length}</small>
            </div>
            <label className="text-field compact custom-route-filter">
              <span>Find</span>
              <input
                type="text"
                value={customRouteFilter}
                placeholder="Name or city"
                onChange={(event) => setCustomRouteFilter(event.target.value)}
              />
            </label>

            {filteredCustomRoutes.map((customRoute) => {
              const isSelected = customRoute.id === selectedTrackId;
              const isPendingDelete = customRoute.id === pendingCustomRouteDeleteId;
              const routeLocation = customRoute.address ?? `${customRoute.latitude?.toFixed(5)}, ${customRoute.longitude?.toFixed(5)}`;

              return (
                <div className={isSelected ? 'custom-route-row selected' : 'custom-route-row'} key={customRoute.id}>
                  <button
                    className="custom-route-open"
                    type="button"
                    onClick={() => onCustomRouteSelect(customRoute.id)}
                    aria-pressed={isSelected}
                  >
                    <strong>{customRoute.name}</strong>
                    <span>{routeLocation}</span>
                  </button>
                  {isPendingDelete ? (
                    <div className="custom-route-confirm" aria-label={`Confirm delete ${customRoute.name}`}>
                      <button type="button" onClick={() => setPendingCustomRouteDeleteId(null)}>
                        Keep
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => {
                          onCustomRouteDelete(customRoute.id);
                          setPendingCustomRouteDeleteId(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <button
                      className="custom-route-delete"
                      type="button"
                      onClick={() => setPendingCustomRouteDeleteId(customRoute.id)}
                      aria-label={`Delete ${customRoute.name}`}
                      title={`Delete ${customRoute.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            {filteredCustomRoutes.length === 0 && <span className="empty-inline">No saved locations match</span>}
          </div>
        )}
      </section>

      <section className={mappingToolsCollapsed ? 'panel-section mapping-section collapsed' : 'panel-section mapping-section'}>
        {mappingToolsCollapsed ? (
          <button
            className="mapping-tools-toggle-button"
            type="button"
            onClick={() => setMappingToolsCollapsed(false)}
            aria-label="Open track mapping tools"
          >
            <SlidersHorizontal size={17} />
            <span>
              <strong>{activeMappingToolLabel}</strong>
              <small>Open tools</small>
            </span>
          </button>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Track Mapping</span>
                <h3>Track map</h3>
              </div>
              <MapPinned size={18} />
            </div>

            <div className="segmented-control compact" aria-label="Mapping mode">
              <button
                className={!mappingMode ? 'selected' : ''}
                type="button"
                onClick={() => onMappingModeChange(false)}
              >
                View
              </button>
              <button
                className={mappingMode ? 'selected' : ''}
                type="button"
                onClick={() => onMappingModeChange(true)}
              >
                Edit map
              </button>
            </div>

            {mappingMode && (
              <div className="route-layout-card">
                <div className="route-layout-heading">
                  <span>Route layout</span>
                  <small>Use for tracks with separate start gates</small>
                </div>
                <div className="segmented-control compact" aria-label="Mapping route layout">
                  <button
                    className={mappingRouteVariantId === 'amateur' ? 'selected' : ''}
                    type="button"
                    onClick={() => onMappingRouteVariantChange('amateur')}
                  >
                    <Flag size={14} />
                    Amateur Track
                  </button>
                  <button
                    className={mappingRouteVariantId === 'pro' ? 'selected' : ''}
                    type="button"
                    onClick={() => onMappingRouteVariantChange('pro')}
                  >
                    <Zap size={14} />
                    Pro Track
                  </button>
                </div>
                <div className="route-layout-saved-row">
                  <span className={savedRouteVariantIds.includes('amateur') ? 'saved' : ''}>Amateur {savedRouteVariantIds.includes('amateur') ? 'saved' : 'not saved'}</span>
                  <span className={savedRouteVariantIds.includes('pro') ? 'saved' : ''}>Pro {savedRouteVariantIds.includes('pro') ? 'saved' : 'not saved'}</span>
                </div>
              </div>
            )}

            {mappingMode && (
              <div className="segmented-control compact five-way" aria-label="Track tools">
                <button
                  className={mappingEditMode === 'navigate' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('navigate')}
                >
                  Move map
                </button>
                <button
                  className={mappingEditMode === 'draw' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('draw')}
                >
                  Draw path
                </button>
                <button
                  className={mappingEditMode === 'curve' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('curve')}
                >
                  Curve
                </button>
                <button
                  className={mappingEditMode === 'zones' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('zones')}
                >
                  Pedal Zones
                </button>
                <button
                  className={mappingEditMode === 'split' ? 'selected' : ''}
                  type="button"
                  onClick={handleMappingSplitStart}
                >
                  Split
                </button>
              </div>
            )}

            <div className="mapping-status-row four">
              <span>{draftPointCount} route pt{draftPointCount === 1 ? '' : 's'}</span>
              <span>{draftZoneCount} pedal zone{draftZoneCount === 1 ? '' : 's'}</span>
              <span>{visibleTrackDistance == null ? 'No distance' : formatDistanceMeters(visibleTrackDistance, distanceUnit)}</span>
              <span>{savedRouteVariantIds.includes(mappingRouteVariantId) ? 'Layout saved' : 'No layout saved'}</span>
            </div>

            {splitDrawHint && <p className="mapping-hint">{splitDrawHint}</p>}
            {mappingMode && mappingEditMode === 'zones' && (
              <>
                <p className="mapping-hint pedal-zone">
                  {draftSplitSections.length > 0 && mappingZoneBranchChoice === 'b'
                    ? 'Map only the Pro Set from split to merge. Tap S for the first pin, trace along the blue Pro route, then tap M for the last pin.'
                    : 'Tap the start and end of each pedaling zone. Unmarked sections become coasting or obstacle sections.'}
                </p>
                {draftSplitSections.length > 0 && (
                  <div className="zone-route-card">
                    <div className="route-layout-heading">
                      <span>Zone route</span>
                      <small>{mappingZoneBranchChoice === 'b'
                        ? 'Branch-only zones; shared Amateur Line zones stay before and after'
                        : 'Amateur Line zones are the shared baseline'}</small>
                    </div>
                    <div className="segmented-control compact" aria-label="Pedal zone route">
                      <button
                        className={mappingZoneBranchChoice === 'a' ? 'selected' : ''}
                        type="button"
                        onClick={() => onMappingZoneBranchChange('a')}
                      >
                        Amateur Line
                      </button>
                      <button
                        className={mappingZoneBranchChoice === 'b' ? 'selected' : ''}
                        type="button"
                        onClick={() => onMappingZoneBranchChange('b')}
                      >
                        Pro Set
                      </button>
                    </div>
                    {mappingZoneBranchChoice === 'b' && (
                      <div className="zone-route-steps" aria-label="Pro Set pedal zone steps">
                        <button
                          className={draftZoneStartsAtRouteStart ? 'complete' : 'active'}
                          type="button"
                          onClick={() => onMappingProZoneEndpointAdd('split')}
                          disabled={draftZoneStartsAtRouteStart}
                        >
                          <strong>1. S split</strong>
                          <small>{draftZoneStartsAtRouteStart ? 'Pinned at 0 ft' : 'Set first pin'}</small>
                        </button>
                        <span className={draftZoneStartsAtRouteStart && !draftZoneEndsAtRouteFinish ? 'active' : ''}>
                          <strong>2. Blue route</strong>
                          <small>{draftZonePinCount % 2 === 1 ? 'Tap a zone end' : 'Tap the next start'}</small>
                        </span>
                        <button
                          className={draftZoneEndsAtRouteFinish ? 'complete' : ''}
                          type="button"
                          onClick={() => onMappingProZoneEndpointAdd('merge')}
                          disabled={draftZoneEndsAtRouteFinish || draftZonePinCount % 2 === 0}
                        >
                          <strong>3. M merge</strong>
                          <small>{draftZoneEndsAtRouteFinish
                            ? `Pinned at ${formatDistanceMeters(draftZoneRouteLengthMeters, distanceUnit)}`
                            : 'Finish pending zone'}</small>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="segmented-control compact" aria-label="Distance unit">
              <button
                className={distanceUnit === 'ft' ? 'selected' : ''}
                type="button"
                onClick={() => onDistanceUnitChange('ft')}
              >
                Feet
              </button>
              <button
                className={distanceUnit === 'm' ? 'selected' : ''}
                type="button"
                onClick={() => onDistanceUnitChange('m')}
              >
                Meters
              </button>
            </div>

            {mappingMode && (draftZones.length > 0 || draftZonePinCount % 2 === 1) && (
              <div className="zone-type-editor" aria-label="Pedaling zone editor">
                <div className="route-layout-heading">
                  <span>{draftSplitSections.length > 0 ? `${mappingZoneBranchChoice === 'b' ? 'Pro Set' : 'Amateur Line'} pedal zones` : 'Pedal zones'}</span>
                  <small>{mappingZoneBranchChoice === 'b'
                    ? 'Shown as distance from split to merge'
                    : 'Two pins create one tracked pedaling section'}</small>
                </div>
                <div className="zone-type-grid">
                  {draftZones.map((zone, zoneIndex) => (
                    <div className="zone-type-button pedal" key={zone.id}>
                      <div className="zone-type-header">
                        <strong>{zone.name}</strong>
                        <button
                          type="button"
                          className="zone-delete-button"
                          onClick={() => onMappingZoneRemove(zoneIndex)}
                          aria-label={`Delete ${zone.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <span>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</span>
                      <small>Performance tracked</small>
                    </div>
                  ))}
                  {draftZonePinCount % 2 === 1 && (
                    <div className="zone-type-button pending">
                      <strong>Set end pin</strong>
                      <span>One point selected</span>
                      <small>Tap the end of this pedal zone</small>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mappingMode && (
              <>
                {mappingEditMode === 'split' && (
                  <div className="split-tool-card">
                    <div className="split-tool-header">
                      <div>
                        <span className="eyebrow">Track Tools</span>
                        <strong>{draftSplitBuilder ? `Split ${draftSplitBuilder.index} / Merge ${draftSplitBuilder.index}` : 'Split straight'}</strong>
                      </div>
                      <Route size={17} />
                    </div>
                    <p>{draftSplitBuilderStatus}</p>
                    <div className="segmented-control compact" aria-label="Split branch">
                      <button
                        className={(draftSplitBuilder?.activeBranch ?? 'a') === 'a' ? 'selected' : ''}
                        type="button"
                        onClick={() => handleMappingSplitBranchChange('a')}
                        disabled={!splitReadyForBranches}
                      >
                        Amateur Line
                      </button>
                      <button
                        className={draftSplitBuilder?.activeBranch === 'b' ? 'selected' : ''}
                        type="button"
                        onClick={() => handleMappingSplitBranchChange('b')}
                        disabled={!splitBranchOneReady}
                      >
                        Pro Set
                      </button>
                    </div>
                    {draftSplitBranchMetrics.length > 0 && (
                      <div className="split-measurements" aria-label="Split branch measurements">
                        {draftSplitBranchMetrics.map((branch) => (
                          <div className={branch.ready ? 'ready' : ''} key={branch.id}>
                            <strong>{branch.label}</strong>
                            <span>{branch.pointCount > 0 ? formatDistanceMeters(branch.distanceMeters, distanceUnit) : 'Not drawn'}</span>
                            <small>
                              {branch.ready
                                ? `${branch.pointCount} route points`
                                : branch.pointCount === 0
                                  ? 'Draw along lane'
                                  : branch.reachedMerge
                                    ? 'Add more contour points'
                                    : 'Keep drawing to merge'}
                            </small>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mapping-actions split-actions">
                      <button type="button" onClick={onMappingSplitSave} disabled={!canSaveDraftSplit}>
                        <Save size={15} />
                        Add split
                      </button>
                      <button type="button" onClick={onMappingSplitCancel} disabled={!draftSplitBuilder}>
                        <X size={15} />
                        Cancel split
                      </button>
                    </div>
                    {draftSplitSections.length > 0 && (
                      <div className="split-list" aria-label="Saved split straights">
                        {draftSplitSections.map((section) => (
                          <div className="split-row" key={section.id}>
                            <div>
                              <strong>{section.name}</strong>
                              <span>{section.branches.map((branch) => `${branch.name} ${formatDistanceMeters(branch.lengthMeters, distanceUnit)}`).join(' / ')}</span>
                            </div>
                            <button type="button" onClick={() => onMappingSplitRemove(section.id)} aria-label={`Remove ${section.name}`}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <label className="number-field">
                  <span>Rest gap</span>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    step="0.5"
                    value={mappingRestSeconds}
                    onChange={(event) => onMappingRestSecondsChange(Number(event.target.value))}
                  />
                  <small>sec</small>
                </label>

                <div className="mapping-lifecycle-actions">
                  <button type="button" onClick={onMappingRedrawRoute} disabled={draftPointCount < 2}>
                    <Route size={15} />
                    <span>
                      <strong>Redraw route</strong>
                      <small>Keep pedal zones</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onMappingClearZones}
                    disabled={draftZoneCount === 0 && draftZonePinCount === 0}
                  >
                    <Trash2 size={15} />
                    <span>
                      <strong>Clear zones</strong>
                      <small>Keep route</small>
                    </span>
                  </button>
                </div>

                <div className="mapping-actions">
                  <button type="button" onClick={onMappingUndoPoint} disabled={!canUndoMapping}>
                    <Undo2 size={15} />
                    {undoLabel}
                  </button>
                  <button type="button" onClick={onMappingRedoPoint} disabled={!canRedoMapping}>
                    <Redo2 size={15} />
                    {redoLabel}
                  </button>
                  <button type="button" onClick={onMappingClearDraft} disabled={draftPointCount === 0}>
                    <Trash2 size={15} />
                    Clear all
                  </button>
                  <button
                    type="button"
                    onClick={onMappingSave}
                    disabled={!canSaveMapping || mappingSaveStatus === 'saving'}
                  >
                    <Save size={15} />
                    {mappingSaveStatus === 'saving' ? 'Saving' : 'Save'}
                  </button>
                </div>

                {mappingSaveMessage && (
                  <p className="mapping-hint" role="status" aria-live="polite">
                    {mappingSaveMessage}
                  </p>
                )}

                <button
                  className="mapping-fullscreen-button"
                  type="button"
                  onClick={() => onMappingFullscreenChange(!mappingFullscreen)}
                >
                  {mappingFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  {mappingFullscreen ? 'Exit full screen' : 'Full screen edit'}
                </button>
              </>
            )}

            <div className="mapping-actions">
              <button type="button" onClick={onMappingExport} disabled={!hasSavedMapping}>
                <Download size={15} />
                Export
              </button>
              <label className="file-button">
                <Upload size={15} />
                Import
                <input type="file" accept="application/json" onChange={handleImportChange} />
              </label>
              <button type="button" onClick={onMappingRemove} disabled={!hasSavedMapping}>
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Input Mode</span>
            <h3>Rider source</h3>
          </div>
          <Bike size={18} />
        </div>

        <div className="segmented-control compact" aria-label="Bike source">
          <button
            className={!demoMode ? 'selected' : ''}
            type="button"
            onClick={() => onDemoModeChange(false)}
          >
            Live Bikes
          </button>
          <button
            className={demoMode ? 'selected' : ''}
            type="button"
            onClick={() => onDemoModeChange(true)}
          >
            Demo
          </button>
        </div>
        <p className="panel-helper">
          {demoMode
            ? 'Demo generates race data for testing. Edit each simulated rider’s name in the Demo Riders cards.'
            : 'Live Bikes uses connected Wattbikes for the same race engine and BMX rollout logic.'}
        </p>

        {demoMode && (
          <>
            <div className="demo-mode-row">
              <span>Riders</span>
              <strong>{demoBikeCount} / {maxPlayers}</strong>
              <small>{demoVariableCount} race variables</small>
            </div>
            <div className="segmented-control compact four-way" aria-label="Demo rider count">
              {Array.from({ length: maxPlayers }, (_, index) => index + 1).map((count) => (
                <button
                  className={demoBikeCount === count ? 'selected' : ''}
                  type="button"
                  onClick={() => onDemoBikeCountChange(count)}
                  key={count}
                >
                  {count}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel-section race-announcer-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Live Audio</span>
            <h3>AI race announcer</h3>
          </div>
          <Mic2 size={18} />
        </div>

        <label className="announcer-enable-row">
          <span>
            <strong>Race commentary</strong>
            <small>Calls live race events after the gate drops</small>
          </span>
          <input
            type="checkbox"
            checked={commentaryPreferences.enabled}
            onChange={(event) => onCommentaryPreferencesChange({
              ...commentaryPreferences,
              enabled: event.target.checked,
            })}
          />
        </label>

        <div className={`announcer-service-status ${commentaryServiceMode}`}>
          <span />
          {commentaryServiceMode === 'checking'
            ? 'Checking AI voice service'
            : commentaryServiceMode === 'ai'
              ? 'Natural AI commentary ready'
              : 'Browser voice fallback active'}
        </div>

        {commentaryPreferences.enabled && (
          <div className="announcer-briefing-status">
            <strong>
              {commentaryPreRaceReport
                ? `Pre-race report ready · ${commentaryPreRaceReport.supportedVariableCount} variables · ${commentaryPreRaceReport.variableCount} current facts`
                : 'Preparing track and weather briefing…'}
            </strong>
            {commentaryPreRaceReport && commentaryPreRaceReport.sources.length > 0 && (
              <details>
                <summary>Track, research, and weather sources</summary>
                <div>
                  {commentaryPreRaceReport.sources.map((source) => (
                    <a
                      href={source.url}
                      key={`${source.kind}:${source.url}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="announcer-select-grid">
          <label>
            <span>Commentary brain</span>
            <select
              value={commentaryPreferences.model}
              disabled={!commentaryPreferences.enabled}
              onChange={(event) => onCommentaryPreferencesChange({
                ...commentaryPreferences,
                model: event.target.value as RaceCommentaryPreferences['model'],
              })}
            >
              <option value="gpt-5.6-luna">Fast — live response</option>
              <option value="gpt-5.6-terra">Balanced — recommended</option>
              <option value="gpt-5.6-sol">Studio — richest wording</option>
            </select>
          </label>
          <label>
            <span>Announcer voice</span>
            <select
              value={commentaryPreferences.voicePreset}
              disabled={!commentaryPreferences.enabled}
              onChange={(event) => onCommentaryPreferencesChange({
                ...commentaryPreferences,
                voicePreset: event.target.value as RaceCommentaryPreferences['voicePreset'],
              })}
            >
              <option value="australian-woman">Australian woman</option>
              <option value="australian-man">Australian man</option>
              <option value="american-woman">American woman</option>
              <option value="american-man">American man</option>
              <option value="british-woman">British woman — England, UK</option>
              <option value="british-man">British man — England, UK</option>
            </select>
          </label>
        </div>

        <label className="announcer-volume-row">
          <span><Volume2 size={14} /> Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={commentaryPreferences.volume}
            disabled={!commentaryPreferences.enabled}
            onChange={(event) => onCommentaryPreferencesChange({
              ...commentaryPreferences,
              volume: Number(event.target.value),
            })}
          />
          <strong>{Math.round(commentaryPreferences.volume * 100)}%</strong>
        </label>

        <label className="announcer-memory-row">
          <input
            type="checkbox"
            checked={commentaryPreferences.adaptiveMemory}
            disabled={!commentaryPreferences.enabled}
            onChange={(event) => onCommentaryPreferencesChange({
              ...commentaryPreferences,
              adaptiveMemory: event.target.checked,
            })}
          />
          <span>
            <strong>Adaptive memory</strong>
            <small>Remembers recent calls on your account to avoid repetition</small>
          </span>
        </label>

        <button
          className="announcer-preview-button"
          type="button"
          disabled={!commentaryPreferences.enabled || commentaryPlaybackStatus !== 'idle'}
          onClick={onCommentaryPreview}
        >
          <Mic2 size={15} />
          {commentaryPlaybackStatus === 'thinking'
            ? 'Preparing voice…'
            : commentaryPlaybackStatus === 'speaking'
              ? 'Announcing…'
              : commentaryPlaybackError
                ? 'Retry voice preview'
                : 'Preview selected voice'}
        </button>
        {commentaryPlaybackError && (
          <p className="announcer-playback-error" role="alert">
            {commentaryPlaybackError}
          </p>
        )}
        <p className="announcer-disclosure">
          Voice and wording are AI-generated. The 15-second report uses cited track research,
          current weather, and saved TrackLab race history; missing facts are omitted.
          Calls describe race action—not watts, RPM, or speed figures. Broadcast research
          contributes aggregate terminology and delivery patterns, never voice cloning.
        </p>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Session Setup</span>
            <h3>Race type</h3>
          </div>
          <Timer size={18} />
        </div>

        <div className="segmented-control" aria-label="Session mode">
          <button
            className={sessionMode === 'sprint' ? 'selected' : ''}
            type="button"
            onClick={() => onSessionModeChange('sprint')}
          >
            <Flag size={15} />
            Full Track
          </button>
          <button
            className={sessionMode === 'interval' ? 'selected' : ''}
            type="button"
            onClick={() => onSessionModeChange('interval')}
          >
            <Timer size={15} />
            Intervals
          </button>
        </div>

        {sessionMode === 'interval' && (
          <>
            <div className="segmented-control compact" aria-label="Interval zone mode">
              <button
                className={intervalMode === 'auto' ? 'selected' : ''}
                type="button"
                onClick={() => onIntervalModeChange('auto')}
              >
                All pedal zones
              </button>
              <button
                className={intervalMode === 'manual' ? 'selected' : ''}
                type="button"
                onClick={() => onIntervalModeChange('manual')}
              >
                Manual
              </button>
            </div>

            {intervalMode === 'manual' && (
              <div className="zone-picker">
                {availableZones.map((zone) => (
                  <button
                    className={`${manualZoneIds.includes(zone.id) ? 'selected' : ''} ${zone.type}`}
                    type="button"
                    onClick={() => onManualZoneToggle(zone.id)}
                    key={zone.id}
                  >
                    <span>{zone.name}</span>
                    <small>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)} / Performance tracked</small>
                  </button>
                ))}
                {availableZones.length === 0 && <span className="empty-inline">No mapped pedal zones</span>}
              </div>
            )}
          </>
        )}

        <div className="active-zone-list">
          {activeZones.length > 0 ? activeZones.map((zone) => (
            <span className={`zone-chip ${zone.type}`} key={zone.id}>
              {zone.name}
            </span>
          )) : <span className="empty-inline">No mapped pedal zones</span>}
        </div>
      </section>

      {hasRaceSplitChoices && (
        <section className="panel-section split-choice-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Split Choice</span>
              <h3>Race line</h3>
            </div>
            <Route size={18} />
          </div>

          <div className="split-choice-list">
            {players.map((player) => {
              const branchChoice = branchChoicesByPlayer[player.id] ?? 'a';
              return (
                <div className="split-choice-row" key={player.id}>
                  <div className="split-choice-rider">
                    <span className="player-chip" style={{ '--player-color': player.accent } as CSSProperties}>P{player.id}</span>
                    <strong>{player.name}</strong>
                  </div>
                  <div className="segmented-control compact" aria-label={`${player.name} race line`}>
                    <button
                      className={branchChoice === 'a' ? 'selected' : ''}
                      type="button"
                      onClick={() => onBranchChoiceChange(player.id, 'a')}
                      disabled={!canChooseSplitLine}
                    >
                      <Route size={14} />
                      Amateur Line
                    </button>
                    <button
                      className={branchChoice === 'b' ? 'selected' : ''}
                      type="button"
                      onClick={() => onBranchChoiceChange(player.id, 'b')}
                      disabled={!canChooseSplitLine}
                    >
                      <Zap size={14} />
                      Pro Set
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="split-choice-note">Pro Set opens at 26+ mph at the split; otherwise the rider stays on Amateur Line.</p>
        </section>
      )}

      {hasDualStartRoutes && (
        <section className="panel-section route-race-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Track Layout</span>
              <h3>Race route</h3>
            </div>
            <MapPinned size={18} />
          </div>
          <div className="segmented-control" aria-label="Race route layout">
            <button
              className={raceRouteVariantId === 'amateur' ? 'selected' : ''}
              type="button"
              onClick={() => onRaceRouteVariantChange('amateur')}
              disabled={!canChooseRaceLayout}
            >
              <Flag size={15} />
              Amateur Track
            </button>
            <button
              className={raceRouteVariantId === 'pro' ? 'selected' : ''}
              type="button"
              onClick={() => onRaceRouteVariantChange('pro')}
              disabled={!canChooseRaceLayout}
            >
              <Zap size={15} />
              Pro Track
            </button>
          </div>
        </section>
      )}

      {isLoopTrack && (
        <section className="panel-section loop-race-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Loop Race</span>
              <h3>Number of laps</h3>
            </div>
            <Route size={18} />
          </div>
          <div className="lap-stepper">
            <button
              type="button"
              aria-label="Decrease lap count"
              title="Decrease lap count"
              onClick={() => onLapCountChange(Math.max(1, lapCount - 1))}
              disabled={lapCount <= 1 || startGateActive || raceState === 'racing'}
            >
              <Minus size={17} />
            </button>
            <label>
              <span>Laps</span>
              <input
                type="number"
                min="1"
                max="20"
                value={lapCount}
                onChange={(event) => onLapCountChange(Math.max(1, Math.min(20, Math.round(Number(event.target.value) || 1))))}
                disabled={startGateActive || raceState === 'racing'}
              />
            </label>
            <button
              type="button"
              aria-label="Increase lap count"
              title="Increase lap count"
              onClick={() => onLapCountChange(Math.min(20, lapCount + 1))}
              disabled={lapCount >= 20 || startGateActive || raceState === 'racing'}
            >
              <Plus size={17} />
            </button>
          </div>
          <p className="loop-race-note">The finish is the start line. Pedal zones repeat on every lap.</p>
        </section>
      )}

      <section className="panel-section ghost-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ghost Racers</span>
            <h3>Saved laps</h3>
          </div>
          <Bike size={18} />
        </div>

        <div className="ghost-summary-row">
          <span>{selectedGhostCount} selected</span>
          <button type="button" onClick={onGhostClear} disabled={selectedGhostCount === 0}>
            Clear
          </button>
        </div>
        <div className="ghost-picker">
          {ghostGroups.map((group) => (
            <div className="ghost-group" key={group.id}>
              <span>{group.label}</span>
              {group.ghosts.length === 0 ? (
                <small className="ghost-group-empty">{group.emptyMessage}</small>
              ) : group.ghosts.map((ghost) => {
                const selected = selectedGhostIds.includes(ghost.id);
                const ownsGhost = ghost.ownerKey === currentProfileKey;
                const medalLabel = ghostMedalLabel(ghost.medalRank);
                const riderZoneResults = ghost.zoneResults.flatMap((zone) => (
                  zone.riders[0] ? [{ zone, rider: zone.riders[0] }] : []
                ));
                return (
                  <div className={`ghost-option ${selected ? 'selected' : ''}`} key={ghost.id}>
                    <button
                      className="ghost-select-button"
                      type="button"
                      onClick={() => onGhostToggle(ghost.id)}
                      aria-pressed={selected}
                    >
                      <span className="ghost-name-row">
                        <strong>{ghost.riderName}</strong>
                        {medalLabel && (
                          <span className={`ghost-medal rank-${ghost.medalRank}`} title={`${medalLabel} course record`}>
                            <Medal size={16} />
                            {medalLabel}
                          </span>
                        )}
                      </span>
                      <small>
                        {ghostSourceLabel(ghost)} / {formatGhostRaceTime(ghost.finishTimeMs)}
                        {ghost.lapCount > 1 ? ` / ${ghost.lapCount} laps` : ''}
                        {' / '}30 ft {ghost.thirtyFootTimeMs == null ? '--' : formatGhostRaceTime(ghost.thirtyFootTimeMs)}
                      </small>
                      <small>
                        {ghost.analyticsPublic
                          ? 'Replay and zone data public'
                          : ownsGhost
                            ? 'Replay public / your zone data private'
                            : 'Replay public / performance private'}
                      </small>
                      <span className={`ghost-race-selection ${selected ? 'selected' : ''}`}>
                        {selected ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                        {selected ? 'Selected to race' : 'Select this ghost'}
                      </span>
                    </button>
                    {ownsGhost && (
                      <label className="ghost-share-toggle">
                        <input
                          type="checkbox"
                          checked={ghost.analyticsPublic}
                          onChange={(event) => onGhostAnalyticsSharingChange(ghost.id, event.target.checked)}
                        />
                        <span>Share zone data with other racers</span>
                      </label>
                    )}
                    {(ghost.summary || riderZoneResults.length > 0) && (
                      <details className="ghost-analytics">
                        <summary>View performance</summary>
                        {ghost.summary && (
                          <div className="ghost-overall-metrics">
                            <span>Cadence {ghost.summary.topCadence == null ? '--' : `${Math.round(ghost.summary.topCadence)} RPM`}</span>
                            <span>Speed {ghost.summary.topSpeedKph == null ? '--' : `${(ghost.summary.topSpeedKph * (speedUnit === 'mph' ? 0.621371 : 1)).toFixed(1)} ${speedUnit.toUpperCase()}`}</span>
                            <span>Power {ghost.summary.topWatts == null ? '--' : `${Math.round(ghost.summary.topWatts)} W`}</span>
                          </div>
                        )}
                        {riderZoneResults.map(({ zone, rider }) => (
                          <div className="ghost-zone-row" key={zone.zoneId}>
                            <strong>{zone.zoneName}</strong>
                            <span>{rider.topCadence == null ? '--' : `${Math.round(rider.topCadence)} RPM`}</span>
                            <span>{rider.topSpeedKph == null ? '--' : `${(rider.topSpeedKph * (speedUnit === 'mph' ? 0.621371 : 1)).toFixed(1)} ${speedUnit.toUpperCase()}`}</span>
                            <span>{rider.topWatts == null ? '--' : `${Math.round(rider.topWatts)} W`}</span>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Before Race</span>
            <h3>Results metrics</h3>
          </div>
          <SlidersHorizontal size={18} />
        </div>
        <div className="metric-picker">
          {metricOptions.map(({ key, label, icon: Icon }) => (
            <label className="metric-option" key={key}>
              <input
                type="checkbox"
                checked={selectedMetrics.includes(key)}
                onChange={() => onMetricToggle(key)}
              />
              <span><Icon size={16} /> {label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">View</span>
            <h3>Camera</h3>
          </div>
          <span className="angle-value">{earthAngle} deg / {earthHeading} deg</span>
        </div>
        <label className="camera-slider">
          <span>Tilt</span>
          <input
            className="angle-slider"
            type="range"
            min="0"
            max="67"
            value={earthAngle}
            onChange={(event) => onEarthAngleChange(Number(event.target.value))}
          />
        </label>
        <label className="camera-slider">
          <span><Compass size={14} /> Heading</span>
          <input
            className="angle-slider"
            type="range"
            min="0"
            max="359"
            value={earthHeading}
            onChange={(event) => onEarthHeadingChange(Number(event.target.value))}
          />
        </label>

        <div className="segmented-control compact" aria-label="Speed unit">
          <button
            className={speedUnit === 'kph' ? 'selected' : ''}
            type="button"
            onClick={() => onSpeedUnitChange('kph')}
          >
            KPH
          </button>
          <button
            className={speedUnit === 'mph' ? 'selected' : ''}
            type="button"
            onClick={() => onSpeedUnitChange('mph')}
          >
            MPH
          </button>
        </div>
      </section>

      <section className="panel-section start-panel">
        <button
          className="action-button primary"
          type="button"
          onPointerDown={onPrimeAudio}
          onClick={onStart}
          disabled={!canStart}
        >
          <Flag size={18} />
          {!hasMappedRoute
            ? 'Map Route First'
            : activeBikeCount === 0
              ? (demoMode ? 'Choose Demo Riders' : 'Connect Bikes First')
              : startGateActive
                ? startGateLabel || 'Gate Sequence'
              : raceState === 'finished'
                ? 'Race Again'
              : raceState === 'racing'
                ? 'Racing'
                : demoMode ? 'Start Demo Race' : 'Start Live Race'}
        </button>
        {canCancel && (
          <button className="action-button danger" type="button" onClick={onCancel}>
            <X size={18} />
            Cancel
          </button>
        )}
        <button className="action-button secondary" type="button" onClick={onReset}>
          <RotateCcw size={18} />
          Reset
        </button>
      </section>
    </aside>
  );
}
