import type {
  CellObject,
  Sheet,
  SheetData,
} from 'write-excel-file/browser';
import type { TrainingSession } from '../types';
import { trainingSessionZoneResults } from './trainingHistory';
import {
  buildTrainingPowerRepMatrix,
  buildTrainingResultRows,
  trainingActivityLabels,
  type TrainingResultRow,
} from './trainingResultsGrid';

type BrowserWorkbookSheet = Sheet<File | Blob | ArrayBuffer>;

type RiderSpreadsheetResult = Readonly<{
  playerId: string;
  riderId: string;
  riderName: string;
  rank: number | null;
  finishSeconds: number | null;
  thirtyFootSeconds: number | null;
  reactionMilliseconds: number | null;
  distanceMeters: number | null;
  sampleCount: number | null;
  averageSpeedKph: number | null;
  peakSpeedKph: number | null;
  averageCadenceRpm: number | null;
  peakCadenceRpm: number | null;
  averagePowerWatts: number | null;
  peakPowerWatts: number | null;
}>;

const headerStyle = {
  align: 'center' as const,
  alignVertical: 'center' as const,
  backgroundColor: '#101828',
  borderColor: '#667085',
  borderStyle: 'thin' as const,
  fontWeight: 'bold' as const,
  height: 28,
  textColor: '#FFFFFF',
  wrap: true,
};

const textStyle = {
  alignVertical: 'top' as const,
  borderColor: '#D0D5DD',
  borderStyle: 'thin' as const,
  wrap: true,
};

const numberStyle = {
  ...textStyle,
  align: 'right' as const,
};

const titleStyle = {
  align: 'left' as const,
  alignVertical: 'center' as const,
  backgroundColor: '#EAF8DF',
  borderColor: '#79C850',
  borderStyle: 'thin' as const,
  fontSize: 14,
  fontWeight: 'bold' as const,
  height: 34,
  textColor: '#214E15',
  wrap: true,
};

function safeText(value: unknown) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .slice(0, 500);
}

function textCell(value: unknown, header = false): CellObject {
  return {
    value: safeText(value),
    type: String,
    ...(header ? headerStyle : textStyle),
  };
}

function titleRow(title: string, columnCount: number): SheetData[number] {
  return [
    {
      value: safeText(title),
      type: String,
      columnSpan: columnCount,
      ...titleStyle,
    },
    ...Array.from({ length: Math.max(0, columnCount - 1) }, () => null),
  ];
}

function numericValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberCell(value: unknown, format = '0.00'): CellObject | null {
  const number = numericValue(value);
  return number == null ? null : {
    value: number,
    type: Number,
    format,
    ...numberStyle,
  };
}

/**
 * XLSX dates have no timezone. `write-excel-file` serializes `Date#getTime()`,
 * so a normal local Date would shift by the browser's UTC offset when opened in
 * Numbers or Excel. Re-encode the intended local wall-clock components as UTC
 * before handing the Date to the writer.
 */
function spreadsheetWallClockDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const local = new Date(value);
  if (Number.isNaN(local.getTime())) return null;
  return new Date(Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
  ));
}

function dateCell(value: number): CellObject | null {
  const date = spreadsheetWallClockDate(value);
  return date == null ? null : {
    value: date,
    type: Date,
    format: 'mm/dd/yyyy h:mm AM/PM',
    ...textStyle,
  };
}

function millisecondsToSeconds(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value / 1_000;
}

/**
 * Kept as a small compatibility surface for focused metric tests. The workbook
 * itself consumes the shared result rows directly so in-app and exported data
 * cannot drift onto separate parsing paths.
 */
export function trainingSessionSpreadsheetResults(session: TrainingSession): RiderSpreadsheetResult[] {
  return buildTrainingResultRows([session]).map((row) => ({
    playerId: safeText(row.playerId),
    riderId: safeText(row.riderId),
    riderName: safeText(row.riderName),
    rank: row.rank,
    finishSeconds: millisecondsToSeconds(row.finishTimeMs),
    thirtyFootSeconds: millisecondsToSeconds(row.thirtyFootTimeMs),
    reactionMilliseconds: row.reactionTimeMs,
    distanceMeters: row.distanceMeters,
    sampleCount: row.sampleCount,
    averageSpeedKph: row.averageSpeedKph,
    peakSpeedKph: row.peakSpeedKph,
    averageCadenceRpm: row.averageCadence,
    peakCadenceRpm: row.peakCadence,
    averagePowerWatts: row.averageWatts,
    peakPowerWatts: row.peakWatts,
  }));
}

function sortedSessions(sessions: readonly TrainingSession[]) {
  return [...sessions].sort((left, right) => (
    left.startedAt - right.startedAt || left.id.localeCompare(right.id)
  ));
}

function workbookDateLabel(sessions: readonly TrainingSession[]) {
  return sessions[0] ? localDateKey(sessions[0].startedAt) : 'No date selected';
}

