import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TrainingActivityType, TrainingSession } from '../../src/types';
import type { PrivateTrainingHeartRateProjection } from '../../src/lib/privateTrainingHeartRate';
import type { ConsentedClubTrainingHeartRateProjection } from '../../src/lib/clubTrainingHeartRate';
import { TrainingResultsSpreadsheet } from '../../src/components/TrainingResultsSpreadsheet';
import {
  availableTrainingResultSheets,
  buildTrainingPowerRepMatrix,
  buildTrainingResultRows,
  rowsForTrainingResultSheet,
} from '../../src/lib/trainingResultsGrid';

const start = 1_750_000_000_000;

function session(
  id: string,
  activityType: TrainingActivityType,
  offset: number,
  details: Record<string, unknown>,
  overrides: Partial<TrainingSession> = {},
): TrainingSession {
  return {
    id,
    activityType,
    title: `${activityType} ${id}`,
    startedAt: start + offset,
    endedAt: start + offset + 8_000,
    durationMs: 8_000,
    distanceMeters: 100,
    trackId: 'test-track',
    trackName: 'Test Track',
    source: 'live',
    details,
    createdAt: start + offset,
    updatedAt: start + offset + 8_000,
    ...overrides,
  };
}

function race(id: string, offset: number, riders: Array<{
  playerId: number;
  riderId: string;
  riderName: string;
  watts: number;
}>) {
  return session(id, 'straight-sprint', offset, {
    summaries: riders.map((rider, index) => ({
      ...rider,
      rank: index + 1,
      finishTimeMs: 8_000 + index * 100,
      thirtyFootTimeMs: 1_500 + index * 50,
      distanceMeters: 100,
      sampleCount: 40,
      topSpeedKph: 48 - index,
      averageSpeedKph: 39 - index,
      topCadence: 185 - index,
      averageCadence: 165 - index,
      topWatts: rider.watts,
      averageWatts: rider.watts - 200,
    })),
    reactionTimesByPlayer: Object.fromEntries(riders.map((rider, index) => [rider.playerId, 170 + index * 10])),
    zoneResults: [{
      zoneId: 'zone-1',
      zoneName: 'First straight',
      zoneType: 'pedal',
      startMeter: 5,
      endMeter: 25,
      riders: riders.map((rider) => ({ playerId: rider.playerId, sampleCount: 10 })),
    }],
  });
}

