import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../../src/types';
import type { ClubHeartRateTrainingSummary } from '../../src/lib/heartRateCloud';
import {
  consentedClubTrainingHeartRateTarget,
  projectConsentedClubTrainingHeartRateHistory,
} from '../../src/lib/clubTrainingHeartRate';

function ownerSession(): TrainingSession {
  return {
    id: 'club-owner:club-1:rider-1:result-1',
    activityType: 'get-pulled',
    title: 'Shared result',
    startedAt: 1_000,
    endedAt: 7_000,
    durationMs: 6_000,
    distanceMeters: 35,
    source: 'live',
    details: {},
    club: {
      id: 'club-1',
      name: 'Test Club',
      studioRiderId: 'rider-1',
      riderName: 'Rider One',
      role: 'owner',
    },
    createdAt: 1_000,
    updatedAt: 7_000,
  };
}

function segment(overrides: Partial<ClubHeartRateTrainingSummary> = {}): ClubHeartRateTrainingSummary {
  return {
    aggregateKey: 'training:result-1:rider-1:1:1000',
    trainingSessionId: 'result-1',
    activityType: 'get-pulled',
    studioRiderId: 'rider-1',
    playerId: 1,
    startedAt: 1_000,
    endedAt: 7_000,
    activeDurationMs: 6_000,
    summary: {
      sampleCount: 5,
      coverageMs: 5_000,
      coveragePercent: 83.3,
      firstSampleElapsedMs: 500,
      lastSampleElapsedMs: 5_500,
      minimumBpm: 111,
      averageBpm: 151,
      peakBpm: 188,
    },
    zoneSummaries: [],
    finalizedAt: 8_000,
    ...overrides,
  };
}

describe('consented club training heart-rate projection', () => {
  it('maps only an exact owner session/rider/activity to a least-data summary', () => {
    const target = consentedClubTrainingHeartRateTarget(ownerSession());
    expect(target).toMatchObject({
      displayedSessionId: 'club-owner:club-1:rider-1:result-1',
      canonicalSessionId: 'result-1',
      studioRiderId: 'rider-1',
    });
    const projected = projectConsentedClubTrainingHeartRateHistory(target!, [
      segment(),
      segment({ id: 'wrong-rider', studioRiderId: 'rider-2', summary: { ...segment().summary!, averageBpm: 200 } }),
      segment({ id: 'wrong-session', trainingSessionId: 'result-2' }),
    ]);

    expect(projected).toEqual([expect.objectContaining({
      access: 'club-consented-summary',
      playerId: 1,
      summary: expect.objectContaining({ averageBpm: 151, peakBpm: 188 }),
    })]);
    expect(JSON.stringify(projected)).not.toContain('aggregateKey');
  });

  it('fails closed for an athlete view and for mismatched consented items', () => {
    const session = ownerSession();
    expect(consentedClubTrainingHeartRateTarget({
      ...session,
      club: { ...session.club!, role: 'athlete' },
    })).toBeNull();
    const target = consentedClubTrainingHeartRateTarget(session)!;
    expect(projectConsentedClubTrainingHeartRateHistory(target, [
      segment({ studioRiderId: 'rider-2' }),
    ])).toEqual([expect.objectContaining({ state: 'not-recorded', summary: null })]);
  });
});
