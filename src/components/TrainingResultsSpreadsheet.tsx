import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
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
import './TrainingResultsSpreadsheet.css';

export type TrainingResultsSpreadsheetProps = Readonly<{
  sessions: readonly TrainingSession[];
  dateLabel: string;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  selectedSessionId?: string | null;
  onSelectedSessionChange?: (session: TrainingSession | null) => void;
  onExportWorkbook?: () => void;
  exportLabel?: string;
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
  distanceUnit: DistanceUnit,
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
    { id: 'distance', label: 'Distance', render: (row) => distance(row.distanceMeters, distanceUnit, row.activityType === 'explore'), numeric: true },
    { id: 'peak-power', label: 'Peak power', render: (row) => metric(row.peakWatts, 'W'), numeric: true },
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function raceColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
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
    { id: 'zones', label: 'Zones', render: (row) => row.zoneCount > 0 ? row.zoneCount : missing, numeric: true },
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function getPulledColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
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
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function monitorColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  canReview: boolean,
  review: (row: TrainingResultRow) => ReactNode,
): GridColumn[] {
  return getPulledColumns(speedUnit, distanceUnit, canReview, review).filter((column) => (
    column.id !== 'target' && column.id !== 'air'
  ));
}

function exploreColumns(
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
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
    ...(canReview ? [{ id: 'review', label: 'Review', render: review } satisfies GridColumn] : []),
  ];
}

function ResultTable({
  rows,
  columns,
  caption,
  regionLabel,
  selectedSessionId,
}: {
  rows: readonly TrainingResultRow[];
  columns: readonly GridColumn[];
  caption: string;
  regionLabel: string;
  selectedSessionId: string | null;
}) {
  return (
    <div className="training-results-grid" role="region" aria-label={regionLabel} tabIndex={0}>
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
  exportLabel = 'Numbers / Excel (.xlsx)',
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
  const columns = activeSheet.id === 'race-sprint'
    ? raceColumns(speedUnit, distanceUnit, canReview, review)
    : activeSheet.id === 'get-pulled'
      ? getPulledColumns(speedUnit, distanceUnit, canReview, review)
      : activeSheet.id === 'monitor-sprint'
        ? monitorColumns(speedUnit, distanceUnit, canReview, review)
        : activeSheet.id === 'explore'
          ? exploreColumns(speedUnit, distanceUnit, canReview, review)
          : commonColumns(distanceUnit, canReview, review);

  return (
    <section className="training-results-sheet" aria-labelledby={`${regionId}-title`}>
      <header className="training-results-heading">
        <div><span className="eyebrow">Selected day</span><h2 id={`${regionId}-title`}>Training results spreadsheet</h2><p>{dateLabel} · {sessions.length} saved {sessions.length === 1 ? 'session' : 'sessions'}</p></div>
        {onExportWorkbook && <button type="button" disabled={sessions.length === 0} onClick={onExportWorkbook}><Download size={16} /> {exportLabel}</button>}
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
