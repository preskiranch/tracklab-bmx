import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHeartRateAccountBlock,
  loadClubHeartRateSummaryHistory,
  loadHeartRateAccountBlocks,
  loadHeartRatePairings,
  loadHeartRateStudioBlocks,
  loadPrivateHeartRateSessionHistory,
  normalizeHeartRateLiveEvent,
  recoverHeartRateAccountBlockHandoff,
  stopHeartRateAccountBlock,
  stopHeartRateStudioBlock,
} from '../../src/lib/heartRateCloud';

afterEach(() => vi.unstubAllGlobals());

function rawStream(sessionId: string, id = `stream-${sessionId}`) {
  return {
    id,
    pairingId: `pair-${sessionId}`,
    sessionId,
    activityType: 'bmx-race',
    riderId: 'account:rider-1',
    playerId: 1,
    startedAt: 1_000,
    endedAt: 11_000,
    activeDurationMs: 10_000,
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
      zoneId: 'zone-1',
      zoneName: 'Zone 1',
      startElapsedMs: 0,
      endElapsedMs: 5_000,
      sampleCount: 4,
      coverageMs: 4_000,
      coveragePercent: 80,
      firstSampleElapsedMs: 0,
      lastSampleElapsedMs: 4_500,
      minimumBpm: 101,
      averageBpm: 130,
      peakBpm: 155,
    }],
    finalizedAt: 12_000,
  };
}

function rawStudioSegment(trainingSessionId: string) {
  return {
    id: `segment-${trainingSessionId}`,
    streamId: 'continuous-studio-stream-1',
    trainingSessionId,
    activityType: 'monitor-sprint',
    relayScope: 'studio-block',
    studioRiderId: 'studio-rider-1',
    playerId: 2,
    startedAt: 20_000,
    endedAt: 26_000,
    activeDurationMs: 6_000,
    summary: {
      sampleCount: 6,
      coverageMs: 5_000,
      coveragePercent: 83.3,
      firstSampleElapsedMs: 0,
      lastSampleElapsedMs: 5_000,
      minimumBpm: 141,
      averageBpm: 154,
      peakBpm: 169,
    },
    zoneSummaries: [],
    accountProfileKey: 'must-not-cross-client-boundary',
    riderId: 'account:must-not-cross-client-boundary',
    samples: [{ bpm: 154 }],
  };
}