describe('training results spreadsheet row schemas', () => {
  it('builds chronological race rows with complete sanitized metrics and zone counts', () => {
    const rows = buildTrainingResultRows([race('later', 20_000, [{
      playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 1_240,
    }]), race('earlier', 0, [{
      playerId: 2, riderId: 'rider-two', riderName: 'Rider Two', watts: 980,
    }])]);

    expect(rows.map((row) => row.sessionId)).toEqual(['earlier', 'later']);
    expect(rows[0]).toMatchObject({
      sessionOrdinal: 1,
      activityOrdinal: 1,
      riderKey: 'id:rider-two',
      riderName: 'Rider Two',
      status: 'finished',
      rank: 1,
      finishTimeMs: 8_000,
      thirtyFootTimeMs: 1_500,
      reactionTimeMs: 170,
      sampleCount: 40,
      averageSpeedKph: 39,
      peakSpeedKph: 48,
      averageCadence: 165,
      peakCadence: 185,
      averageWatts: 780,
      peakWatts: 980,
      zoneCount: 1,
    });
  });

  it('keeps Get Pulled planned time separate from a shortened active result and accepts legacy MPH', () => {
    const pull = session('pull', 'get-pulled', 0, {
      durationSeconds: 10,
      airSetting: 4,
      riders: [{
        playerId: 1,
        riderId: 'rider-one',
        name: 'Rider One',
        resultStatus: 'dnf',
        distanceMeters: 34,
        averageSpeedMph: 17.5,
        peakSpeedMph: 24,
        averageCadence: 133,
        peakCadence: 181,
        averageWatts: 720,
        peakWatts: 1_050,
      }],
    }, { durationMs: 7_000, endedAt: start + 7_000 });
    const [row] = buildTrainingResultRows([pull]);

    expect(row).toMatchObject({
      status: 'dnf',
      durationMs: 7_000,
      plannedDurationMs: 10_000,
      airSetting: 4,
      averageSpeedKph: 17.5 * 1.609344,
      peakSpeedKph: 24 * 1.609344,
      peakWatts: 1_050,
    });
  });

  it('builds Explore route/elevation rows using the summed active clock', () => {
    const explore = session('explore', 'explore', 0, {
      originLabel: 'Preski Ranch',
      destinationLabel: 'Chula Vista BMX',
      elevationGainMeters: 32,
      elevationLossMeters: 18,
      activeClockSegments: [
        { startedAt: start, endedAt: start + 4_000 },
        { startedAt: start + 8_000, endedAt: start + 11_000 },
      ],
      riders: [{
        playerId: 1,
        name: 'Rider One',
        distanceMeters: 2_000,
        averageSpeedKph: 31,
        elevationGainMeters: 35,
        elevationLossMeters: 20,
      }],
    }, { durationMs: 11_000, endedAt: start + 11_000 });
    const [row] = buildTrainingResultRows([explore]);

    expect(row).toMatchObject({
      routeOrigin: 'Preski Ranch',
      routeDestination: 'Chula Vista BMX',
      durationMs: 7_000,
      distanceMeters: 2_000,
      averageSpeedKph: 31,
      elevationGainMeters: 35,
      elevationLossMeters: 20,
    });
    expect(row.peakWatts).toBeNull();
  });

  it('keeps atomic club utility identity and result status when scoped rows omit names and rider ids', () => {
    const club = {
      id: 'club-preski',
      name: 'Preski Ranch LLC',
      studioRiderId: 'studio-maya',
      riderName: 'Maya Torres',
      role: 'athlete' as const,
    };
    const pull = session('club-pull', 'get-pulled', 0, {
      durationSeconds: 10,
      airSetting: 5,
      riders: [{
        playerId: 1,
        resultStatus: 'dnf',
        distanceMeters: 28,
        averageWatts: 710,
        peakWatts: 1_080,
      }],
    }, { durationMs: 7_000, endedAt: start + 7_000, club });
    const explore = session('club-explore', 'explore', 20_000, {
      originLabel: 'Preski Ranch',
      destinationLabel: 'River trail',
      riders: [{
        playerId: 1,
        resultStatus: 'finished',
        distanceMeters: 1_600,
        averageSpeedMph: 18,
      }],
    }, { club });

    const [pullRow, exploreRow] = buildTrainingResultRows([explore, pull]);
    expect(pullRow).toMatchObject({
      riderKey: 'id:studio-maya',
      riderId: 'studio-maya',
      riderName: 'Maya Torres',
      status: 'dnf',
      plannedDurationMs: 10_000,
      durationMs: 7_000,
      airSetting: 5,
    });
    expect(exploreRow).toMatchObject({
      riderKey: 'id:studio-maya',
      riderId: 'studio-maya',
      riderName: 'Maya Torres',
      status: 'finished',
      routeOrigin: 'Preski Ranch',
      routeDestination: 'River trail',
    });
  });

  it('never reintroduces rejected astronomical cadence or speed into sheet rows', () => {
    const invalid = race('invalid', 0, [{
      playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 900,
    }]);
    const summary = (invalid.details.summaries as Array<Record<string, unknown>>)[0];
    summary.averageCadence = 68_458.7;
    summary.topCadence = 923_334;
    summary.averageSpeedKph = 9.4;
    summary.topSpeedKph = 151_080.1;

    const [row] = buildTrainingResultRows([invalid]);
    expect(row.averageCadence).toBeNull();
    expect(row.peakCadence).toBeNull();
    expect(row.averageSpeedKph).toBe(9.4);
    expect(row.peakSpeedKph).toBeNull();
  });

  it('keeps a saved session visible even when an imported/legacy detail row is absent', () => {
    const [row] = buildTrainingResultRows([session('legacy', 'monitor-sprint', 0, {})]);
    expect(row).toMatchObject({ sessionId: 'legacy', status: 'saved', riderName: 'Rider' });
    expect(row.peakWatts).toBeNull();
  });
});

