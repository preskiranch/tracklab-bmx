import { describe, expect, it } from 'vitest';
import type { Cell, SheetData } from 'write-excel-file/browser';
import type { TrainingSession } from '../../src/types';
import {
  buildPrivateTrainingDayWorkbook,
  buildTrainingDayWorkbook,
  privateTrainingDaySpreadsheetFilename,
  trainingDaySpreadsheetFilename,
  trainingSessionSpreadsheetResults,
} from '../../src/lib/trainingSpreadsheetExport';
import type { PrivateTrainingHeartRateProjection } from '../../src/lib/privateTrainingHeartRate';

function cellValue(cell: Cell) {
  return cell && typeof cell === 'object' && !(cell instanceof Date)
    ? cell.value
    : cell;
}

function rowValues(data: SheetData, index: number) {
  return data[index].map(cellValue);
}

function spreadsheetWallClockDate(timestamp: number) {
  const local = new Date(timestamp);
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

function rowRecord(data: SheetData, index: number) {
  const headers = rowValues(data, 1).map(String);
  const values = rowValues(data, index);
  return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
}

function raceSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'race-session',
    activityType: 'bmx-race',
    title: '=HYPERLINK("https://bad.example","Race")',
    startedAt: new Date(2026, 7, 24, 9, 30).getTime(),
    endedAt: new Date(2026, 7, 24, 9, 30, 12).getTime(),
    durationMs: 12_000,
    distanceMeters: 320,
    trackId: 'mapped-track',
    trackName: '+Mapped Track',
    source: 'live',
    createdAt: new Date(2026, 7, 24, 9, 30).getTime(),
    updatedAt: new Date(2026, 7, 24, 9, 30, 12).getTime(),
    details: {
      summaries: [{
        playerId: 1,
        riderId: 'rider-one',
        riderName: '@Rider One',
        rank: 1,
        finishTimeMs: 11_825,
        thirtyFootTimeMs: 1_721,
        distanceMeters: 320,
        sampleCount: 44,
        topSpeedKph: 46.2,
        averageSpeedKph: 35.8,
        topCadence: 184,
        averageCadence: 162.5,
        topWatts: 1_240,
        averageWatts: 810,
      }],
      reactionTimesByPlayer: { 1: 181 },
      zoneResults: [{
        zoneId: 'zone-drive-one',
        zoneName: 'Drive one',
        zoneType: 'pedal',
        startMeter: 5,
        endMeter: 25,
        riders: [{
          playerId: 1,
          sampleCount: 13,
          entryElapsedMs: 300,
          exitElapsedMs: 1_180,
          durationMs: 880,
          topSpeedKph: 43.1,
          averageSpeedKph: 37.4,
          topCadence: 181,
          averageCadence: 168.2,
          topWatts: 1_210,
          averageWatts: 920.4,
        }],
      }],
      heartRate: { bpm: 199, samples: [{ bpm: 199 }] },
      privateHeartRate: { samples: [{ bpm: 201 }] },
    },
    ...overrides,
  };
}

function utilitySession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'monitor-session',
    activityType: 'monitor-sprint',
    title: 'Monitor sprint',
    startedAt: new Date(2026, 7, 24, 9, 0).getTime(),
    endedAt: new Date(2026, 7, 24, 9, 0, 8).getTime(),
    durationMs: 8_000,
    distanceMeters: 77,
    trackId: 'monitor',
    trackName: 'Monitor View',
    source: 'live',
    createdAt: new Date(2026, 7, 24, 9, 0).getTime(),
    updatedAt: new Date(2026, 7, 24, 9, 0, 8).getTime(),
    details: {
      riders: [{
        playerId: 1,
        riderId: 'rider-one',
        name: '@Rider One',
        distanceMeters: 77,
        averageSpeedKph: 31.1,
        peakSpeedKph: 44.2,
        averageCadence: 153.2,
        peakCadence: 180,
        averageWatts: 790,
        peakWatts: 1_190,
      }],
    },
    ...overrides,
  };
}

