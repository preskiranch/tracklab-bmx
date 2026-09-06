import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Server persistence module under test.
import * as persistence from '../../cloud/persistence.mjs';

const server = readFileSync(new URL('../../cloud/server.mjs', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
function between(source: string, start: string, end: string) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last <= first) throw new Error(`History function boundary missing: ${start}`);
  return source.slice(first, last);
}
function familyHistory() {
  // Execute the production loading/projection functions with real persistence.
  // Unrelated presentation sanitizers are identities; permission/cap logic is
  // the exact server source, not a reimplementation of the reported defect.
  const context = vm.createContext({ persistence,
    sanitizeText: (value: unknown, fallback = '', limit = 240) => typeof value === 'string' ? value.trim().slice(0, limit) : fallback,
    normalizedRiderClaimName: (value: unknown) => String(value ?? '').trim().toLowerCase(),
    publicTrainingSession: (value: unknown) => value,
    stripPrivateHeartRateFields: (value: unknown) => value,
    projectedBikeResult: (value: unknown) => value,
    projectedNumber: (value: unknown, maximum: number) => value != null && Number.isFinite(Number(value))
      && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : null,
    finiteNumber: (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    isReactionTestSession: () => false,
  });
  vm.runInContext([
    between(server, 'function projectClubTrainingSession(', '\nfunction projectOwnedClubTrainingSession('),
    between(server, 'async function loadTrainingSessionsForAccount(', '\nasync function familyProfilePayload('),
    between(server, 'async function familyTrainingHistory(', '\nasync function handleFamilyRequest('),
    between(server, 'function clubTabletHistoricalProfileKeys(', '\nasync function clubTabletMemberAndProfile('),
    'this.compute = familyTrainingHistory;',
  ].join('\n'), context);
  return context.compute;
}

describe('family history range completeness', () => {
  it('reports an incomplete empty projection when 1000 newer club records hide an older child record', async () => {
    const ownerId = randomUUID(); const parentId = randomUUID();
    for (const id of [ownerId, parentId]) await persistence.createAuthUser({ id, email: `${id}@tracklab.test`,
      displayName: 'History cap fixture', passwordHash: 'scrypt:test:test', membershipTier: 'spectator', bikeSeats: 1 });
    const child = await persistence.createFamilyChild(parentId, 'Selected child');
    const ownerProfileKey = `user:${ownerId}`;
    const club = await persistence.ensureClub(ownerProfileKey, 'Busy club', randomUUID());
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    await persistence.saveClubInvite({ club, studioRiderId: 'selected-child', riderName: 'Selected child',
      inviteId: randomUUID(), tokenHash, expiresAt: Date.now() + 60000 });
    expect(await persistence.claimFamilyClubInvitation(parentId, child.id, tokenHash)).not.toBeNull();
    for (let index = 0; index < 1001; index += 1) {
      expect(await persistence.saveTrainingSession(ownerProfileKey, { id: `cap-record-${index}`, activityType: 'explore',
        title: 'Explore ride', startedAt: index + 1, endedAt: index + 11, durationMs: 10, distanceMeters: 100,
        source: 'live', createdAt: index + 1, details: { riders: [{ riderId: index === 0 ? 'selected-child' : 'different-child',
          riderName: index === 0 ? 'Selected child' : 'Other child', distanceMeters: 100 }] } })).not.toBeNull();
    }
    const compute = familyHistory();
    let complete = true;
    const wide = await compute(child, { from: 0, to: 2000, limit: 1000, onRangeIncomplete: () => { complete = false; } });
    expect(wide).toHaveLength(0);
    expect(complete).toBe(false);
    complete = true;
    const narrow = await compute(child, { from: 0, to: 1, limit: 1000, onRangeIncomplete: () => { complete = false; } });
    expect(narrow.map((session: { id: string }) => session.id)).toEqual([`club:${club.id}:cap-record-0`]);
    expect(complete).toBe(true);
  });

  it.each(['sessions', 'legacy races'])('preserves the raw PostgreSQL %s cap before normalization or grouping removes rows', async (source) => {
    let complete = true;
    const context = vm.createContext({ pool: {}, schema: 'tracklab',
      query: async (sql: string) => ({ rows: sql.includes('FROM tracklab.training_sessions')
        ? source === 'sessions' ? [{}, {}] : []
        : source === 'legacy races' ? Array.from({ length: 8 }, () => ({ created_at: new Date(1) })) : [] }),
      acceptedRecordedBikeMetricsSql: () => 'TRUE', acceptedWholeRaceResultGroupSql: () => 'TRUE',
      trainingSessionFromRow: () => null, legacyRaceSessions: () => [], fromJson: () => ({}),
      isReactionTestSession: () => false,
    });
    vm.runInContext(between(storage, 'function noteTrainingRangeLimit(', '\nexport async function loadClubTrainingSessions(')
      .replace('export async function loadTrainingSessions', 'async function loadTrainingSessions')
      + '\nthis.compute=loadTrainingSessions;', context);
    const sessions = await context.compute('user:fixture', { from: 0, to: 100, limit: 2,
      onRangeIncomplete: () => { complete = false; } });
    expect(sessions).toHaveLength(0);
    expect(complete).toBe(false);
  });
});
