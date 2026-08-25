import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingSession } from '../../src/types';
import type {
  HeartRateStream,
  HeartRateTrainingSegment,
  PrivateHeartRateSessionHistory,
} from '../../src/lib/heartRateCloud';
import {
  loadPrivateTrainingHeartRateHistory,
  loadPrivateTrainingHeartRateDay,
  privateTrainingHeartRateLoadConcurrency,
  privateTrainingHeartRateForPlayer,
  privateTrainingHeartRateTarget,
  privateTrainingHeartRateZone,
  projectPrivateTrainingHeartRateHistory,
  type PrivateTrainingHeartRateProjection,
} from '../../src/lib/privateTrainingHeartRate';

function session(
  id: string,
  role?: 'athlete' | 'owner',
): Pick<TrainingSession, 'id' | 'club' | 'activityType'> {
  return {
    id,
    activityType: 'bmx-race',
    ...(role ? {
      club: {
        id: 'club-1',
        name: 'Test Club',
        studioRiderId: 'studio-rider-private',
        riderName: 'Test Rider',
        role,
      },
    } : {}),
  };
}

const summary = {
  sampleCount: 4,
  coverageMs: 4_000,
  coveragePercent: 80,
  firstSampleElapsedMs: 0,
  lastSampleElapsedMs: 4_000,
  minimumBpm: 100,
  averageBpm: 140,
  peakBpm: 180,
} as const;

function stream(sessionId: string, playerId: number | null = 1): HeartRateStream {
  return {
    id: 'private-stream-id',
    pairingId: 'private-pairing-id',
    sessionId,
    activityType: 'bmx-race',
    relayScope: 'session',
    riderId: 'account:private-rider-id',
    playerId,
    startedAt: 1_000,
    endedAt: 6_000,
    activeDurationMs: 5_000,
    summary,
    zoneSummaries: [{
      zoneId: 'zone-source-1',
      zoneName: 'Zone 1',
      startElapsedMs: 0,
      endElapsedMs: 5_000,
      summary,
    }],
    finalizedAt: 7_000,
  };
}

function segment(sessionId: string, playerId: number | null = 1): HeartRateTrainingSegment {
  return {
    id: 'private-segment-id',
    streamId: 'private-block-stream-id',
    trainingSessionId: sessionId,
    activityType: 'bmx-race',
    relayScope: 'studio-block',
    studioRiderId: 'studio-rider-private',
    playerId,
    startedAt: 1_000,
    endedAt: 6_000,
    activeDurationMs: 5_000,
    summary,
    zoneSummaries: [{
      zoneId: 'zone-source-1',
      zoneName: 'Zone 1',
      startElapsedMs: 0,
      endElapsedMs: 5_000,
      summary,
    }],
    finalizedAt: 7_000,
  };
}