describe('private heart-rate history cloud client', () => {
  it('hydrates a claimed pairing through its effective ingest expiry, not its expired pair code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pairings: [{
        id: 'pairing-1',
        sessionId: 'session-1',
        activityType: 'explore',
        relayScope: 'session',
        riderId: 'account:rider-1',
        playerId: 1,
        pairCodeExpiresAt: 10_000,
        expiresAt: 70_000,
        ingestExpiresAt: 70_000,
        claimedAt: 5_000,
        revokedAt: null,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const pairings = await loadHeartRatePairings();

    expect(pairings).toEqual([expect.objectContaining({
      id: 'pairing-1',
      sessionId: 'session-1',
      expiresAt: 70_000,
      claimedAt: 5_000,
    })]);
  });

  it('normalizes flattened pedal-zone summaries into the private nested shape', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      streams: [
        rawStream('another-session'),
        rawStream('session-1'),
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const streams = await loadPrivateHeartRateSessionHistory(' session-1 ');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/streams?sessionId=session-1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(streams).toHaveLength(1);
    expect(streams[0].sessionId).toBe('session-1');
    expect(streams[0].zoneSummaries).toEqual([{
      zoneId: 'zone-1',
      zoneName: 'Zone 1',
      startElapsedMs: 0,
      endElapsedMs: 5_000,
      summary: {
        sampleCount: 4,
        coverageMs: 4_000,
        coveragePercent: 80,
        firstSampleElapsedMs: 0,
        lastSampleElapsedMs: 4_500,
        minimumBpm: 101,
        averageBpm: 130,
        peakBpm: 155,
      },
    }]);
  });

  it('rejects an invalid session identity before making a health-data request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadPrivateHeartRateSessionHistory(' ')).rejects.toThrow(/valid training session/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the exact Monitor sprint slice from a continuous studio block without exposing raw samples', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      streams: [rawStream('continuous-block')],
      segments: [rawStudioSegment('another-session'), rawStudioSegment('monitor-session-1')],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const history = await loadPrivateHeartRateSessionHistory('monitor-session-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: 'segment-monitor-session-1',
      streamId: 'continuous-studio-stream-1',
      trainingSessionId: 'monitor-session-1',
      relayScope: 'studio-block',
      summary: { averageBpm: 154, peakBpm: 169 },
    });
    expect(history[0]).not.toHaveProperty('accountProfileKey');
    expect(history[0]).not.toHaveProperty('riderId');
    expect(history[0]).not.toHaveProperty('samples');
  });

  it('normalizes a consented club event by studio rider without weakening personal events', () => {
    expect(normalizeHeartRateLiveEvent({
      streamId: 'stream-1',
      sessionId: 'session-1',
      studioRiderId: 'studio-rider-1',
      playerId: 2,
      bpm: 155,
      recordedAt: 20_000,
    })).toEqual({
      streamId: 'stream-1',
      sessionId: 'session-1',
      riderId: 'studio-rider-1',
      studioRiderId: 'studio-rider-1',
      playerId: 2,
      bpm: 155,
      recordedAt: 20_000,
      activeElapsedMs: null,
    });
    expect(normalizeHeartRateLiveEvent({
      streamId: 'stream-1', sessionId: 'session-1', riderId: 'account:rider-1',
      bpm: 155, recordedAt: 20_000,
    })).toBeNull();
  });

  it('returns a separately redacted consented club summary without account or raw-sample fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      streams: [{
        ...rawStream('session-1'),
        studioRiderId: 'studio-rider-1',
        pairingId: 'must-not-cross-client-boundary',
        riderId: 'account:must-not-cross-client-boundary',
        samples: [{ bpm: 155 }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const streams = await loadClubHeartRateSummaryHistory(' club-1 ', ' session-1 ');

    expect(fetch).toHaveBeenCalledWith(
      '/api/heart-rate/club-streams?clubId=club-1&sessionId=session-1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      id: 'stream-session-1',
      sessionId: 'session-1',
      studioRiderId: 'studio-rider-1',
      summary: { averageBpm: 142.5, peakBpm: 181 },
    });
    expect(streams[0]).not.toHaveProperty('pairingId');
    expect(streams[0]).not.toHaveProperty('riderId');
    expect(streams[0]).not.toHaveProperty('samples');
  });

  it('returns only the consented summary slice for a club Monitor sprint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      streams: [],
      segments: [rawStudioSegment('session-1')],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const history = await loadClubHeartRateSummaryHistory('club-1', 'session-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: 'segment-session-1',
      trainingSessionId: 'session-1',
      studioRiderId: 'studio-rider-1',
      summary: { averageBpm: 154 },
    });
    expect(history[0]).not.toHaveProperty('accountProfileKey');
    expect(history[0]).not.toHaveProperty('riderId');
    expect(history[0]).not.toHaveProperty('samples');
  });

  it('loads and stops only the owner-safe studio block readiness projection', async () => {
    const rawBlock = {
      invitationId: 'invite-1',
      clubId: 'club-1',
      studioRiderId: 'studio-rider-1',
      anchorSessionId: 'monitor-anchor-1',
      activityType: 'monitor-sprint',
      relayScope: 'studio-block',
      playerId: 2,
      state: 'watch-ready',
      invitationExpiresAt: 10_000,
      pairCodeExpiresAt: 20_000,
      blockExpiresAt: 30_000,
      streamStartedAt: 4_000,
      lastSampleAt: 5_000,
      lastSampleReceivedAt: 5_100,
      freshUntil: 20_100,
      pairingId: 'must-not-cross-client-boundary',
      athleteProfileKey: 'must-not-cross-client-boundary',
      ingestToken: 'must-not-cross-client-boundary',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ blocks: [rawBlock] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        block: { ...rawBlock, state: 'stopped' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const blocks = await loadHeartRateStudioBlocks(' club-1 ');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/heart-rate/studio-blocks?clubId=club-1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(blocks).toEqual([expect.objectContaining({
      invitationId: 'invite-1',
      state: 'watch-ready',
      freshUntil: 20_100,
    })]);
    expect(blocks[0]).not.toHaveProperty('pairingId');
    expect(blocks[0]).not.toHaveProperty('athleteProfileKey');
    expect(blocks[0]).not.toHaveProperty('ingestToken');

    const stopped = await stopHeartRateStudioBlock('invite-1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/heart-rate/studio-blocks/invite-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(stopped.state).toBe('stopped');
  });

  it('creates, hydrates, and drain-stops only the owner-safe account block projection', async () => {
    const rawBlock = {
      pairingId: 'pair-account-1',
      blockId: 'account-block:one',
      relayScope: 'account-block',
      state: 'waiting-watch',
      pairCodeExpiresAt: 20_000,
      ingestExpiresAt: null,
      effectiveExpiresAt: 20_000,
      claimedAt: null,
      revokedAt: null,
      stopRequestedAt: null,
      drainExpiresAt: null,
      streamStartedAt: null,
      streamEndedAt: null,
      lastSampleAt: null,
      lastSampleReceivedAt: null,
      freshUntil: null,
      createdAt: 10_000,
      updatedAt: 10_000,
      ingestToken: 'must-not-cross-client-boundary',
      ownerProfileKey: 'must-not-cross-client-boundary',
    };
    const rawPairing = {
      id: 'pair-account-1',
      sessionId: 'account-block:one',
      activityType: 'training-block',
      relayScope: 'account-block',
      riderId: 'account:rider-1',
      playerId: null,
      clubId: null,
      studioRiderId: null,
      pairCodeExpiresAt: 20_000,
      expiresAt: 20_000,
      claimedAt: null,
      revokedAt: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    };
    const drainingBlock = {
      ...rawBlock,
      state: 'stale',
      stopRequestedAt: 12_000,
      drainExpiresAt: 18_000,
      effectiveExpiresAt: 18_000,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        block: rawBlock,
        pairing: rawPairing,
        pairCode: '2345-6789',
        replayed: false,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ blocks: [rawBlock] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        block: { ...rawBlock, pairCodeExpiresAt: 25_000, effectiveExpiresAt: 25_000 },
        pairCode: 'ABCD-6789',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        block: drainingBlock,
        draining: true,
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const requestId = 'account-block-request-1234567890';
    const created = await createHeartRateAccountBlock(requestId);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/heart-rate/account-blocks',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestId }) }),
    );
    expect(created).toMatchObject({
      block: { pairingId: 'pair-account-1', state: 'waiting-watch' },
      pairing: { activityType: 'training-block', relayScope: 'account-block' },
      pairCode: '2345-6789',
      replayed: false,
    });
    expect(created.block).not.toHaveProperty('ingestToken');
    expect(created.block).not.toHaveProperty('ownerProfileKey');

    const blocks = await loadHeartRateAccountBlocks();
    expect(blocks).toEqual([expect.objectContaining({ pairingId: 'pair-account-1' })]);
    expect(blocks[0]).not.toHaveProperty('ingestToken');
    expect(blocks[0]).not.toHaveProperty('ownerProfileKey');

    const recovered = await recoverHeartRateAccountBlockHandoff('pair-account-1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/heart-rate/account-blocks/pair-account-1/handoff',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(recovered).toMatchObject({
      block: { pairingId: 'pair-account-1', state: 'waiting-watch' },
      pairCode: 'ABCD-6789',
    });

    const stopped = await stopHeartRateAccountBlock('pair-account-1');
    expect(stopped).toMatchObject({
      draining: true,
      block: { state: 'stale', stopRequestedAt: 12_000, drainExpiresAt: 18_000 },
    });
  });

  it('rejects account scope in studio invitation projections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      blocks: [{
        invitationId: 'invite-1',
        clubId: 'club-1',
        studioRiderId: 'rider-1',
        anchorSessionId: 'session-1',
        activityType: 'monitor-sprint',
        relayScope: 'account-block',
        playerId: 1,
        state: 'watch-ready',
        invitationExpiresAt: 20_000,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(loadHeartRateStudioBlocks('club-1')).resolves.toEqual([]);
  });
});