function sessionsSheet(sessions: readonly TrainingSession[]): BrowserWorkbookSheet {
  const headers = [
    'Session', 'Started', 'Activity', 'Title', 'Track', 'Duration (s)', 'Distance (m)',
    'Training context',
  ];
  const data: SheetData = [
    titleRow(`TrackLab training · ${workbookDateLabel(sessions)} · Sessions`, headers.length),
    headers.map((header) => textCell(header, true)),
  ];
  sessions.forEach((session, index) => {
    data.push([
      numberCell(index + 1, '0'),
      dateCell(session.startedAt),
      textCell(trainingActivityLabels[session.activityType]),
      textCell(session.title),
      textCell(session.trackName ?? ''),
      numberCell(session.durationMs / 1_000),
      numberCell(session.distanceMeters),
      textCell(session.club ? `${session.club.name} / ${session.club.riderName}` : 'Personal'),
    ]);
  });
  return {
    data,
    sheet: 'Sessions',
    stickyRowsCount: 2,
    stickyColumnsCount: 1,
    showGridLines: true,
    columns: [
      { width: 10 }, { width: 22 }, { width: 20 }, { width: 34 }, { width: 28 },
      { width: 14 }, { width: 14 }, { width: 28 },
    ],
  };
}

function resultStatusLabel(row: TrainingResultRow) {
  if (row.status === 'dnf') return 'DNF';
  if (row.status === 'finished') return 'Finished';
  return 'Saved';
}

function riderResultsSheet(
  sessions: readonly TrainingSession[],
  results: readonly TrainingResultRow[],
): BrowserWorkbookSheet {
  const headers = [
    'Session', 'Started', 'Activity', 'Rider', 'Status', 'Rank', 'Finish (s)', '30 ft (s)',
    'Reaction (ms)', 'Recorded duration (s)', 'Planned duration (s)', 'Air', 'Distance (m)',
    'Analysis points', 'Average speed (kph)', 'Peak speed (kph)', 'Average cadence (rpm)',
    'Peak cadence (rpm)', 'Average power (W)', 'Peak power (W)', 'Route origin',
    'Route destination', 'Elevation gain (m)', 'Elevation loss (m)', 'Zones',
  ];
  const data: SheetData = [
    titleRow(`TrackLab training · ${workbookDateLabel(sessions)} · Rider Results`, headers.length),
    headers.map((header) => textCell(header, true)),
  ];
  results.forEach((result) => {
    data.push([
      numberCell(result.sessionOrdinal, '0'),
      dateCell(result.startedAt),
      textCell(trainingActivityLabels[result.activityType]),
      textCell(result.riderName),
      textCell(resultStatusLabel(result)),
      numberCell(result.rank, '0'),
      numberCell(millisecondsToSeconds(result.finishTimeMs), '0.00'),
      numberCell(millisecondsToSeconds(result.thirtyFootTimeMs), '0.000'),
      numberCell(result.reactionTimeMs, '0'),
      numberCell(millisecondsToSeconds(result.durationMs), '0.00'),
      numberCell(millisecondsToSeconds(result.plannedDurationMs), '0.00'),
      numberCell(result.airSetting, '0'),
      numberCell(result.distanceMeters),
      numberCell(result.sampleCount, '0'),
      numberCell(result.averageSpeedKph),
      numberCell(result.peakSpeedKph),
      numberCell(result.averageCadence),
      numberCell(result.peakCadence),
      numberCell(result.averageWatts, '0'),
      numberCell(result.peakWatts, '0'),
      textCell(result.routeOrigin),
      textCell(result.routeDestination),
      numberCell(result.elevationGainMeters),
      numberCell(result.elevationLossMeters),
      numberCell(result.zoneCount, '0'),
    ]);
  });
  return {
    data,
    sheet: 'Rider Results',
    stickyRowsCount: 2,
    stickyColumnsCount: 4,
    showGridLines: true,
    columns: [
      { width: 10 }, { width: 22 }, { width: 18 }, { width: 28 }, { width: 12 },
      { width: 9 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 20 },
      { width: 20 }, { width: 9 }, { width: 14 }, { width: 16 }, { width: 20 },
      { width: 18 }, { width: 22 }, { width: 20 }, { width: 20 }, { width: 18 },
      { width: 24 }, { width: 24 }, { width: 18 }, { width: 18 }, { width: 9 },
    ],
  };
}