describe('power-by-repetition sheet', () => {
  it('pivots riders into rows and chronological repetitions into columns with truthful blanks', () => {
    const sessions = [
      race('sprint-2', 20_000, [
        { playerId: 1, riderId: 'bobby', riderName: 'Bobby', watts: 1_467 },
        { playerId: 2, riderId: 'mason', riderName: 'Mason', watts: 652 },
      ]),
      race('sprint-1', 0, [
        { playerId: 1, riderId: 'bobby', riderName: 'Bobby', watts: 1_464 },
      ]),
    ];
    const matrix = buildTrainingPowerRepMatrix(sessions);

    expect(matrix.columns.map((column) => [column.sessionId, column.label])).toEqual([
      ['sprint-1', 'Sprint 1 peak W'],
      ['sprint-2', 'Sprint 2 peak W'],
    ]);
    expect(matrix.rows).toEqual([
      {
        riderKey: 'id:bobby',
        riderName: 'Bobby',
        peakWattsBySessionId: { 'sprint-1': 1_464, 'sprint-2': 1_467 },
      },
      {
        riderKey: 'id:mason',
        riderName: 'Mason',
        peakWattsBySessionId: { 'sprint-1': null, 'sprint-2': 652 },
      },
    ]);
  });

  it('retains a no-power repetition as a blank column without renumbering later results', () => {
    const first = race('sprint-1', 0, [{
      playerId: 1, riderId: 'bobby', riderName: 'Bobby', watts: 900,
    }]);
    const missing = race('sprint-2', 10_000, [{
      playerId: 1, riderId: 'bobby', riderName: 'Bobby', watts: 800,
    }]);
    const missingSummary = (missing.details.summaries as Array<Record<string, unknown>>)[0];
    delete missingSummary.topWatts;
    delete missingSummary.averageWatts;
    const third = race('sprint-3', 20_000, [{
      playerId: 1, riderId: 'bobby', riderName: 'Bobby', watts: 1_100,
    }]);

    const matrix = buildTrainingPowerRepMatrix([third, missing, first]);
    expect(matrix.columns.map((column) => [column.sessionId, column.label])).toEqual([
      ['sprint-1', 'Sprint 1 peak W'],
      ['sprint-2', 'Sprint 2 peak W'],
      ['sprint-3', 'Sprint 3 peak W'],
    ]);
    expect(matrix.rows[0].peakWattsBySessionId).toEqual({
      'sprint-1': 900,
      'sprint-2': null,
      'sprint-3': 1_100,
    });
  });

  it('offers only sheets that contain rows and gates the matrix until two reps exist', () => {
    const sprint = race('sprint', 0, [{
      playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 900,
    }]);
    const explore = session('explore', 'explore', 10_000, {
      riders: [{ playerId: 1, name: 'Rider One', distanceMeters: 1_000, averageSpeedMph: 17 }],
    });
    const rows = buildTrainingResultRows([sprint, explore]);
    expect(availableTrainingResultSheets([sprint, explore], rows).map((sheet) => sheet.id)).toEqual([
      'all', 'race-sprint', 'explore',
    ]);
    expect(rowsForTrainingResultSheet(rows, 'race-sprint')).toHaveLength(1);
    expect(rowsForTrainingResultSheet(rows, 'explore')).toHaveLength(1);
  });
});