function privateProjection(
  session: TrainingSession,
  overrides: Partial<PrivateTrainingHeartRateProjection> = {},
): PrivateTrainingHeartRateProjection {
  return {
    access: 'athlete-private',
    displayedSessionId: session.id,
    canonicalSessionId: session.id,
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
    zoneSummaries: [{
      zoneId: 'zone-drive-one',
      zoneName: 'Drive one',
      startElapsedMs: 300,
      endElapsedMs: 1_180,
      summary: {
        sampleCount: 4,
        coverageMs: 700,
        coveragePercent: 79.5,
        firstSampleElapsedMs: 320,
        lastSampleElapsedMs: 1_100,
        minimumBpm: 130,
        averageBpm: 151.4,
        peakBpm: 169,
      },
    }],
    ...overrides,
  };
}

describe('training day spreadsheet export', () => {
  it('creates ordered, typed Sessions, Rider Results, Zone Results, and Power by Rep sheets', () => {
    const workbook = buildTrainingDayWorkbook([raceSession(), utilitySession()]);

    expect(workbook.map((sheet) => sheet.sheet)).toEqual([
      'Sessions',
      'Rider Results',
      'Zone Results',
      'Power by Rep',
    ]);
    expect(rowValues(workbook[0].data, 0)[0]).toBe('TrackLab training · 2026-08-24 · Sessions');
    expect(workbook[0].stickyRowsCount).toBe(2);
    expect(rowValues(workbook[0].data, 2)).toEqual([
      1,
      spreadsheetWallClockDate(utilitySession().startedAt),
      'Monitor Sprint',
      'Monitor sprint',
      'Monitor View',
      8,
      77,
      'Personal',
    ]);
    expect(rowValues(workbook[1].data, 2)).toEqual([
      1,
      spreadsheetWallClockDate(utilitySession().startedAt),
      'Monitor Sprint',
      '@Rider One',
      'Finished',
      null,
      null,
      null,
      null,
      8,
      null,
      null,
      77,
      null,
      31.1,
      44.2,
      153.2,
      180,
      790,
      1190,
      '',
      '',
      null,
      null,
      0,
    ]);
    expect(workbook[1].data[3][6]).toMatchObject({ value: 11.825, type: Number, format: '0.00' });
    expect(workbook[1].data[3][7]).toMatchObject({ value: 1.721, type: Number, format: '0.000' });
    expect(workbook[1].data[3][8]).toMatchObject({ value: 181, type: Number, format: '0' });
    expect(rowValues(workbook[2].data, 2)).toEqual([
      2,
      spreadsheetWallClockDate(raceSession().startedAt),
      'BMX Race',
      '@Rider One',
      1,
      'Drive one',
      'pedal',
      5,
      25,
      0.3,
      1.18,
      0.88,
      13,
      37.4,
      43.1,
      168.2,
      181,
      920.4,
      1210,
    ]);
    expect(rowValues(workbook[3].data, 1)).toEqual([
      'Rider',
      'Sprint 1 peak W',
      'Race 1 peak W',
    ]);
    expect(rowValues(workbook[3].data, 2)).toEqual(['@Rider One', 1190, 1240]);
  });

  it('writes untrusted spreadsheet-looking text as explicit string cells and excludes health data', () => {
    const session = raceSession() as TrainingSession & Record<string, unknown>;
    session.AppleWatch = { pulse: 202 };
    session.restingPulse = 49;
    const summary = (session.details.summaries as Array<Record<string, unknown>>)[0];
    summary.pulse = 198;
    summary.hrv = 42;
    summary.appleHealth = { restingBpm: 49 };
    const workbook = buildTrainingDayWorkbook([session]);
    const sessions = workbook[0].data;
    const riderResults = workbook[1].data;
    const serialized = JSON.stringify(workbook);

    expect(sessions[2][3]).toMatchObject({
      value: '=HYPERLINK("https://bad.example","Race")',
      type: String,
    });
    expect(sessions[2][4]).toMatchObject({ value: '+Mapped Track', type: String });
    expect(riderResults[2][3]).toMatchObject({ value: '@Rider One', type: String });
    expect(serialized).not.toMatch(/heart.?rate|apple.?watch|apple.?health|resting.?pulse|"pulse"|"bpm"|"hrv"|"samples"/iu);
  });

  it('fails closed for invalid cadence and speed without dropping valid power', () => {
    const session = raceSession();
    const summary = (session.details.summaries as Array<Record<string, unknown>>)[0];
    summary.topSpeedKph = 151_080.1;
    summary.averageSpeedKph = 9.4;
    summary.topCadence = 923_334;
    summary.averageCadence = 68_458.7;

    expect(trainingSessionSpreadsheetResults(session)).toEqual([
      expect.objectContaining({
        peakSpeedKph: null,
        averageSpeedKph: 9.4,
        peakCadenceRpm: null,
        averageCadenceRpm: null,
        peakPowerWatts: 1_240,
      }),
    ]);
  });

  it('preserves club rider identity, DNF status, Get Pulled settings, and Explore route data', () => {
    const dnf = raceSession({ id: 'dnf-race' });
    const dnfSummary = (dnf.details.summaries as Array<Record<string, unknown>>)[0];
    dnfSummary.resultStatus = 'dnf';
    dnfSummary.finishTimeMs = null;

    const clubPull = utilitySession({
      id: 'club-pull',
      activityType: 'get-pulled',
      title: '10s Get Pulled',
      startedAt: new Date(2026, 7, 24, 10, 0).getTime(),
      endedAt: new Date(2026, 7, 24, 10, 0, 7).getTime(),
      durationMs: 7_000,
      distanceMeters: 82,
      club: {
        id: 'club-one',
        name: 'Preski Ranch',
        studioRiderId: 'studio-rider-one',
        riderName: 'Club Athlete',
        role: 'athlete',
      },
      details: {
        durationSeconds: 10,
        airSetting: 4,
        riders: [{ playerId: 1, distanceMeters: 82, peakWatts: 1_050 }],
      },
    });
    const explore = utilitySession({
      id: 'club-explore',
      activityType: 'explore',
      title: 'Explore route',
      startedAt: new Date(2026, 7, 24, 10, 30).getTime(),
      endedAt: new Date(2026, 7, 24, 10, 40).getTime(),
      durationMs: 600_000,
      distanceMeters: 1_609.344,
      club: clubPull.club,
      details: {
        originLabel: 'Studio start',
        destinationLabel: 'Hill finish',
        elevationGainMeters: 31.25,
        elevationLossMeters: 12.5,
        riders: [{ playerId: 1, distanceMeters: 1_609.344, averageSpeedMph: 12 }],
      },
    });

    const workbook = buildTrainingDayWorkbook([explore, clubPull, dnf]);
    const riderSheet = workbook[1].data;
    const dnfRow = rowRecord(riderSheet, 2);
    const pullRow = rowRecord(riderSheet, 3);
    const exploreRow = rowRecord(riderSheet, 4);

    expect(dnfRow.Status).toBe('DNF');
    expect(dnfRow['Finish (s)']).toBeNull();
    expect(pullRow).toMatchObject({
      Rider: 'Club Athlete',
      Activity: 'Get Pulled',
      Status: 'Finished',
      'Recorded duration (s)': 7,
      'Planned duration (s)': 10,
      Air: 4,
    });
    expect(exploreRow).toMatchObject({
      Rider: 'Club Athlete',
      Activity: 'Explore',
      'Route origin': 'Studio start',
      'Route destination': 'Hill finish',
      'Elevation gain (m)': 31.25,
      'Elevation loss (m)': 12.5,
    });
  });

  it('keeps eligible rep columns and their true activity numbering when a rep has no power', () => {
    const race = raceSession();
    const unpoweredPull = utilitySession({
      id: 'unpowered-pull',
      activityType: 'get-pulled',
      title: 'Unpowered pull',
      startedAt: new Date(2026, 7, 24, 9, 45).getTime(),
      endedAt: new Date(2026, 7, 24, 9, 45, 10).getTime(),
      durationMs: 10_000,
      details: {
        durationSeconds: 10,
        airSetting: 3,
        riders: [{ playerId: 1, riderId: 'rider-one', name: '@Rider One' }],
      },
    });
    const monitor = utilitySession({
      startedAt: new Date(2026, 7, 24, 10, 0).getTime(),
      endedAt: new Date(2026, 7, 24, 10, 0, 8).getTime(),
    });

    const workbook = buildTrainingDayWorkbook([monitor, unpoweredPull, race]);
    const powerSheet = workbook.find((sheet) => sheet.sheet === 'Power by Rep');

    expect(powerSheet).toBeDefined();
    expect(rowValues(powerSheet!.data, 1)).toEqual([
      'Rider',
      'Race 1 peak W',
      'Pull 1 peak W',
      'Sprint 1 peak W',
    ]);
    expect(rowValues(powerSheet!.data, 2)).toEqual(['@Rider One', 1240, null, 1190]);
  });

  it('omits Power by Rep unless at least two eligible non-Explore reps exist with rider power', () => {
    const session = raceSession();
    const summary = (session.details.summaries as Array<Record<string, unknown>>)[0];
    delete summary.topWatts;
    delete summary.averageWatts;
    const zoneRider = (session.details.zoneResults as Array<{ riders: Array<Record<string, unknown>> }>)[0].riders[0];
    delete zoneRider.topWatts;
    delete zoneRider.averageWatts;

    expect(buildTrainingDayWorkbook([session]).map((sheet) => sheet.sheet)).toEqual([
      'Sessions',
      'Rider Results',
      'Zone Results',
    ]);

    const poweredRace = raceSession();
    const poweredExplore = raceSession({
      id: 'explore-with-power',
      activityType: 'explore',
      startedAt: poweredRace.startedAt + 1_000,
    });
    expect(buildTrainingDayWorkbook([poweredRace, poweredExplore]).map((sheet) => sheet.sheet))
      .not.toContain('Power by Rep');
  });

  it('uses the selected local day in a safe Numbers-compatible workbook filename', () => {
    expect(trainingDaySpreadsheetFilename('2026-08-24')).toBe('tracklab-training-2026-08-24.xlsx');
    expect(trainingDaySpreadsheetFilename(undefined, [raceSession()])).toBe('tracklab-training-2026-08-24.xlsx');
    expect(privateTrainingDaySpreadsheetFilename('2026-08-24')).toBe('tracklab-private-training-2026-08-24.xlsx');
  });

  it('adds exact private heart-rate metrics inline and in segment-preserving private sheets', () => {
    const session = raceSession();
    const heartRate = new Map([[session.id, [privateProjection(session)]]]);
    const workbook = buildPrivateTrainingDayWorkbook([session], heartRate);

    expect(workbook.map((sheet) => sheet.sheet)).toEqual([
      'Sessions',
      'Private Rider Results',
      'Private Zone Results',
      'Private HR Summary',
      'Private HR Zones',
    ]);
    expect(rowRecord(workbook[1].data, 2)).toMatchObject({
      'Private heart-rate status': 'Saved',
      'Minimum heart rate (bpm)': 101,
      'Average heart rate (bpm)': 142.5,
      'Peak heart rate (bpm)': 181,
      'Heart-rate samples': 8,
      'Heart-rate coverage (s)': 8,
      'Heart-rate coverage (%)': 80,
    });
    expect(rowRecord(workbook[2].data, 2)).toMatchObject({
      'Private heart-rate status': 'Saved',
      'Average heart rate (bpm)': 151.4,
      'Peak heart rate (bpm)': 169,
      'Heart-rate samples': 4,
      'Heart-rate coverage (%)': 79.5,
    });
    expect(rowRecord(workbook[3].data, 2)).toMatchObject({
      Rider: '@Rider One',
      'Watch segment': 1,
      'Average heart rate (bpm)': 142.5,
    });
    expect(rowRecord(workbook[4].data, 2)).toMatchObject({
      Rider: '@Rider One',
      'Watch segment': 1,
      'Zone name': 'Drive one',
      'Average heart rate (bpm)': 151.4,
    });
    expect(JSON.stringify(workbook)).not.toMatch(/pairingId|streamId|canonicalSessionId|recordedAt|sequence/iu);
  });

  it('does not average multiple Watch segments in inline cells', () => {
    const session = raceSession();
    const heartRate = new Map([[session.id, [
      privateProjection(session),
      privateProjection(session, {
        summary: {
          sampleCount: 3,
          coverageMs: 2_000,
          coveragePercent: 20,
          firstSampleElapsedMs: 9_100,
          lastSampleElapsedMs: 11_000,
          minimumBpm: 170,
          averageBpm: 175,
          peakBpm: 185,
        },
      }),
    ]]]);
    const workbook = buildPrivateTrainingDayWorkbook([session], heartRate);

    const inline = rowRecord(workbook[1].data, 2);
    expect(inline['Private heart-rate status']).toBe('Multiple Watch segments — see Private HR Summary');
    expect(inline['Average heart rate (bpm)']).toBeNull();
    expect(workbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(4);
    expect(workbook.find((sheet) => sheet.sheet === 'Private HR Zones')!.data).toHaveLength(4);
  });

  it('rejects wrong-canonical and club-owner projections from the private workbook', () => {
    const personal = raceSession();
    const wrongCanonical = privateProjection(personal, { canonicalSessionId: 'another-session' });
    const personalWorkbook = buildPrivateTrainingDayWorkbook(
      [personal],
      new Map([[personal.id, [wrongCanonical]]]),
    );
    expect(rowRecord(personalWorkbook[1].data, 2)['Private heart-rate status']).toBe('Not recorded');
    expect(personalWorkbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(2);

    const ownerSession = raceSession({
      id: 'club-owner:club-1:rider-1:race-session',
      club: {
        id: 'club-1', name: 'Test club', studioRiderId: 'rider-1',
        riderName: 'Rider One', role: 'owner',
      },
    });
    const forgedOwnerProjection = privateProjection(ownerSession, {
      canonicalSessionId: 'race-session',
    });
    const ownerWorkbook = buildPrivateTrainingDayWorkbook(
      [ownerSession],
      new Map([[ownerSession.id, [forgedOwnerProjection]]]),
    );
    expect(rowRecord(ownerWorkbook[1].data, 2)['Private heart-rate status']).toBe('Private rider only');
    expect(ownerWorkbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(2);
  });

  it('keeps unmatched entrants private in multi-rider results and excludes wrong-player details', () => {
    const session = raceSession();
    const summaries = session.details.summaries as Array<Record<string, unknown>>;
    summaries.push({
      ...summaries[0],
      playerId: 2,
      riderId: 'rider-two',
      riderName: 'Rider Two',
      rank: 2,
    });
    const zones = session.details.zoneResults as Array<{ riders: Array<Record<string, unknown>> }>;
    zones[0].riders.push({ ...zones[0].riders[0], playerId: 2 });
    const workbook = buildPrivateTrainingDayWorkbook(
      [session],
      new Map([[session.id, [privateProjection(session)]]]),
    );

    expect(rowRecord(workbook[1].data, 2)['Private heart-rate status']).toBe('Saved');
    expect(rowRecord(workbook[1].data, 3)['Private heart-rate status']).toBe('Private rider only');
    expect(rowRecord(workbook[2].data, 2)['Private heart-rate status']).toBe('Saved');
    expect(rowRecord(workbook[2].data, 3)['Private heart-rate status']).toBe('Private rider only');
    expect(workbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(3);

    const wrongPlayerWorkbook = buildPrivateTrainingDayWorkbook(
      [raceSession()],
      new Map([['race-session', [privateProjection(raceSession(), { playerId: 99 })]]]),
    );
    expect(rowRecord(wrongPlayerWorkbook[1].data, 2)['Private heart-rate status']).toBe('Private rider only');
    expect(wrongPlayerWorkbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(2);
    expect(wrongPlayerWorkbook.find((sheet) => sheet.sheet === 'Private HR Zones')!.data).toHaveLength(2);
  });

  it('requires an exact recorded entry/exit window for inline private zone heart rate', () => {
    const missingWindow = raceSession();
    const missingWindowRider = (missingWindow.details.zoneResults as Array<{
      riders: Array<Record<string, unknown>>;
    }>)[0].riders[0];
    missingWindowRider.entryElapsedMs = null;
    missingWindowRider.exitElapsedMs = null;
    const missingWindowWorkbook = buildPrivateTrainingDayWorkbook(
      [missingWindow],
      new Map([[missingWindow.id, [privateProjection(missingWindow)]]]),
    );
    expect(rowRecord(missingWindowWorkbook[2].data, 2)).toMatchObject({
      'Private heart-rate status': 'No recorded zone window',
      'Average heart rate (bpm)': null,
      'Peak heart rate (bpm)': null,
    });
    expect(missingWindowWorkbook.find((sheet) => sheet.sheet === 'Private HR Zones')!.data)
      .toHaveLength(3);

    const zeroWindow = raceSession();
    const zeroWindowRider = (zeroWindow.details.zoneResults as Array<{
      riders: Array<Record<string, unknown>>;
    }>)[0].riders[0];
    zeroWindowRider.entryElapsedMs = 300;
    zeroWindowRider.exitElapsedMs = 300;
    expect(rowRecord(buildPrivateTrainingDayWorkbook(
      [zeroWindow],
      new Map([[zeroWindow.id, [privateProjection(zeroWindow)]]]),
    )[2].data, 2)['Private heart-rate status']).toBe('No recorded zone window');

    const wrongWindow = raceSession();
    const wrongWindowRider = (wrongWindow.details.zoneResults as Array<{
      riders: Array<Record<string, unknown>>;
    }>)[0].riders[0];
    wrongWindowRider.entryElapsedMs = 301;
    const wrongWindowWorkbook = buildPrivateTrainingDayWorkbook(
      [wrongWindow],
      new Map([[wrongWindow.id, [privateProjection(wrongWindow)]]]),
    );
    expect(rowRecord(wrongWindowWorkbook[2].data, 2)).toMatchObject({
      'Private heart-rate status': 'No valid zone samples',
      'Average heart rate (bpm)': null,
      'Peak heart rate (bpm)': null,
    });
  });

  it('does not collapse duplicate rider names and ids into the single-rider null fallback', () => {
    const session = raceSession();
    const summaries = session.details.summaries as Array<Record<string, unknown>>;
    summaries.push({
      ...summaries[0],
      playerId: 2,
      rank: 2,
    });
    const nullPlayerProjection = privateProjection(session, { playerId: null });
    const workbook = buildPrivateTrainingDayWorkbook(
      [session],
      new Map([[session.id, [nullPlayerProjection]]]),
    );

    expect(rowRecord(workbook[1].data, 2)['Private heart-rate status']).toBe('Private rider only');
    expect(rowRecord(workbook[1].data, 3)['Private heart-rate status']).toBe('Private rider only');
    expect(workbook.find((sheet) => sheet.sheet === 'Private HR Summary')!.data).toHaveLength(2);
    expect(workbook.find((sheet) => sheet.sheet === 'Private HR Zones')!.data).toHaveLength(2);
  });

  it('generates a valid formula-free XLSX with local wall-clock times', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser');
      const blob = await writeExcelFile(buildTrainingDayWorkbook([utilitySession(), raceSession()]), {
        fontFamily: 'Arial',
        fontSize: 10,
      }).toBlob();
      const bytes = new Uint8Array(await blob.arrayBuffer());

      expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(bytes.byteLength).toBeGreaterThan(5_000);

      const { strFromU8, unzipSync } = await import('fflate');
      const files = unzipSync(bytes);
      const workbookXml = strFromU8(files['xl/workbook.xml']);
      const sharedStringsXml = strFromU8(files['xl/sharedStrings.xml']);
      const sheetXml = Object.entries(files)
        .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
        .map(([, contents]) => strFromU8(contents));
      const startedSerial = sheetXml[0].match(/<c r="B3"[^>]*><v>([^<]+)<\/v><\/c>/u);
      const expectedStartedSerial = Date.UTC(2026, 7, 24, 9, 0) / 86_400_000 + 25_569;

      expect(workbookXml).toContain('name="Sessions"');
      expect(workbookXml).toContain('name="Rider Results"');
      expect(workbookXml).toContain('name="Zone Results"');
      expect(workbookXml).toContain('name="Power by Rep"');
      expect(sharedStringsXml).toContain('HYPERLINK');
      expect(sheetXml).toHaveLength(4);
      expect(Number(startedSerial?.[1])).toBeCloseTo(expectedStartedSerial, 8);
      expect(sheetXml.some((xml) => /<c[^>]*t="s"/u.test(xml))).toBe(true);
      expect(sheetXml.every((xml) => !xml.includes('<f'))).toBe(true);
    } finally {
      if (previousTimezone == null) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