function projection(playerId: number | null): PrivateTrainingHeartRateProjection {
  return {
    access: 'athlete-private',
    displayedSessionId: 'display-session',
    canonicalSessionId: 'canonical-session',
    state: 'saved',
    playerId,
    summary,
    zoneSummaries: [{
      zoneId: 'zone-source-1',
      startElapsedMs: 0,
      endElapsedMs: 5_000,
      summary,
    }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('private training heart-rate projection', () => {
  it('resolves personal and athlete-projected identities while excluding club-owner history', () => {
    expect(privateTrainingHeartRateTarget(session('personal-session'))).toEqual({
      access: 'athlete-private',
      displayedSessionId: 'personal-session',
      canonicalSessionId: 'personal-session',
      activityType: 'bmx-race',
    });
    expect(privateTrainingHeartRateTarget(session('club:club-1:canonical-session', 'athlete'))).toEqual({
      access: 'athlete-private',
      displayedSessionId: 'club:club-1:canonical-session',
      canonicalSessionId: 'canonical-session',
      activityType: 'bmx-race',
    });
    expect(privateTrainingHeartRateTarget(session(
      'club-owner:club-1:studio-rider-private:canonical-session',
      'owner',
    ))).toBeNull();
  });

  it('returns only the least-data projection and drops cross-session private items', () => {
    const target = privateTrainingHeartRateTarget(session('canonical-session'))!;
    const history: PrivateHeartRateSessionHistory = {
      items: [
        stream('other-session'),
        { ...stream('canonical-session'), activityType: 'straight-sprint' },
        stream('canonical-session'),
      ],
      status: 'saved',
    };

    const projected = projectPrivateTrainingHeartRateHistory(target, history);

    expect(projected).toEqual([{
      access: 'athlete-private',
      displayedSessionId: 'canonical-session',
      canonicalSessionId: 'canonical-session',
      state: 'saved',
      playerId: 1,
      summary,
      zoneSummaries: [{
        zoneId: 'zone-source-1',
        zoneName: 'Zone 1',
        startElapsedMs: 0,
        endElapsedMs: 5_000,
        summary,
      }],
    }]);
    expect(projected[0]).not.toHaveProperty('id');
    expect(projected[0]).not.toHaveProperty('pairingId');
    expect(projected[0]).not.toHaveProperty('riderId');
    expect(projected[0]).not.toHaveProperty('studioRiderId');
    expect(projected[0]).not.toHaveProperty('streamId');
    expect(projected[0]).not.toHaveProperty('activityType');
  });

  it('fails closed when an exact-session result has the wrong activity type', () => {
    const target = privateTrainingHeartRateTarget(session('canonical-session'))!;
    const projected = projectPrivateTrainingHeartRateHistory(target, {
      items: [{ ...stream('canonical-session'), activityType: 'straight-sprint' }],
      status: 'saved',
    });

    expect(projected).toEqual([expect.objectContaining({
      state: 'not-recorded',
      summary: null,
      zoneSummaries: [],
    })]);
  });

  it('uses the exact training segment instead of double-counting its continuous relay', () => {
    const target = privateTrainingHeartRateTarget(session('canonical-session'))!;
    const continuous = {
      ...stream('canonical-session'),
      id: 'private-block-stream-id',
      relayScope: 'studio-block' as const,
      finalizedAt: null,
      summary: { ...summary, averageBpm: 199 },
    };

    const projected = projectPrivateTrainingHeartRateHistory(target, {
      items: [continuous, segment('canonical-session')],
      status: 'syncing',
    });

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      state: 'saved',
      playerId: 1,
      summary: { averageBpm: 140 },
    });
  });

  it('keeps syncing and no-record states explicit without inventing measurements', () => {
    const target = privateTrainingHeartRateTarget(session('canonical-session'))!;
    expect(projectPrivateTrainingHeartRateHistory(target, { items: [], status: 'syncing' })[0])
      .toMatchObject({ state: 'syncing', summary: null, zoneSummaries: [] });
    expect(projectPrivateTrainingHeartRateHistory(target, { items: [], status: 'saved' })[0])
      .toMatchObject({ state: 'not-recorded', summary: null, zoneSummaries: [] });
  });

  it('joins by exact player and source zone, with only a single-rider null-player fallback', () => {
    const playerOne = projection(1);
    const nullPlayer = projection(null);
    expect(privateTrainingHeartRateForPlayer([playerOne, projection(2)], 1, 2)).toEqual([playerOne]);
    expect(privateTrainingHeartRateForPlayer([nullPlayer], 1, 1)).toEqual([nullPlayer]);
    expect(privateTrainingHeartRateForPlayer([nullPlayer], 1, 2)).toEqual([]);
    expect(privateTrainingHeartRateForPlayer([nullPlayer, playerOne], 2, 1)).toEqual([]);
    expect(privateTrainingHeartRateZone(playerOne, 'zone-source-1', {
      startElapsedMs: 0,
      endElapsedMs: 5_000,
    })?.summary.averageBpm).toBe(140);
    expect(privateTrainingHeartRateZone(playerOne, 'zone-source-1', {
      startElapsedMs: 1,
      endElapsedMs: 5_000,
    })).toBeNull();
    expect(privateTrainingHeartRateZone(playerOne, 'Zone 1')).toBeNull();
  });

  it('passes cancellation through the owner-only exact-session request', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ streams: [], segments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const target = privateTrainingHeartRateTarget(session('canonical-session'))!;

    await expect(loadPrivateTrainingHeartRateHistory(target, {
      signal: new AbortController().signal,
    })).resolves.toEqual([expect.objectContaining({ state: 'not-recorded' })]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/streams?sessionId=canonical-session',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('caps one selected day at four concurrent private-history requests', async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return new Response(JSON.stringify({ streams: [], segments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const targets = Array.from({ length: 9 }, (_, index) => (
      privateTrainingHeartRateTarget(session(`session-${index + 1}`))!
    ));

    const result = await loadPrivateTrainingHeartRateDay(targets);

    expect(result).toHaveLength(9);
    expect(peak).toBe(privateTrainingHeartRateLoadConcurrency);
  });
});
