import { describe, expect, it } from 'vitest';
import type { TrainingSessionInput } from '../../src/lib/trainingHistory';
import {
  buildClubOwnerTrainingResults,
  type ClubOwnerActiveClockSegment,
} from '../../src/lib/clubOwnerTrainingResults';
import type { ClubOwnerTrainingAuthorization } from '../../src/lib/clubOwnerTrainingHistory';

function activeAuthorization(activityType: ClubOwnerTrainingAuthorization['activityType']) {
  const armedAt = 1_000;
  return {
    id: `group-${activityType}`,
    clubId: 'club-1',
    requestId: `request-${activityType}`,
    sessionId: `session-${activityType}`,
    activityType,
    armedAt,
    expiresAt: 901_000,
    state: 'active',
    completedAt: null,
    cancelledAt: null,
    createdAt: 900,
    updatedAt: 1_400,
    assignments: [1, 2, 3, 4].map((playerId) => ({
      id: `assignment-${playerId}`,
      studioRiderId: `studio-rider-${playerId}`,
      bikeDeviceId: String(100 + playerId),
      playerId,
      startedAt: 1_000 + playerId * 100,
      activatedAt: 1_010 + playerId * 100,
      endedAt: null,
      state: 'active',
    })),
  } as ClubOwnerTrainingAuthorization;
}

function raceSession(activityType: 'bmx-race' | 'straight-sprint'): TrainingSessionInput {
  const finishTimes = [4_100, 4_250, 4_450, 4_700];
  return {
    id: `session-${activityType}`,
    activityType,
    title: activityType === 'bmx-race' ? 'Four-rider BMX race' : 'Four-rider straight sprint',
    startedAt: 1_000,
    endedAt: 7_000,
    durationMs: 6_000,
    distanceMeters: 350,
    trackId: 'track-12-zones',
    trackName: 'Twelve Zone Track',
    details: {
      summaries: [1, 2, 3, 4].map((playerId, index) => ({
        playerId,
        riderId: `untrusted-rider-${5 - playerId}`,
        riderName: `Untrusted name ${5 - playerId}`,
        photoUrl: `https://example.invalid/${playerId}.jpg`,
        deviceLabel: `Other rider bike ${playerId}`,
        colorName: 'lime',
        accent: '#65a30d',
        rank: index + 1,
        finishTimeMs: finishTimes[index],
        thirtyFootTimeMs: 1_000 + index * 10,
        distanceMeters: 350 - index,
        sampleCount: 120 + index,
        topSpeedKph: 50 - index,
        averageSpeedKph: 40 - index,
        topCadence: 180 - index,
        averageCadence: 150 - index,
        topWatts: 1_400 - index * 20,
        averageWatts: 700 - index * 10,
      })),
      zoneResults: Array.from({ length: 12 }, (_, zoneIndex) => ({
        zoneId: `zone-${zoneIndex + 1}`,
        zoneName: `Zone ${zoneIndex + 1}`,
        zoneType: zoneIndex % 3 === 0 ? 'technical' : zoneIndex % 2 === 0 ? 'recovery' : 'pedal',
        startMeter: zoneIndex * 25,
        endMeter: zoneIndex * 25 + 24,
        riders: [1, 2, 3, 4].map((playerId) => ({
          playerId,
          riderName: `Must not leak ${playerId}`,
          sampleCount: 10,
          entryElapsedMs: zoneIndex * 300,
          exitElapsedMs: zoneIndex * 300 + 250,
          durationMs: 250,
          topSpeedKph: 45,
          averageSpeedKph: 40,
          topCadence: 170,
          averageCadence: 150,
          topWatts: 1_200,
          averageWatts: 650,
        })),
      })),
      reactionTimesByPlayer: { 1: 210, 2: 220, 3: 230, 4: 240, 99: 1 },
      selectedMetrics: ['cadence', 'speed', 'power', 'reaction'],
      lapCount: 1,
      events: [{ at: 1_000, elapsedMs: 0, type: 'race-start', label: 'Unscoped private event' }],
    },
  };
}

