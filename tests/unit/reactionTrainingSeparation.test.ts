import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingSession } from '../../src/types';
import { loadTrainingHistory } from '../../src/lib/trainingHistory';
import { buildTrainingResultRows } from '../../src/lib/trainingResultsGrid';
import { buildTrainingDayWorkbook } from '../../src/lib/trainingSpreadsheetExport';

const race: TrainingSession = {
  id: 'real-race', title: 'Interval race', activityType: 'bmx-race',
  startedAt: 1000, endedAt: 2000, durationMs: 1000, distanceMeters: 200,
  source: 'live', createdAt: 1000, updatedAt: 2000,
  details: { summaries: [{ playerId: 1, riderName: 'Rider', finishTimeMs: 1000 }], reactionTimesByPlayer: { 1: 175 } },
};
const practice: TrainingSession = {
  ...race, id: 'old-practice', title: 'Reaction Test · GREAT',
  details: { ...race.details, reactionTest: { valid: true, reactionTimeMs: 180 } },
};

afterEach(() => vi.unstubAllGlobals());

describe('Reaction practice is separate from training history', () => {
  it('omits old practice from calendar counts and totals while retaining race data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [practice, race] }))));
    const history = await loadTrainingHistory();
    expect(history.sessions).toEqual([race]);
    expect(history.totals).toMatchObject({ sessions: 1, bmxRaces: 1, distanceMeters: 200, durationMs: 1000 });
  });

  it('excludes legacy practice from table and workbook even when supplied directly', () => {
    const rows = buildTrainingResultRows([practice, race]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: race.id, sessionOrdinal: 1, reactionTimeMs: 175 });
    const workbook = JSON.stringify(buildTrainingDayWorkbook([practice, race]));
    expect(workbook).toContain('Interval race');
    expect(workbook).not.toContain('Reaction Test');
    expect(workbook).not.toContain('old-practice');
  });
});
