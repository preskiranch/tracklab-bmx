import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  Activity,
  Bike,
  Box,
  Compass,
  Download,
  Flag,
  Gamepad2,
  Gauge,
  MapPinned,
  Maximize2,
  Mic2,
  Minimize2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Satellite,
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
import { distanceBetweenTrackPoints, routeLengthMeters } from '../lib/trackMapping';
import {
  straightSprintAirSettings,
  straightSprintDistanceOptions,
  straightSprintMaximumFeet,
} from '../lib/straightSprint';
import type {
  DistanceUnit,
  DraftTrackSplit,
  MappingEditMode,
  MetricKey,
  RaceCommentaryPreferences,
  RaceState,
  SpeedUnit,
  PlayerSlot,
  TrackPoint,
  TrackRaceViewMode,
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
  demoPlayerOptions: PlayerSlot[];
  selectedDemoPlayerIds: PlayerSlot['id'][];
  branchChoicesByPlayer: Partial<Record<PlayerSlot['id'], TrackSplitBranch['id']>>;
  mappingRouteVariantId: TrackRouteVariantId;
  mappingZoneBranchChoice: TrackSplitBranch['id'];
  raceRouteVariantId: TrackRouteVariantId;
  savedRouteVariantIds: TrackRouteVariantId[];
  hasDualStartRoutes: boolean;
  isLoopTrack: boolean;
  lapCount: number;
  straightSprintDistanceFeet: number;
  straightSprintAirSetting: number;
  straightSprintMappedFeet: number;
  straightSprintMaximumRouteReady: boolean;
  straightSprintViewMode: TrackRaceViewMode;
  straightSprintGameArenaAvailable: boolean;
  isAdminProfile: boolean;
  showCustomRoutes: boolean;
  sessionTrackAvailable: boolean;
  raceState: RaceState;
  activeBikeCount: number;
  demoMode: boolean;
  mappingMode: boolean;
  mappingFullscreen: boolean;
  mappingEditMode: MappingEditMode;
  mappingObstacleView3D: boolean;
  mappingRaceViewMode: TrackRaceViewMode;
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
  commentaryPreferences: RaceCommentaryPreferences;
  commentarySpeechStatus: 'checking' | 'ready' | 'quota-exhausted' | 'unavailable';
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
  onStraightSprintDistanceChange: (feet: number) => void;
  onStraightSprintAirSettingChange: (setting: number) => void;
  onStraightSprintViewModeChange: (mode: TrackRaceViewMode) => void;
  onDemoModeChange: (enabled: boolean) => void;
  onDemoPlayerSelectionChange: (playerIds: PlayerSlot['id'][]) => void;
  onMappingModeChange: (enabled: boolean) => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingEditModeChange: (mode: MappingEditMode) => void;
  onMappingObstacleView3DChange: (enabled: boolean) => void;
  onMappingRaceViewModeChange: (mode: TrackRaceViewMode) => void;
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
  onCommentaryPreferencesChange: (preferences: RaceCommentaryPreferences) => void;
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

function riderInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function SessionControlPanel({
  track,
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
  demoPlayerOptions,
  selectedDemoPlayerIds,
  branchChoicesByPlayer,
  mappingRouteVariantId,
  mappingZoneBranchChoice,
  raceRouteVariantId,
  savedRouteVariantIds,
  hasDualStartRoutes,
  isLoopTrack,
  lapCount,
  straightSprintDistanceFeet,
  straightSprintAirSetting,
  straightSprintMappedFeet,
  straightSprintMaximumRouteReady,
  straightSprintViewMode,
  straightSprintGameArenaAvailable,
  isAdminProfile,
  showCustomRoutes,
  sessionTrackAvailable,
  raceState,
  activeBikeCount,
  demoMode,
  mappingMode,
  mappingFullscreen,
  mappingEditMode,
  mappingObstacleView3D,
  mappingRaceViewMode,
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
  commentaryPreferences,
  commentarySpeechStatus,
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
  onStraightSprintDistanceChange,
  onStraightSprintAirSettingChange,
  onStraightSprintViewModeChange,
  onDemoModeChange,
  onDemoPlayerSelectionChange,
  onMappingModeChange,
  onMappingFullscreenChange,
  onMappingEditModeChange,
  onMappingObstacleView3DChange,
  onMappingRaceViewModeChange,
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
  onCommentaryPreferencesChange,
  onPrimeAudio,
  onStart,
  onCancel,
  onReset,
}: SessionControlPanelProps) {
  const [pendingCustomRouteDeleteId, setPendingCustomRouteDeleteId] = useState<string | null>(null);
  const [customRouteFilter, setCustomRouteFilter] = useState('');
  const [mappingToolsCollapsed, setMappingToolsCollapsed] = useState(false);
  const hasMappedRoute = track.routeStatus === 'user-mapped';
  const canStart = sessionTrackAvailable
    && !startGateActive
    && raceState !== 'racing'
    && activeBikeCount > 0
    && hasMappedRoute
    && (!showCustomRoutes || straightSprintMappedFeet >= straightSprintDistanceFeet);
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
      {isAdminProfile && showCustomRoutes && (
          <section className="panel-section custom-route-section" id="custom-route-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Straight Sprint</span>
            <h3>Create sprint location</h3>
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
          Add Straight Sprint
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
      )}

      {showCustomRoutes && sessionTrackAvailable && (
        <section className="panel-section straight-sprint-setup-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Sprint Setup</span>
              <h3>Distance and Wattbike Air</h3>
            </div>
            <Zap size={18} />
          </div>

          <label className="text-field straight-sprint-distance-field">
            <span>Sprint distance</span>
            <select
              value={straightSprintDistanceFeet}
              disabled={startGateActive || raceState === 'racing'}
              onChange={(event) => onStraightSprintDistanceChange(Number(event.target.value))}
            >
              {straightSprintDistanceOptions.map((feet) => (
                <option key={feet} value={feet}>{feet.toLocaleString()} ft sprint</option>
              ))}
            </select>
          </label>

          <div className="straight-sprint-air-picker">
            <span>Wattbike Air setting</span>
            <div role="group" aria-label="Wattbike Air setting">
              {straightSprintAirSettings.map((setting) => (
                <button
                  key={setting}
                  className={straightSprintAirSetting === setting ? 'selected' : ''}
                  type="button"
                  aria-pressed={straightSprintAirSetting === setting}
                  disabled={startGateActive || raceState === 'racing'}
                  onClick={() => onStraightSprintAirSettingChange(setting)}
                >
                  {setting}
                </button>
              ))}
            </div>
          </div>

          {straightSprintGameArenaAvailable && (
            <div className="mapping-race-view-card">
              <div className="route-layout-heading">
                <span>Race view</span>
                <small>Choose how this Drag Strip appears</small>
              </div>
              <div className="segmented-control compact three-way" role="group" aria-label="Straight Sprint race view">
                <button
                  className={straightSprintViewMode === 'satellite' ? 'selected' : ''}
                  type="button"
                  disabled={startGateActive || raceState === 'racing'}
                  aria-pressed={straightSprintViewMode === 'satellite'}
                  onClick={() => onStraightSprintViewModeChange('satellite')}
                >
                  <Satellite size={14} />
                  Satellite
                </button>
                <button
                  className={straightSprintViewMode === '3d' ? 'selected' : ''}
                  type="button"
                  disabled={startGateActive || raceState === 'racing'}
                  aria-pressed={straightSprintViewMode === '3d'}
                  onClick={() => onStraightSprintViewModeChange('3d')}
                >
                  <Box size={14} />
                  3D Terrain
                </button>
                <button
                  className={straightSprintViewMode === 'game' ? 'selected' : ''}
                  type="button"
                  disabled={startGateActive || raceState === 'racing'}
                  aria-pressed={straightSprintViewMode === 'game'}
                  onClick={() => onStraightSprintViewModeChange('game')}
                >
                  <Gamepad2 size={14} />
                  Game Arena
                </button>
              </div>
              <p>Game Arena scrolls left-to-right and automatically splits when riders separate.</p>
            </div>
          )}

          <div className={`mapping-hint${straightSprintMaximumRouteReady ? ' pedal-zone' : ''}`}>
            <strong>{straightSprintMappedFeet.toLocaleString()} / {straightSprintMaximumFeet.toLocaleString()} ft mapped</strong>
            <br />
            <span>
              {straightSprintMaximumRouteReady
                ? 'Full drag-strip course ready. Only the selected distance finish line appears during the sprint.'
                : `Map the straight course to ${straightSprintMaximumFeet.toLocaleString()} ft to unlock every sprint distance.`}
            </span>
          </div>

          {straightSprintMappedFeet < straightSprintDistanceFeet && (
            <p className="mapping-hint warning" role="status">
              This route needs {(straightSprintDistanceFeet - straightSprintMappedFeet).toLocaleString()} more ft before the selected sprint can start.
            </p>
          )}

          <p className="panel-helper">
            Records and ghost rankings below are filtered to exactly {straightSprintDistanceFeet.toLocaleString()} ft at Air {straightSprintAirSetting}.
          </p>
        </section>
      )}

      {isAdminProfile && (!showCustomRoutes || sessionTrackAvailable) && (
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

            {showCustomRoutes && (
              <p className={`mapping-hint${(mappingMode ? draftLengthMeters / 0.3048 : straightSprintMappedFeet) >= straightSprintMaximumFeet ? ' pedal-zone' : ''}`}>
                Drag-strip target: {Math.round(mappingMode ? draftLengthMeters / 0.3048 : straightSprintMappedFeet).toLocaleString()} / {straightSprintMaximumFeet.toLocaleString()} ft. Draw one continuous start-to-finish line; sprint finish markers are placed automatically.
              </p>
            )}

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
              <div className="segmented-control compact track-tools" aria-label="Track tools">
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
                  className={mappingEditMode === 'adjust' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('adjust')}
                >
                  Adjust points
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

            {mappingMode && (
              <div className="mapping-race-view-card">
                <div className="route-layout-heading">
                  <span>Saved race view</span>
                  <small>Published with this track for every racer and device</small>
                </div>
                <div className="segmented-control compact" aria-label="Saved race view">
                  <button
                    className={mappingRaceViewMode === 'satellite' ? 'selected' : ''}
                    type="button"
                    onClick={() => onMappingRaceViewModeChange('satellite')}
                  >
                    <Satellite size={14} />
                    Satellite
                  </button>
                  <button
                    className={mappingRaceViewMode === '3d' ? 'selected' : ''}
                    type="button"
                    onClick={() => onMappingRaceViewModeChange('3d')}
                  >
                    <Box size={14} />
                    3D Terrain
                  </button>
                </div>
                <p>
                  {mappingRaceViewMode === '3d'
                    ? 'Races on this track use 3D terrain with the same saved route, splits, and pedal zones.'
                    : 'Races on this track use the reliable satellite view.'}
                </p>
              </div>
            )}

            {splitDrawHint && <p className="mapping-hint">{splitDrawHint}</p>}
            {mappingMode && mappingEditMode === 'adjust' && (
              <p className="mapping-hint">
                Tap a route point, then tap its new location—or press and drag it directly. The route line and exact length update while you move it. Use S for the start and F for the finish.
              </p>
            )}
            {mappingMode && mappingEditMode === 'zones' && (
              <>
                <p className="mapping-hint pedal-zone">
                  {draftSplitSections.length > 0 && mappingZoneBranchChoice === 'b'
                    ? 'Map only the Pro Set from split to merge. Tap S for the first pin, trace along the blue Pro route, then tap M for the last pin.'
                    : 'Tap the start and end of each pedaling zone. Unmarked sections become coasting or obstacle sections.'}
                </p>
                <button
                  className={`mapping-obstacle-view-toggle${mappingObstacleView3D ? ' active' : ''}`}
                  type="button"
                  onClick={() => onMappingObstacleView3DChange(!mappingObstacleView3D)}
                  aria-pressed={mappingObstacleView3D}
                >
                  <Box size={20} />
                  <span>
                    <strong>3D obstacle view</strong>
                    <small>
                      {mappingObstacleView3D
                        ? 'On — orbit the terrain to place pins around jump faces and landings.'
                        : mappingRaceViewMode === '3d'
                          ? 'Use while placing pedal-zone pins. This track is also set to race in 3D.'
                          : 'Use only while placing pedal-zone pins. Racing remains satellite.'}
                    </small>
                  </span>
                  <b>{mappingObstacleView3D ? 'ON' : 'OFF'}</b>
                </button>
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

            <div className="segmented-control compact" role="group" aria-label="Distance unit">
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
      )}

      {isAdminProfile && (
        <section className="panel-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Developer Input</span>
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
              ? 'Demo generates race data for testing and social-media previews. Edit each simulated rider’s name in the Demo Riders cards.'
              : 'Live Bikes uses connected Wattbikes for the same race engine and BMX rollout logic.'}
          </p>

          {demoMode && (
            <section className="explore-demo-rider-picker">
              <div>
                <span className="eyebrow">Demo riders</span>
                <small>Choose the exact riders entering this session.</small>
              </div>
              <div role="group" aria-label="Choose demo riders">
                {demoPlayerOptions.map((player) => {
                  const selected = selectedDemoPlayerIds.includes(player.id);
                  const lastSelected = selected && selectedDemoPlayerIds.length === 1;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      className={selected ? 'selected' : ''}
                      style={{ '--player-color': player.accent } as CSSProperties}
                      aria-pressed={selected}
                      disabled={startGateActive || raceState === 'racing' || lastSelected}
                      onClick={() => {
                        const requestedIds = selected
                          ? selectedDemoPlayerIds.filter((playerId) => playerId !== player.id)
                          : [...selectedDemoPlayerIds, player.id];
                        onDemoPlayerSelectionChange(
                          demoPlayerOptions
                            .map((option) => option.id)
                            .filter((playerId) => requestedIds.includes(playerId)),
                        );
                      }}
                    >
                      {player.photoUrl
                        ? <img src={player.photoUrl} alt="" />
                        : <span className="explore-demo-rider-initials">{riderInitials(player.name)}</span>}
                      <span>
                        <small>P{player.id}</small>
                        <strong>{player.name}</strong>
                      </span>
                      <b>{selected ? 'Selected' : 'Use'}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

        </section>
      )}

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

        <label className="announcer-enable-row">
          <span>
            <strong>Ambient track sound</strong>
            <small>Crowd chatter through staging, cadence, and racing</small>
          </span>
          <input
            type="checkbox"
            checked={commentaryPreferences.ambientEnabled}
            onChange={(event) => onCommentaryPreferencesChange({
              ...commentaryPreferences,
              ambientEnabled: event.target.checked,
            })}
          />
        </label>

        {commentaryPreferences.enabled && commentarySpeechStatus === 'quota-exhausted' && (
          <div className="announcer-service-status warning" role="status">
            <strong>Natural voice paused</strong>
            <small>
              {isAdminProfile
                ? 'OpenAI credits are unavailable. Robotic device speech is disabled, so TrackLab will not substitute another voice.'
                : 'Natural commentary is temporarily unavailable. TrackLab will remain silent instead of switching to a robotic device voice.'}
            </small>
          </div>
        )}

        {commentaryPreferences.enabled && commentarySpeechStatus === 'unavailable' && (
          <div className="announcer-service-status warning" role="status">
            <strong>Natural voice unavailable</strong>
            <small>Robotic device speech is disabled. Commentary will resume only with the natural voice service.</small>
          </div>
        )}

        {isAdminProfile && (
          <div className="ambient-admin-controls">
            <div className="ambient-admin-heading">
              <span>Developer ambient calibration</span>
              <button
                type="button"
                className={commentaryPreferences.ambientVolumeLocked ? 'locked' : ''}
                aria-pressed={commentaryPreferences.ambientVolumeLocked}
                aria-label={commentaryPreferences.ambientVolumeLocked
                  ? 'Unlock ambient volume'
                  : 'Lock ambient volume'}
                onClick={() => onCommentaryPreferencesChange({
                  ...commentaryPreferences,
                  ambientVolumeLocked: !commentaryPreferences.ambientVolumeLocked,
                })}
              >
                {commentaryPreferences.ambientVolumeLocked ? 'Locked' : 'Lock level'}
              </button>
            </div>
            <label className="announcer-volume-row">
              <span><Volume2 size={14} /> Ambience</span>
              <input
                aria-label="Ambient sound volume"
                type="range"
                min="0"
                max="0.2"
                step="0.005"
                value={commentaryPreferences.ambientVolume}
                disabled={!commentaryPreferences.ambientEnabled
                  || commentaryPreferences.ambientVolumeLocked}
                onChange={(event) => onCommentaryPreferencesChange({
                  ...commentaryPreferences,
                  ambientVolume: Number(event.target.value),
                })}
              />
              <strong>{Math.round(commentaryPreferences.ambientVolume * 100)}%</strong>
            </label>
            <small>Saved only to your developer account. Unlock to recalibrate.</small>
          </div>
        )}

        <div className="race-control-actions" aria-label="Race controls">
          <button
            className="action-button primary"
            type="button"
            onPointerDown={onPrimeAudio}
            onClick={onStart}
            disabled={!canStart}
          >
            <Flag size={18} />
            {!sessionTrackAvailable
              ? 'Create Sprint First'
              : !hasMappedRoute
              ? 'Map Route First'
              : showCustomRoutes && straightSprintMappedFeet < straightSprintDistanceFeet
              ? `Map ${straightSprintDistanceFeet.toLocaleString()} ft First`
              : activeBikeCount === 0
                ? (demoMode ? 'Choose Demo Riders' : 'Connect Bikes First')
                : startGateActive
                  ? startGateLabel || 'Gate Sequence'
                : raceState === 'finished'
                  ? showCustomRoutes ? 'Sprint Again' : 'Race Again'
                : raceState === 'racing'
                  ? showCustomRoutes ? 'Sprinting' : 'Racing'
                  : showCustomRoutes
                    ? demoMode ? 'Start Demo Sprint' : 'Start Live Sprint'
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

    </aside>
  );
}
