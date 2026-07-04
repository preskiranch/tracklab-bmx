import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  Activity,
  Bike,
  Compass,
  Download,
  Flag,
  Gauge,
  MapPinned,
  Maximize2,
  Minimize2,
  Plus,
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
} from 'lucide-react';
import { formatDistanceMeters, formatDistanceRangeMeters } from '../units';
import type { PlacePredictionOption } from '../lib/googleMaps';
import { distanceBetweenTrackPoints, routeLengthMeters } from '../lib/trackMapping';
import type {
  DistanceUnit,
  DraftTrackSplit,
  IntervalMode,
  MappingEditMode,
  MetricKey,
  RaceState,
  SessionMode,
  SpeedUnit,
  StartCadenceMode,
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
  raceRouteVariantId: TrackRouteVariantId;
  savedRouteVariantIds: TrackRouteVariantId[];
  hasDualStartRoutes: boolean;
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
  draftZoneCount: number;
  draftLengthMeters: number;
  draftSplitSections: TrackSplitSection[];
  draftSplitBuilder: DraftTrackSplit | null;
  draftSplitBuilderStatus: string;
  canSaveDraftSplit: boolean;
  hasSavedMapping: boolean;
  mappingRestSeconds: number;
  startCadenceMode: StartCadenceMode;
  countdownSeconds: number;
  startGateActive: boolean;
  startGateLabel: string;
  startGateDetail: string;
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
  onRaceRouteVariantChange: (variantId: TrackRouteVariantId) => void;
  onDemoModeChange: (enabled: boolean) => void;
  onDemoBikeCountChange: (count: number) => void;
  onStartCadenceModeChange: (mode: StartCadenceMode) => void;
  onCountdownSecondsChange: (seconds: number) => void;
  onMappingModeChange: (enabled: boolean) => void;
  onMappingFullscreenChange: (enabled: boolean) => void;
  onMappingEditModeChange: (mode: MappingEditMode) => void;
  onMappingSplitStart: (branch?: TrackSplitBranch['id']) => void;
  onMappingSplitBranchChange: (branch: TrackSplitBranch['id']) => void;
  onMappingSplitSave: () => void;
  onMappingSplitCancel: () => void;
  onMappingSplitRemove: (splitId: string) => void;
  onMappingRestSecondsChange: (seconds: number) => void;
  onMappingUndoPoint: () => void;
  onMappingClearDraft: () => void;
  onMappingSave: () => void;
  onMappingRemove: () => void;
  onMappingExport: () => void;
  onMappingImport: (file: File) => void;
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
  raceRouteVariantId,
  savedRouteVariantIds,
  hasDualStartRoutes,
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
  draftZoneCount,
  draftLengthMeters,
  draftSplitSections,
  draftSplitBuilder,
  draftSplitBuilderStatus,
  canSaveDraftSplit,
  hasSavedMapping,
  mappingRestSeconds,
  startCadenceMode,
  countdownSeconds,
  startGateActive,
  startGateLabel,
  startGateDetail,
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
  onRaceRouteVariantChange,
  onDemoModeChange,
  onDemoBikeCountChange,
  onStartCadenceModeChange,
  onCountdownSecondsChange,
  onMappingModeChange,
  onMappingFullscreenChange,
  onMappingEditModeChange,
  onMappingSplitStart,
  onMappingSplitBranchChange,
  onMappingSplitSave,
  onMappingSplitCancel,
  onMappingSplitRemove,
  onMappingRestSecondsChange,
  onMappingUndoPoint,
  onMappingClearDraft,
  onMappingSave,
  onMappingRemove,
  onMappingExport,
  onMappingImport,
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
      : mappingEditMode === 'zones'
        ? 'Add zones'
        : 'Split';
  const splitDrawHint = mappingMode && mappingEditMode === 'draw' && draftSplitSections.length > 0
    ? `Draw shared path: start to S1, then start again at M1 and continue to finish.`
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
  const canChooseSplitLine = raceState === 'ready' && !startGateActive;
  const hasRaceSplitChoices = players.length > 0 && (track.splitSections?.length ?? 0) > 0;
  const canChooseRaceLayout = raceState === 'ready' && !startGateActive;
  const undoLabel = mappingEditMode === 'zones' ? 'Undo zone' : mappingEditMode === 'split' ? 'Undo split' : 'Undo path';
  const canUndoMapping = mappingEditMode === 'zones'
    ? draftZoneCount > 1
    : mappingEditMode === 'split'
      ? Boolean(draftSplitBuilder || draftSplitSections.length > 0)
      : draftPointCount > 0;
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
            <h3>Create ride</h3>
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
                <h3>Trace route</h3>
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
              <div className="segmented-control compact four-way" aria-label="Track tools">
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
                  className={mappingEditMode === 'zones' ? 'selected' : ''}
                  type="button"
                  onClick={() => handleMappingEditModeChange('zones')}
                >
                  Add zones
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
              <span>{draftZoneCount} sprint zone{draftZoneCount === 1 ? '' : 's'}</span>
              <span>{visibleTrackDistance == null ? 'No distance' : formatDistanceMeters(visibleTrackDistance, distanceUnit)}</span>
              <span>{savedRouteVariantIds.includes(mappingRouteVariantId) ? 'Layout saved' : 'No layout saved'}</span>
            </div>

            {splitDrawHint && <p className="mapping-hint">{splitDrawHint}</p>}

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

                <div className="mapping-actions">
                  <button type="button" onClick={onMappingUndoPoint} disabled={!canUndoMapping}>
                    <Undo2 size={15} />
                    {undoLabel}
                  </button>
                  <button type="button" onClick={onMappingClearDraft} disabled={draftPointCount === 0}>
                    <Trash2 size={15} />
                    Clear
                  </button>
                  <button type="button" onClick={onMappingSave} disabled={!canSaveMapping}>
                    <Save size={15} />
                    Save
                  </button>
                </div>

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
            <h3>Bike source</h3>
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

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Session Setup</span>
            <h3>Training mode</h3>
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
            Sprint
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
                Auto zones
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
                    className={manualZoneIds.includes(zone.id) ? 'selected' : ''}
                    type="button"
                    onClick={() => onManualZoneToggle(zone.id)}
                    key={zone.id}
                  >
                    <span>{zone.name}</span>
                    <small>{formatDistanceRangeMeters(zone.startMeter, zone.endMeter, distanceUnit)}</small>
                  </button>
                ))}
                {availableZones.length === 0 && <span className="empty-inline">No mapped sprint zones</span>}
              </div>
            )}
          </>
        )}

        <div className="active-zone-list">
          {activeZones.length > 0 ? activeZones.map((zone) => (
            <span className={`zone-chip ${zone.type}`} key={zone.id}>
              {zone.name}
            </span>
          )) : <span className="empty-inline">No mapped sprint zones</span>}
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

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Start Gate</span>
            <h3>Cadence</h3>
          </div>
          <Timer size={18} />
        </div>

        <div className="segmented-control compact" aria-label="Start cadence mode">
          <button
            className={startCadenceMode === 'countdown' ? 'selected' : ''}
            type="button"
            onClick={() => onStartCadenceModeChange('countdown')}
          >
            Countdown
          </button>
          <button
            className={startCadenceMode === 'uci' ? 'selected' : ''}
            type="button"
            onClick={() => onStartCadenceModeChange('uci')}
          >
            UCI
          </button>
        </div>

        {startCadenceMode === 'countdown' && (
          <div className="segmented-control compact four-way" aria-label="Countdown seconds">
            {[3, 4, 5, 6].map((seconds) => (
              <button
                className={countdownSeconds === seconds ? 'selected' : ''}
                type="button"
                onClick={() => onCountdownSecondsChange(seconds)}
                key={seconds}
              >
                {seconds}s
              </button>
            ))}
          </div>
        )}

        {startGateActive && (
          <div className="start-gate-status">
            <strong>{startGateLabel}</strong>
            <span>{startGateDetail}</span>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Before Race</span>
            <h3>Post-race metrics</h3>
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
            <h3>Earth camera</h3>
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
            ? 'Map Track First'
            : activeBikeCount === 0
              ? (demoMode ? 'Choose Riders' : 'No Bikes Connected')
              : startGateActive
                ? startGateLabel || 'Gate Sequence'
              : raceState === 'finished'
                ? 'Race Again'
                : raceState === 'racing'
                  ? 'Racing'
                  : demoMode ? 'Start Demo Race' : 'Start Session'}
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
