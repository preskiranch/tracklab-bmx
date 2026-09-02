import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Download, TableProperties, X } from 'lucide-react';
import type { DistanceUnit, SpeedUnit, TrainingSession } from '../types';
import {
  formatDistanceMeters,
  formatExploreDistanceMeters,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import {
  availableTrainingResultSheets,
  buildTrainingPowerRepMatrix,
  buildTrainingResultRows,
  rowsForTrainingResultSheet,
  trainingActivityLabels,
  type TrainingPowerRepMatrix,
  type TrainingResultRow,
  type TrainingResultSheetDefinition,
  type TrainingResultSheetId,
} from '../lib/trainingResultsGrid';
import {
  type PrivateTrainingHeartRateBySession,
  type PrivateTrainingHeartRateProjection,
} from '../lib/privateTrainingHeartRate';
import type {
  ConsentedClubTrainingHeartRateBySession,
  ConsentedClubTrainingHeartRateProjection,
} from '../lib/clubTrainingHeartRate';
import './TrainingResultsSpreadsheet.css';

export type TrainingResultsSpreadsheetProps = Readonly<{
  sessions: readonly TrainingSession[];
  dateLabel: string;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  selectedSessionId?: string | null;
  onSelectedSessionChange?: (session: TrainingSession | null) => void;
  onExportWorkbook?: () => void;
  onExportPrivateWorkbook?: () => void;
  privateExportDisabled?: boolean;
  exportLabel?: string;
  privateExportLabel?: string;
  privateHeartRateBySession?: PrivateTrainingHeartRateBySession;
  consentedClubHeartRateBySession?: ConsentedClubTrainingHeartRateBySession;
  renderSessionDetail?: (session: TrainingSession) => ReactNode;
}>;

type GridColumn = Readonly<{
  id: string;
  label: string;
  render: (row: TrainingResultRow) => ReactNode;
  numeric?: boolean;
}>;

const missing = '—';

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value);
}

function clockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function duration(value: number | null | undefined) {
  if (!finite(value)) return missing;
  const seconds = Math.max(0, value!) / 1_000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function finish(value: number | null | undefined, precision: 2 | 3 = 2) {
  return finite(value) ? `${(value! / 1_000).toFixed(precision)}s` : missing;
}

function milliseconds(value: number | null | undefined) {
  return finite(value) ? `${Math.round(value!)} ms` : missing;
}

function metric(value: number | null | undefined, unit: string, precision = 0) {
  if (!finite(value)) return missing;
  const formatted = precision === 0
    ? Math.round(value!).toLocaleString()
    : value!.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return `${formatted} ${unit}`;
}

function speed(value: number | null | undefined, unit: SpeedUnit) {
  return finite(value) ? `${formatSpeedFromKph(value, unit)} ${speedUnitLabel(unit)}` : missing;
}

function distance(value: number | null | undefined, unit: DistanceUnit, explore = false) {
  if (!finite(value)) return missing;
  return explore
    ? formatExploreDistanceMeters(value, unit === 'm' ? 'km' : 'mi')
    : formatDistanceMeters(value, unit);
}

function heartRatePercentage(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

type TrainingHeartRateProjection =
  | PrivateTrainingHeartRateProjection
  | ConsentedClubTrainingHeartRateProjection;

function heartRateProjectionLabel(
  projection: TrainingHeartRateProjection,
  metricKind: 'average' | 'peak' | 'coverage',
) {
  if (projection.state === 'loading') return 'Loading…';
  if (projection.state === 'error') return 'Unavailable';
  if (projection.state === 'not-recorded') return 'Not recorded';
  const summary = projection.summary;
  if (!summary || summary.sampleCount <= 0) {
    return projection.state === 'syncing' ? 'Syncing…' : 'No valid samples';
  }
  if (metricKind === 'average') {
    return summary.averageBpm == null ? 'No valid samples' : `${Math.round(summary.averageBpm)} BPM`;
  }
  if (metricKind === 'peak') {
    return summary.peakBpm == null ? 'No valid samples' : `${Math.round(summary.peakBpm)} BPM`;
  }
  return `${summary.sampleCount.toLocaleString()} ${summary.sampleCount === 1 ? 'sample' : 'samples'} · ${heartRatePercentage(summary.coveragePercent)}%${projection.state === 'syncing' ? ' · syncing' : ''}`;
}

function PrivateHeartRateCell({
  resolution,
  metricKind,
}: {
  resolution: PrivateHeartRateResolution;
  metricKind: 'average' | 'peak' | 'coverage';
}) {
  const visible = resolution.projections.length > 0 ? resolution.projections : null;
  return (
    <span style={{ display: 'grid', gap: 2, minWidth: 112 }}>
      {visible ? visible.map((projection, index) => (
        <span style={{ display: 'grid' }} key={`${projection.canonicalSessionId}:${projection.playerId ?? 'rider'}:${index}`}>
          {visible.length > 1 && <small style={{ color: '#667085', fontSize: 9, fontWeight: 700 }}>Watch segment {index + 1}</small>}
          {heartRateProjectionLabel(projection, metricKind)}
        </span>
      )) : <span>{resolution.emptyLabel}</span>}
    </span>
  );
}

type PrivateHeartRateResolution = Readonly<{
  projections: readonly TrainingHeartRateProjection[];
  emptyLabel: 'Not recorded' | 'Private rider only';
}>;

type PrivateHeartRateResolver = (row: TrainingResultRow) => PrivateHeartRateResolution;

function privateHeartRateColumns(resolve: PrivateHeartRateResolver): GridColumn[] {
  return [
    {
      id: 'average-heart-rate',
      label: 'Average heart rate',
      render: (row) => <PrivateHeartRateCell resolution={resolve(row)} metricKind="average" />,
      numeric: true,
    },
    {
      id: 'peak-heart-rate',
      label: 'Peak heart rate',
      render: (row) => <PrivateHeartRateCell resolution={resolve(row)} metricKind="peak" />,
      numeric: true,
    },
    {
      id: 'heart-rate-coverage',
      label: 'Heart-rate coverage / status',
      render: (row) => <PrivateHeartRateCell resolution={resolve(row)} metricKind="coverage" />,
      numeric: true,
    },
  ];
}

function result(row: TrainingResultRow) {
  if (row.status === 'dnf') return 'DNF';
  if (row.activityType === 'bmx-race' || row.activityType === 'straight-sprint') {
    return row.rank == null ? 'Finished' : `#${Math.round(row.rank)}`;
  }
  return row.status === 'saved' ? 'Saved' : 'Finished';
}

function primaryTime(row: TrainingResultRow) {
  return row.activityType === 'bmx-race' || row.activityType === 'straight-sprint'
    ? finish(row.finishTimeMs)
    : duration(row.durationMs);
}

function sessionCell(row: TrainingResultRow) {
  return <span className="training-result-session"><strong>{row.title}</strong><small>{row.trackName || 'TrackLab training'}</small></span>;
}

function commonColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  resolveHeartRate: PrivateHeartRateResolver,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return [
    { id: 'session', label: 'Session', render: sessionCell },
    { id: 'rep', label: 'Rep', render: (row) => row.sessionOrdinal, numeric: true },
    { id: 'time', label: 'Time', render: (row) => clockTime(row.startedAt) },
    { id: 'activity', label: 'Activity', render: (row) => trainingActivityLabels[row.activityType] },
    { id: 'rider', label: 'Rider', render: (row) => row.riderName },
    { id: 'result', label: 'Result', render: result },
    { id: 'recorded-time', label: 'Recorded time', render: primaryTime, numeric: true },
    { id: 'air', label: 'Air', render: (row) => finite(row.airSetting) ? Math.round(row.airSetting!) : missing, numeric: true },
    { id: 'distance', label: 'Distance', render: (row) => distance(row.distanceMeters, distanceUnit, row.activityType === 'explore'), numeric: true },
    { id: 'average-speed', label: 'Avg speed', render: (row) => speed(row.averageSpeedKph, speedUnit), numeric: true },
    { id: 'peak-speed', label: 'Peak speed', render: (row) => speed(row.peakSpeedKph, speedUnit), numeric: true },
    { id: 'average-cadence', label: 'Avg cadence', render: (row) => metric(row.averageCadence, 'RPM', 1), numeric: true },
    { id: 'peak-cadence', label: 'Peak cadence', render: (row) => metric(row.peakCadence, 'RPM', 1), numeric: true },
    { id: 'average-power', label: 'Avg power', render: (row) => metric(row.averageWatts, 'W'), numeric: true },
    { id: 'peak-power', label: 'Peak power', render: (row) => metric(row.peakWatts, 'W'), numeric: true },
    ...privateHeartRateColumns(resolveHeartRate),
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function raceColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  resolveHeartRate: PrivateHeartRateResolver,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return [
    { id: 'rider', label: 'Rider', render: (row) => row.riderName },
    { id: 'rep', label: 'Rep', render: (row) => row.activityOrdinal, numeric: true },
    { id: 'time', label: 'Time', render: (row) => clockTime(row.startedAt) },
    { id: 'session', label: 'Session / track', render: sessionCell },
    { id: 'result', label: 'Rank / status', render: result },
    { id: 'finish', label: 'Finish', render: (row) => finish(row.finishTimeMs), numeric: true },
    { id: 'split', label: '30 ft split', render: (row) => finish(row.thirtyFootTimeMs, 3), numeric: true },
    { id: 'reaction', label: 'Reaction', render: (row) => milliseconds(row.reactionTimeMs), numeric: true },
    { id: 'distance', label: 'Distance', render: (row) => distance(row.distanceMeters, distanceUnit), numeric: true },
    { id: 'points', label: 'Analysis points', render: (row) => finite(row.sampleCount) ? Math.round(row.sampleCount!) : missing, numeric: true },
    { id: 'average-speed', label: 'Avg speed', render: (row) => speed(row.averageSpeedKph, speedUnit), numeric: true },
    { id: 'peak-speed', label: 'Peak speed', render: (row) => speed(row.peakSpeedKph, speedUnit), numeric: true },
    { id: 'average-cadence', label: 'Avg cadence', render: (row) => metric(row.averageCadence, 'RPM', 1), numeric: true },
    { id: 'peak-cadence', label: 'Peak cadence', render: (row) => metric(row.peakCadence, 'RPM', 1), numeric: true },
    { id: 'average-power', label: 'Avg power', render: (row) => metric(row.averageWatts, 'W'), numeric: true },
    { id: 'peak-power', label: 'Peak power', render: (row) => metric(row.peakWatts, 'W'), numeric: true },
    ...privateHeartRateColumns(resolveHeartRate),
    { id: 'zones', label: 'Zones', render: (row) => row.zoneCount > 0 ? row.zoneCount : missing, numeric: true },
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function getPulledColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  resolveHeartRate: PrivateHeartRateResolver,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return [
    { id: 'rider', label: 'Rider', render: (row) => row.riderName },
    { id: 'rep', label: 'Rep', render: (row) => row.activityOrdinal, numeric: true },
    { id: 'time', label: 'Time', render: (row) => clockTime(row.startedAt) },
    { id: 'target', label: 'Planned time', render: (row) => duration(row.plannedDurationMs), numeric: true },
    { id: 'active', label: 'Active / result time', render: (row) => duration(row.durationMs), numeric: true },
    { id: 'air', label: 'Air', render: (row) => finite(row.airSetting) ? Math.round(row.airSetting!) : missing, numeric: true },
    { id: 'status', label: 'Status', render: result },
    { id: 'distance', label: 'Distance', render: (row) => distance(row.distanceMeters, distanceUnit), numeric: true },
    { id: 'average-speed', label: 'Avg speed', render: (row) => speed(row.averageSpeedKph, speedUnit), numeric: true },
    { id: 'peak-speed', label: 'Peak speed', render: (row) => speed(row.peakSpeedKph, speedUnit), numeric: true },
    { id: 'average-cadence', label: 'Avg cadence', render: (row) => metric(row.averageCadence, 'RPM', 1), numeric: true },
    { id: 'peak-cadence', label: 'Peak cadence', render: (row) => metric(row.peakCadence, 'RPM', 1), numeric: true },
    { id: 'average-power', label: 'Avg power', render: (row) => metric(row.averageWatts, 'W'), numeric: true },
    { id: 'peak-power', label: 'Peak power', render: (row) => metric(row.peakWatts, 'W'), numeric: true },
    ...privateHeartRateColumns(resolveHeartRate),
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function monitorColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  resolveHeartRate: PrivateHeartRateResolver,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return getPulledColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review).filter((column) => (
    column.id !== 'target' && column.id !== 'air'
  ));
}

function exploreColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  resolveHeartRate: PrivateHeartRateResolver,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return [
    { id: 'rider', label: 'Rider', render: (row) => row.riderName },
    { id: 'rep', label: 'Rep', render: (row) => row.activityOrdinal, numeric: true },
    { id: 'time', label: 'Time', render: (row) => clockTime(row.startedAt) },
    { id: 'route', label: 'Route', render: (row) => [row.routeOrigin, row.routeDestination].filter(Boolean).join(' → ') || row.title },
    { id: 'active-time', label: 'Active time', render: (row) => duration(row.durationMs), numeric: true },
    { id: 'distance', label: 'Distance', render: (row) => distance(row.distanceMeters, distanceUnit, true), numeric: true },
    { id: 'average-speed', label: 'Avg speed', render: (row) => speed(row.averageSpeedKph, speedUnit), numeric: true },
    { id: 'elevation-gain', label: 'Elevation gain', render: (row) => distance(row.elevationGainMeters, distanceUnit), numeric: true },
    { id: 'elevation-loss', label: 'Elevation loss', render: (row) => distance(row.elevationLossMeters, distanceUnit), numeric: true },
    { id: 'status', label: 'Status', render: result },
    ...privateHeartRateColumns(resolveHeartRate),
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function ResultTable({
  rows,
  columns,
  caption,
  regionLabel,
  selectedSessionId,
  gridRef,
}: {
  rows: readonly TrainingResultRow[];
  columns: readonly GridColumn[];
  caption: string;
  regionLabel: string;
  selectedSessionId: string | null;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="training-results-grid" ref={gridRef} role="region" aria-label={regionLabel} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead><tr>{columns.map((column) => <th scope="col" className={column.numeric ? 'number' : undefined} key={column.id}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr className={row.sessionId === selectedSessionId ? 'selected' : undefined} key={row.id}>
            {columns.map((column, index) => {
              const Cell = index === 0 ? 'th' : 'td';
              return <Cell scope={index === 0 ? 'row' : undefined} className={column.numeric ? 'number' : undefined} key={column.id}>{column.render(row)}</Cell>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PowerTable({ matrix, dateLabel }: { matrix: TrainingPowerRepMatrix; dateLabel: string }) {
  return (
    <div className="training-results-grid power" role="region" aria-label={`Power by repetition spreadsheet for ${dateLabel}`} tabIndex={0}>
      <table>
        <caption>Peak power by rider and repetition for {dateLabel}</caption>
        <thead><tr><th scope="col">Rider</th>{matrix.columns.map((column) => (
          <th scope="col" className="number" title={column.title} key={column.sessionId}>{column.label}<small>{clockTime(column.startedAt)}</small></th>
        ))}</tr></thead>
        <tbody>{matrix.rows.map((row) => <tr key={row.riderKey}><th scope="row">{row.riderName}</th>{matrix.columns.map((column) => {
          const watts = row.peakWattsBySessionId[column.sessionId];
          return <td className="number" key={column.sessionId}>{watts == null ? missing : Math.round(watts).toLocaleString()}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function TrainingResultsSpreadsheet({
  sessions,
  dateLabel,
  speedUnit,
  distanceUnit,
  selectedSessionId,
  onSelectedSessionChange,
  onExportWorkbook,
  onExportPrivateWorkbook,
  privateExportDisabled = false,
  exportLabel = 'Numbers / Excel (.xlsx)',
  privateExportLabel = 'Private workbook + heart rate (.xlsx)',
  privateHeartRateBySession,
  consentedClubHeartRateBySession,
  renderSessionDetail,
}: TrainingResultsSpreadsheetProps) {
  const regionId = useId().replace(/:/g, '');
  const rows = useMemo(() => buildTrainingResultRows(sessions), [sessions]);
  const powerMatrix = useMemo(() => buildTrainingPowerRepMatrix(sessions, rows), [rows, sessions]);
  const sheets = useMemo(() => availableTrainingResultSheets(sessions, rows, powerMatrix), [powerMatrix, rows, sessions]);
  const [activeSheetId, setActiveSheetId] = useState<TrainingResultSheetId>('all');
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const controlledSelection = selectedSessionId !== undefined;
  const requestedSelectedId = controlledSelection ? selectedSessionId : internalSelectedId;
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const selectedSession = requestedSelectedId ? sessionById.get(requestedSelectedId) ?? null : null;
  const effectiveSelectedId = selectedSession?.id ?? null;
  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0];
  const canReview = Boolean(renderSessionDetail || onSelectedSessionChange);
  const riderCountBySession = useMemo(() => {
    const resultSlots = new Map<string, number>();
    rows.forEach((row) => {
      resultSlots.set(row.sessionId, (resultSlots.get(row.sessionId) ?? 0) + 1);
    });
    return resultSlots;
  }, [rows]);
  const resolveHeartRate: PrivateHeartRateResolver = (row) => {
    const privateProjections = privateHeartRateBySession?.get(row.sessionId) ?? [];
    const consentedClubProjections = consentedClubHeartRateBySession?.get(row.sessionId) ?? [];
    const projections: readonly TrainingHeartRateProjection[] = privateProjections.length > 0
      ? privateProjections
      : consentedClubProjections;
    const riderCount = riderCountBySession.get(row.sessionId) ?? 1;
    const emptyLabel = sessionById.get(row.sessionId)?.club?.role === 'owner' || riderCount > 1
      ? 'Private rider only' as const
      : 'Not recorded' as const;
    const numericPlayerId = Number(row.playerId);
    const dataBearing = projections.filter((projection) => (
      projection.state === 'saved' || projection.state === 'syncing'
    ));
    const exact = Number.isInteger(numericPlayerId)
      ? dataBearing.filter((projection) => projection.playerId === numericPlayerId)
      : [];
    const matched = exact.length > 0
      ? exact
      : riderCount === 1 && dataBearing.length > 0
        && dataBearing.every((projection) => projection.playerId == null)
        ? dataBearing
        : [];
    if (matched.length > 0) return { projections: matched, emptyLabel };
    const stateOnly = projections.filter((projection) => (
      projection.state === 'loading'
      || projection.state === 'not-recorded'
      || projection.state === 'error'
      || (projection.state === 'syncing' && projection.summary == null)
    ));
    const exactState = stateOnly.filter((projection) => (
      Number.isInteger(numericPlayerId) && projection.playerId === numericPlayerId
    ));
    if (exactState.length > 0) return { projections: exactState, emptyLabel };
    return { projections: riderCount === 1 ? stateOnly : [], emptyLabel };
  };

  useEffect(() => {
    if (!sheets.some((sheet) => sheet.id === activeSheetId)) setActiveSheetId('all');
  }, [activeSheetId, sheets]);

  useEffect(() => {
    if (!controlledSelection && internalSelectedId && !sessionById.has(internalSelectedId)) setInternalSelectedId(null);
  }, [controlledSelection, internalSelectedId, sessionById]);

  const selectSession = (session: TrainingSession | null) => {
    if (!controlledSelection) setInternalSelectedId(session?.id ?? null);
    onSelectedSessionChange?.(session);
  };
  const moveSheetTab = (event: ReactKeyboardEvent<HTMLButtonElement>, sheetIndex: number) => {
    let nextIndex = sheetIndex;
    if (event.key === 'ArrowRight') nextIndex = (sheetIndex + 1) % sheets.length;
    else if (event.key === 'ArrowLeft') nextIndex = (sheetIndex - 1 + sheets.length) % sheets.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = sheets.length - 1;
    else return;
    event.preventDefault();
    setActiveSheetId(sheets[nextIndex].id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  };
  const review = (row: TrainingResultRow) => {
    const session = sessionById.get(row.sessionId);
    if (!session) return missing;
    const expanded = effectiveSelectedId === session.id;
    return (
      <button
        className="training-result-review"
        type="button"
        aria-controls={`${regionId}-detail`}
        aria-expanded={expanded}
        onClick={() => selectSession(expanded ? null : session)}
      >{expanded ? 'Hide details' : row.zoneCount > 0 ? 'Review zones' : 'View details'}</button>
    );
  };

  const activeRows = activeSheet.id === 'power-by-rep'
    ? []
    : rowsForTrainingResultSheet(rows, activeSheet.id);
  const resultsGridRef = useRef<HTMLDivElement>(null);
  const lastVisibleResultRowsRef = useRef<Readonly<{ sheetId: TrainingResultSheetId; version: string }> | null>(null);
  const visibleResultRowsVersion = useMemo(() => activeRows.map((row) => (
    `${row.id}:${sessionById.get(row.sessionId)?.updatedAt ?? 0}:${JSON.stringify(row)}`
  )).join('\u001e'), [activeRows, sessionById]);
  const columns = activeSheet.id === 'race-sprint'
    ? raceColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review)
    : activeSheet.id === 'get-pulled'
      ? getPulledColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review)
      : activeSheet.id === 'monitor-sprint'
        ? monitorColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review)
        : activeSheet.id === 'explore'
          ? exploreColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review)
          : commonColumns(speedUnit, distanceUnit, resolveHeartRate, canReview, review);

  useLayoutEffect(() => {
    if (activeSheet.id === 'power-by-rep') {
      lastVisibleResultRowsRef.current = null;
      return;
    }

    const previous = lastVisibleResultRowsRef.current;
    if (previous && previous.sheetId === activeSheet.id && previous.version !== visibleResultRowsVersion) {
      const grid = resultsGridRef.current;
      if (grid) grid.scrollTop = grid.scrollHeight;
    }
    lastVisibleResultRowsRef.current = { sheetId: activeSheet.id, version: visibleResultRowsVersion };
  }, [activeSheet.id, visibleResultRowsVersion]);

  return (
    <section
      className="training-results-sheet"
      aria-labelledby={`${regionId}-title`}
      aria-busy={privateExportDisabled || undefined}
    >
      <header className="training-results-heading">
        <div><span className="eyebrow">Selected day</span><h2 id={`${regionId}-title`}>Training results spreadsheet</h2><p>{dateLabel} · {sessions.length} saved {sessions.length === 1 ? 'session' : 'sessions'}</p></div>
        {(onExportWorkbook || onExportPrivateWorkbook) && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap' }}>
          {onExportWorkbook && <button type="button" disabled={sessions.length === 0} onClick={onExportWorkbook}><Download size={16} /> {exportLabel}</button>}
          {onExportPrivateWorkbook && <button
            type="button"
            style={{ borderColor: '#b7a1dc', background: '#f6f0ff', color: '#43217b' }}
            disabled={sessions.length === 0 || privateExportDisabled}
            aria-label={`${privateExportLabel}${privateExportDisabled ? '. Unavailable while private heart-rate data is loading or syncing.' : ''}`}
            title={privateExportDisabled ? 'Wait for private heart-rate data to finish loading and syncing.' : undefined}
            onClick={onExportPrivateWorkbook}
          ><Download size={16} /> {privateExportLabel}</button>}
        </div>}
      </header>

      {sessions.length > 0 ? <>
        <div className="training-sheet-tabs" role="tablist" aria-label="Result spreadsheet sheets">
          {sheets.map((sheet, sheetIndex) => <button
            id={`${regionId}-tab-${sheet.id}`}
            type="button"
            role="tab"
            aria-controls={`${regionId}-panel`}
            aria-selected={sheet.id === activeSheet.id}
            tabIndex={sheet.id === activeSheet.id ? 0 : -1}
            onClick={() => setActiveSheetId(sheet.id)}
            onKeyDown={(event) => moveSheetTab(event, sheetIndex)}
            key={sheet.id}
          >{sheet.label}<small>{sheet.rowCount}</small></button>)}
        </div>
        <div id={`${regionId}-panel`} role="tabpanel" aria-labelledby={`${regionId}-tab-${activeSheet.id}`}>
          {activeSheet.id === 'power-by-rep'
            ? <PowerTable matrix={powerMatrix} dateLabel={dateLabel} />
            : <ResultTable
              rows={activeRows}
              columns={columns}
              caption={`${activeSheet.label} for ${dateLabel}`}
              regionLabel={`${activeSheet.label} spreadsheet for ${dateLabel}`}
              selectedSessionId={effectiveSelectedId}
              gridRef={resultsGridRef}
            />}
        </div>
        {selectedSession && renderSessionDetail && <div className="training-result-detail" id={`${regionId}-detail`}>
          <div><strong>{selectedSession.title}</strong><button type="button" aria-label="Close session details" onClick={() => selectSession(null)}><X size={16} /> Close</button></div>
          {renderSessionDetail(selectedSession)}
        </div>}
      </> : <div className="training-results-empty"><TableProperties size={32} /><strong>No training saved on this day</strong><p>Finished races, sprints, pulls, and Explore rides will appear here automatically.</p></div>}
    </section>
  );
}