function zoneResultsSheet(
  sessions: readonly TrainingSession[],
  results: readonly TrainingResultRow[],
): BrowserWorkbookSheet {
  const headers = [
    'Session', 'Started', 'Activity', 'Rider', 'Zone', 'Zone name', 'Zone type',
    'Start (m)', 'End (m)', 'Entry (s)', 'Exit (s)', 'Duration (s)', 'Analysis points',
    'Average speed (kph)', 'Peak speed (kph)', 'Average cadence (rpm)',
    'Peak cadence (rpm)', 'Average power (W)', 'Peak power (W)',
  ];
  const data: SheetData = [
    titleRow(`TrackLab training · ${workbookDateLabel(sessions)} · Zone Results`, headers.length),
    headers.map((header) => textCell(header, true)),
  ];
  const resultsBySession = new Map<string, TrainingResultRow[]>();
  results.forEach((result) => {
    resultsBySession.set(result.sessionId, [...(resultsBySession.get(result.sessionId) ?? []), result]);
  });
  sessions.forEach((session, sessionIndex) => {
    const sessionResults = resultsBySession.get(session.id) ?? [];
    const riderNames = new Map(sessionResults.flatMap((result) => (
      result.playerId == null ? [] : [[String(result.playerId), result.riderName] as const]
    )));
    const singleRiderName = sessionResults.length === 1 ? sessionResults[0].riderName : '';
    trainingSessionZoneResults(session).forEach((zone, zoneIndex) => {
      zone.riders.forEach((rider) => {
        const playerId = safeText(rider.playerId);
        data.push([
          numberCell(sessionIndex + 1, '0'),
          dateCell(session.startedAt),
          textCell(trainingActivityLabels[session.activityType]),
          textCell((riderNames.get(playerId) ?? singleRiderName) || `Rider ${playerId || '—'}`),
          numberCell(zoneIndex + 1, '0'),
          textCell(zone.zoneName || zone.zoneId),
          textCell(zone.zoneType),
          numberCell(zone.startMeter),
          numberCell(zone.endMeter),
          numberCell(millisecondsToSeconds(rider.entryElapsedMs), '0.000'),
          numberCell(millisecondsToSeconds(rider.exitElapsedMs), '0.000'),
          numberCell(millisecondsToSeconds(rider.durationMs), '0.000'),
          numberCell(rider.sampleCount, '0'),
          numberCell(rider.averageSpeedKph),
          numberCell(rider.topSpeedKph),
          numberCell(rider.averageCadence),
          numberCell(rider.topCadence),
          numberCell(rider.averageWatts, '0'),
          numberCell(rider.topWatts, '0'),
        ]);
      });
    });
  });
  return {
    data,
    sheet: 'Zone Results',
    stickyRowsCount: 2,
    stickyColumnsCount: 4,
    showGridLines: true,
    columns: [
      { width: 10 }, { width: 22 }, { width: 20 }, { width: 28 }, { width: 9 },
      { width: 24 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 12 }, { width: 14 }, { width: 16 }, { width: 20 }, { width: 18 },
      { width: 22 }, { width: 20 }, { width: 20 }, { width: 18 },
    ],
  };
}

function powerByRepSheet(
  sessions: readonly TrainingSession[],
  results: readonly TrainingResultRow[],
): BrowserWorkbookSheet | null {
  const matrix = buildTrainingPowerRepMatrix(sessions, [...results]);
  if (matrix.columns.length < 2 || matrix.rows.length === 0) return null;

  const headers = ['Rider', ...matrix.columns.map((column) => column.label)];
  const data: SheetData = [
    titleRow(`TrackLab training · ${workbookDateLabel(sessions)} · Power by Rep`, headers.length),
    headers.map((header) => textCell(header, true)),
  ];
  matrix.rows.forEach((rider) => {
    data.push([
      textCell(rider.riderName),
      ...matrix.columns.map((column) => numberCell(
        rider.peakWattsBySessionId[column.sessionId],
        '0',
      )),
    ]);
  });
  return {
    data,
    sheet: 'Power by Rep',
    stickyRowsCount: 2,
    stickyColumnsCount: 1,
    showGridLines: true,
    columns: [{ width: 30 }, ...matrix.columns.map(() => ({ width: 18 }))],
  };
}

export function buildTrainingDayWorkbook(sessions: readonly TrainingSession[]): BrowserWorkbookSheet[] {
  const orderedSessions = sortedSessions(sessions);
  const results = buildTrainingResultRows(orderedSessions);
  const sheets = [
    sessionsSheet(orderedSessions),
    riderResultsSheet(orderedSessions, results),
    zoneResultsSheet(orderedSessions, results),
  ];
  const powerSheet = powerByRepSheet(orderedSessions, results);
  if (powerSheet) sheets.push(powerSheet);
  return sheets;
}

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function trainingDaySpreadsheetFilename(
  selectedDate?: string | number | Date,
  sessions: readonly TrainingSession[] = [],
) {
  const explicitDate = typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(selectedDate)
    ? selectedDate
    : selectedDate instanceof Date
      ? localDateKey(selectedDate.getTime())
      : typeof selectedDate === 'number' && Number.isFinite(selectedDate)
        ? localDateKey(selectedDate)
        : sessions[0]
          ? localDateKey(sessions[0].startedAt)
          : localDateKey(Date.now());
  return `tracklab-training-${explicitDate}.xlsx`;
}

export async function downloadTrainingDaySpreadsheet(
  sessions: readonly TrainingSession[],
  selectedDate?: string | number | Date,
) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  await writeExcelFile(buildTrainingDayWorkbook(sessions), {
    fontFamily: 'Arial',
    fontSize: 10,
  }).toFile(trainingDaySpreadsheetFilename(selectedDate, sessions));
}