describe('club owner group result builders', () => {
  it.each(['bmx-race', 'straight-sprint'] as const)(
    'splits a four-bike %s into one identity-safe result per rider and preserves 12 ordered zones',
    (activityType) => {
      const authorization = activeAuthorization(activityType);
      const built = buildClubOwnerTrainingResults(authorization, raceSession(activityType));

      expect(built.athletePayloads).toHaveLength(4);
      expect(built.riderWindows).toEqual([4_100, 4_250, 4_450, 4_700].map((finishTimeMs, index) => ({
        assignmentId: `assignment-${index + 1}`,
        status: 'finished',
        endedAt: 1_100 + index * 100 + finishTimeMs,
      })));
      expect((built.session.details as { events?: unknown }).events).toBeUndefined();
      expect((built.session.details as { zoneResults: unknown[] }).zoneResults).toHaveLength(12);

      built.athletePayloads.forEach((payload, index) => {
        const details = payload.session.details as {
          summaries: Array<Record<string, unknown>>;
          zoneResults: Array<{ zoneId: string; riders: Array<Record<string, unknown>> }>;
          reactionTimesByPlayer: Record<string, number>;
          events?: unknown;
        };
        expect(details.summaries).toHaveLength(1);
        expect(details.summaries[0].playerId).toBe(index + 1);
        expect(details.zoneResults.map((zone) => zone.zoneId)).toEqual(
          Array.from({ length: 12 }, (_, zoneIndex) => `zone-${zoneIndex + 1}`),
        );
        expect(details.zoneResults.every((zone) => (
          zone.riders.length === 1 && zone.riders[0].playerId === index + 1
        ))).toBe(true);
        expect(details.reactionTimesByPlayer).toEqual({ [String(index + 1)]: 210 + index * 10 });
        expect(details.events).toBeUndefined();
        expect(JSON.stringify(payload.session)).not.toMatch(/riderName|riderId|photoUrl|deviceLabel|Untrusted|Must not leak/u);
      });
    },
  );

  it('emits a canonical partial DNF row when four race riders start and only three finish', () => {
    const authorization = activeAuthorization('bmx-race');
    const session = raceSession('bmx-race');
    const details = session.details as {
      summaries: Array<Record<string, unknown>>;
      zoneResults: Array<{ riders: Array<Record<string, unknown>> }>;
    };
    details.summaries[3] = {
      ...details.summaries[3],
      finishTimeMs: null,
      distanceMeters: 82,
      sampleCount: 42,
    };
    details.zoneResults.forEach((zone, zoneIndex) => {
      if (zoneIndex === 2) {
        zone.riders[3] = {
          ...zone.riders[3],
          exitElapsedMs: null,
          durationMs: null,
        };
      }
      if (zoneIndex >= 3) {
        zone.riders[3] = {
          ...zone.riders[3],
          entryElapsedMs: null,
          exitElapsedMs: null,
          durationMs: null,
          sampleCount: 0,
        };
      }
    });

    const built = buildClubOwnerTrainingResults(authorization, session, {
      dnfByAssignmentId: { 'assignment-4': { endedAt: 2_600 } },
    });
    const dnf = built.athletePayloads[3];
    const dnfDetails = dnf.session.details as {
      summaries: Array<Record<string, unknown>>;
      zoneResults: Array<{ riders: Array<Record<string, unknown>> }>;
    };

    expect(built.riderWindows.map((window) => window.status)).toEqual([
      'finished', 'finished', 'finished', 'dnf',
    ]);
    expect(dnf.riderWindow).toEqual({ assignmentId: 'assignment-4', status: 'dnf', endedAt: 2_600 });
    expect(dnf.session).toMatchObject({ startedAt: 1_400, endedAt: 2_600, durationMs: 1_200, distanceMeters: 82 });
    expect(dnfDetails.summaries).toEqual([
      expect.objectContaining({ playerId: 4, finishTimeMs: null, resultStatus: 'dnf', sampleCount: 42 }),
    ]);
    expect(dnfDetails.zoneResults).toHaveLength(3);
    expect(dnfDetails.zoneResults.every((zone) => (
      zone.riders.length === 1 && zone.riders[0].playerId === 4
    ))).toBe(true);
    expect(dnfDetails.zoneResults[2].riders[0]).toMatchObject({
      entryElapsedMs: 600,
      exitElapsedMs: 1_200,
      durationMs: 600,
    });
    expect((built.athletePayloads[2].session.details as { zoneResults: unknown[] }).zoneResults).toHaveLength(12);
  });

  it('uses each Get Pulled rider clock and preserves a bounded partial DNF', () => {
    const authorization = activeAuthorization('get-pulled');
    const session: TrainingSessionInput = {
      id: 'session-get-pulled',
      activityType: 'get-pulled',
      title: 'Five second Get Pulled',
      startedAt: 1_000,
      endedAt: 7_000,
      durationMs: 5_000,
      distanceMeters: 80,
      details: {
        durationSeconds: 5,
        airSetting: 4,
        riders: [1, 2, 3, 4].map((playerId) => ({
          playerId,
          riderId: `wrong-${playerId}`,
          name: `Wrong ${playerId}`,
          distanceMeters: 80 - playerId,
          averageWatts: 700,
          peakWatts: 1_300,
          averageCadence: 150,
          peakCadence: 190,
          averageSpeedKph: 40,
          peakSpeedKph: 52,
        })),
      },
    };
    const built = buildClubOwnerTrainingResults(authorization, session, {
      dnfByAssignmentId: { 'assignment-4': { endedAt: 3_400 } },
    });

    expect(built.riderWindows.map((window) => window.endedAt)).toEqual([6_100, 6_200, 6_300, 3_400]);
    expect(built.riderWindows.map((window) => window.status)).toEqual([
      'finished', 'finished', 'finished', 'dnf',
    ]);
    expect(built.athletePayloads.map((payload) => payload.session.durationMs)).toEqual([5_000, 5_000, 5_000, 2_000]);
    built.athletePayloads.forEach((payload, index) => {
      const riders = (payload.session.details as { riders: Array<Record<string, unknown>> }).riders;
      expect(riders).toEqual([expect.objectContaining({ playerId: index + 1, distanceMeters: 79 - index })]);
      expect(JSON.stringify(riders)).not.toMatch(/riderId|name|Wrong/u);
    });
  });

  it('requires one continuous, ordered Explore active clock per rider and scopes the rider row', () => {
    const authorization = activeAuthorization('explore');
    const session: TrainingSessionInput = {
      id: 'session-explore',
      activityType: 'explore',
      title: 'Club route',
      startedAt: 1_000,
      endedAt: 20_000,
      durationMs: 15_000,
      distanceMeters: 2_000,
      details: {
        originLabel: 'Studio',
        destinationLabel: 'Park',
        travelMode: 'bicycle',
        elevationGainMeters: 12,
        elevationLossMeters: 8,
        activeClockSegments: [{ startedAt: 1, endedAt: 2, activeElapsedAtStartMs: 0 }],
        riders: [1, 2, 3, 4].map((playerId) => ({
          playerId,
          riderId: `untrusted-${playerId}`,
          name: `Private ${playerId}`,
          photoUrl: 'data:image/png;base64,private',
          distanceMeters: 2_000 - playerId,
          averageSpeedMph: 14 - playerId / 10,
        })),
      },
    };
    const segments = Object.fromEntries(authorization.assignments.map((assignment) => [assignment.id, [
      {
        startedAt: assignment.startedAt!,
        endedAt: assignment.startedAt! + 4_000,
        activeElapsedAtStartMs: 0,
      },
      {
        startedAt: assignment.startedAt! + 5_000,
        endedAt: assignment.startedAt! + 9_000,
        activeElapsedAtStartMs: 4_000,
      },
    ] satisfies ClubOwnerActiveClockSegment[]]));
    const built = buildClubOwnerTrainingResults(authorization, session, {
      exploreActiveClockSegmentsByAssignmentId: segments,
      dnfByAssignmentId: { 'assignment-4': { endedAt: segments['assignment-4'][1].endedAt } },
    });

    expect((built.session.details as { activeClockSegments?: unknown }).activeClockSegments).toBeUndefined();
    expect(built.riderWindows).toHaveLength(4);
    built.athletePayloads.forEach((payload, index) => {
      expect(payload.riderWindow.activeClockSegments).toEqual(segments[`assignment-${index + 1}`]);
      expect(payload.riderWindow.status).toBe(index === 3 ? 'dnf' : 'finished');
      expect(payload.session.durationMs).toBe(8_000);
      expect((payload.session.details as { riders: unknown[] }).riders).toHaveLength(1);
      expect(JSON.stringify(payload.session)).not.toMatch(/riderId|photoUrl|Private/u);
    });

    const overlapping = structuredClone(segments);
    overlapping['assignment-2'][1].startedAt = overlapping['assignment-2'][0].endedAt - 1;
    expect(() => buildClubOwnerTrainingResults(authorization, session, {
      exploreActiveClockSegmentsByAssignmentId: overlapping,
    })).toThrow('segments overlap or are out of order');
  });

  it('rejects private heart-rate, profile-routing, and credential fields before any split', () => {
    const authorization = activeAuthorization('bmx-race');
    const withHeartRate = raceSession('bmx-race');
    (withHeartRate.details as Record<string, unknown>).heartRateSummary = { averageBpm: 172 };
    expect(() => buildClubOwnerTrainingResults(authorization, withHeartRate)).toThrow(
      'cannot include private field "heartRateSummary"',
    );

    const withProfileKey = raceSession('bmx-race');
    (withProfileKey.details as Record<string, unknown>).cloudProfileKey = 'secret-profile';
    expect(() => buildClubOwnerTrainingResults(authorization, withProfileKey)).toThrow(
      'cannot include private field "cloudProfileKey"',
    );

    const withToken = raceSession('bmx-race');
    (withToken.details as Record<string, unknown>).completionToken = 'secret-token';
    expect(() => buildClubOwnerTrainingResults(authorization, withToken)).toThrow(
      'cannot include private field "completionToken"',
    );
  });
});