describe('training results spreadsheet semantics', () => {
  it('renders a native read-only table, accessible sheet tabs, and workbook export action', () => {
    const sprint = race('sprint', 0, [{
      playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 900,
    }]);
    const html = renderToStaticMarkup(createElement(TrainingResultsSpreadsheet, {
      sessions: [sprint],
      dateLabel: 'August 24, 2026',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      onExportWorkbook: () => undefined,
      renderSessionDetail: () => null,
    }));

    expect(html).toContain('<table>');
    expect(html).toContain('<caption>All results for August 24, 2026</caption>');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Numbers / Excel (.xlsx)');
    expect(html).toContain('Review zones');
    expect(html).toContain('Avg speed');
    expect(html).toContain('Peak speed');
    expect(html).toContain('Avg cadence');
    expect(html).toContain('Peak cadence');
    expect(html).toContain('Avg power');
    expect(html).toContain('Peak power');
    expect(html).toContain('Air');
    expect(html).toContain('700 W');
    expect(html).toContain('900 W');
    expect(html).toContain('165.0 RPM');
    expect(html).toContain('185.0 RPM');
    expect(html).not.toContain('role="grid"');
    expect(html).not.toContain('contenteditable');
  });

  it('shows private heart-rate summary columns beside recorded bike metrics', () => {
    const sprint = race('sprint-heart-rate', 0, [{
      playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 900,
    }]);
    const projection: PrivateTrainingHeartRateProjection = {
      access: 'athlete-private',
      displayedSessionId: sprint.id,
      canonicalSessionId: sprint.id,
      state: 'saved',
      playerId: 1,
      summary: {
        sampleCount: 8,
        coverageMs: 8_000,
        coveragePercent: 80,
        firstSampleElapsedMs: 0,
        lastSampleElapsedMs: 9_000,
        minimumBpm: 101,
        averageBpm: 142.5,
        peakBpm: 181,
      },
      zoneSummaries: [],
    };
    const html = renderToStaticMarkup(createElement(TrainingResultsSpreadsheet, {
      sessions: [sprint],
      dateLabel: 'August 24, 2026',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      privateHeartRateBySession: new Map([[sprint.id, [projection]]]),
      onExportPrivateWorkbook: () => undefined,
    }));

    expect(html).toContain('Average heart rate');
    expect(html).toContain('Peak heart rate');
    expect(html).toContain('Heart-rate coverage / status');
    expect(html).toContain('143 BPM');
    expect(html).toContain('181 BPM');
    expect(html).toContain('8 samples · 80%');
    expect(html).toContain('Private workbook + heart rate (.xlsx)');
  });

  it('shows an exact rider-consented club summary in the owner day grid', () => {
    const base = race('club-owner:club-1:rider-1:shared-result', 0, [{
      playerId: 1, riderId: 'rider-1', riderName: 'Rider One', watts: 900,
    }]);
    const sprint: TrainingSession = {
      ...base,
      club: {
        id: 'club-1',
        name: 'Test Club',
        studioRiderId: 'rider-1',
        riderName: 'Rider One',
        role: 'owner',
      },
    };
    const projection: ConsentedClubTrainingHeartRateProjection = {
      access: 'club-consented-summary',
      displayedSessionId: sprint.id,
      canonicalSessionId: 'shared-result',
      state: 'saved',
      playerId: 1,
      summary: {
        sampleCount: 6,
        coverageMs: 6_000,
        coveragePercent: 75,
        firstSampleElapsedMs: 0,
        lastSampleElapsedMs: 7_000,
        minimumBpm: 110,
        averageBpm: 149,
        peakBpm: 187,
      },
      zoneSummaries: [],
    };
    const html = renderToStaticMarkup(createElement(TrainingResultsSpreadsheet, {
      sessions: [sprint],
      dateLabel: 'August 24, 2026',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      consentedClubHeartRateBySession: new Map([[sprint.id, [projection]]]),
    }));

    expect(html).toContain('149 BPM');
    expect(html).toContain('187 BPM');
    expect(html).toContain('6 samples · 75%');
    expect(html).not.toContain('Private rider only');
  });

  it('announces day-level loading and does not assign a null placeholder to every rider', () => {
    const sprint = race('multi-rider-heart-rate', 0, [
      { playerId: 1, riderId: 'rider-one', riderName: 'Rider One', watts: 900 },
      { playerId: 2, riderId: 'rider-two', riderName: 'Rider Two', watts: 850 },
    ]);
    const loading: PrivateTrainingHeartRateProjection = {
      access: 'athlete-private',
      displayedSessionId: sprint.id,
      canonicalSessionId: sprint.id,
      state: 'loading',
      playerId: null,
      summary: null,
      zoneSummaries: [],
    };
    const html = renderToStaticMarkup(createElement(TrainingResultsSpreadsheet, {
      sessions: [sprint],
      dateLabel: 'August 24, 2026',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      privateHeartRateBySession: new Map([[sprint.id, [loading]]]),
      privateExportDisabled: true,
      onExportPrivateWorkbook: () => undefined,
    }));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Private rider only');
    expect(html).not.toContain('Loading…');
  });

  it('does not treat duplicate rider names and ids as one result slot for legacy HR fallback', () => {
    const sprint = race('duplicate-rider-identity', 0, [
      { playerId: 1, riderId: 'shared-rider', riderName: 'Same Name', watts: 900 },
      { playerId: 2, riderId: 'shared-rider', riderName: 'Same Name', watts: 850 },
    ]);
    const nullPlayerProjection: PrivateTrainingHeartRateProjection = {
      access: 'athlete-private',
      displayedSessionId: sprint.id,
      canonicalSessionId: sprint.id,
      state: 'saved',
      playerId: null,
      summary: {
        sampleCount: 8,
        coverageMs: 8_000,
        coveragePercent: 80,
        firstSampleElapsedMs: 0,
        lastSampleElapsedMs: 9_000,
        minimumBpm: 101,
        averageBpm: 142.5,
        peakBpm: 181,
      },
      zoneSummaries: [],
    };
    const html = renderToStaticMarkup(createElement(TrainingResultsSpreadsheet, {
      sessions: [sprint],
      dateLabel: 'August 24, 2026',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      privateHeartRateBySession: new Map([[sprint.id, [nullPlayerProjection]]]),
    }));

    expect(html).toContain('Private rider only');
    expect(html).not.toContain('143 BPM');
    expect(html).not.toContain('181 BPM');
  });
});
