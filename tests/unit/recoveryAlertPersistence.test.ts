import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  acknowledgeRecoveryAlert,
  applyRecoveryHeartRateSamples,
  createHeartRateStream,
  createHeartRateWatchConnection,
  createRecoveryAlertEpisode,
  createOrRefreshHeartRateWatchEnrollment,
  deleteRecoveryAlertData,
  loadActiveRecoveryAlertEpisode,
  loadRecoveryAlertEpisode,
  loadRecoveryAlertPreference,
  loadRecoveryLearningSummaries,
  insertHeartRateSamples,
  saveRecoveryAlertPreference,
  updateRecoveryAlertEpisode,
} from '../../cloud/persistence.mjs';

function candidate(id: string, requestId: string, startedAt: number, repetitionId: string) {
  return {
    id,
    requestId,
    requestFingerprint: `${id}-fingerprint`,
    activityType: 'bmx-race',
    sessionId: `${id}-session`,
    repetitionId,
    mode: 'heart-rate',
    timerSeconds: 120,
    targetBpm: 120,
    minimumSeconds: 15,
    maximumSeconds: 60,
    startedAt,
    notBeforeAt: startedAt + 15_000,
    plannedReadyAt: null,
    fallbackAt: startedAt + 60_000,
    explanation: 'Waiting for recovery target.',
    confidence: 'fixed',
    learningEpisodeCount: 0,
    effortSummary: { finishTimeMs: 20_000, peakPowerWatts: 1_400 },
  };
}

async function createPrivateWatchStream(owner: string, base: number, suffix: string) {
  const enrollmentId = `recovery-enrollment-${suffix}`;
  const tokenHash = `recovery-token-${suffix}`;
  const installIdHash = `recovery-install-${suffix}`;
  expect(await createOrRefreshHeartRateWatchEnrollment({
    id: enrollmentId,
    ownerProfileKey: owner,
    requestId: `recovery-enrollment-request-${suffix}`,
    installIdHash,
    scope: 'personal',
    clubId: null,
    studioRiderId: null,
    liveStudioConsent: false,
    sessionStudioConsent: false,
    now: base,
  })).toMatchObject({ status: 'created' });
  const connection = await createHeartRateWatchConnection({
    id: `recovery-connection-${suffix}`,
    enrollmentId,
    ownerProfileKey: owner,
    requestId: `recovery-connect-request-${suffix}`,
    installIdHash,
    pairingId: `recovery-pairing-${suffix}`,
    relaySessionId: `watch-connect:recovery-${suffix}`,
    riderId: `private-rider-${suffix}`,
    pairCodeHash: `recovery-code-${suffix}`,
    ingestTokenHash: tokenHash,
    connectedUntil: base + 4 * 60 * 60 * 1_000,
    now: base,
  });
  expect(connection).toMatchObject({ status: 'created' });
  const streamId = `recovery-stream-${suffix}`;
  expect(await createHeartRateStream(
    connection.pairing!.id,
    tokenHash,
    streamId,
    base - 60_000,
    base,
  )).toMatchObject({ id: streamId });
  return { streamId, tokenHash };
}

describe('Recovery Alert memory persistence parity', () => {
  it('keeps PostgreSQL recovery reloads bound to immutable receipt-time validity', () => {
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const recentWindow = source.slice(
      source.indexOf('const recentHeartRateSamplesSql'),
      source.indexOf('/**\n * Returns one freshness-bounded owner reading'),
    );
    expect(recentWindow).toContain("recorded_at >= received_at - interval '10 seconds'");
    expect(recentWindow).toContain("recorded_at <= received_at + interval '2 seconds'");
    expect(recentWindow).toContain('SELECT DISTINCT ON (recorded_at)');
    expect(recentWindow).toContain('recorded_at = to_timestamp($3 / 1000.0)');
    expect(recentWindow).toContain('NOT (sequence = ANY($5::bigint[]))');
    expect(recentWindow).toContain('_receivedAt: new Date(row.received_at).getTime()');
    expect(source).toContain('candidate.startedAt < latest.startedAt');
    expect(source).toContain('ORDER BY started_at DESC, created_at DESC, id DESC');
  });

  it('records a delayed older first delivery without replacing the newer repetition', async () => {
    const suffix = `arrival-order-${Date.now()}`;
    const owner = `user:recovery-${suffix}`;
    const newerStartedAt = 8_000_000;
    const olderStartedAt = newerStartedAt - 1_000;
    const newer = candidate(
      `recovery_newer_${suffix}`,
      `${'n'.repeat(32)}`,
      newerStartedAt,
      `rep-2-${suffix}`,
    );
    const older = candidate(
      `recovery_older_${suffix}`,
      `${'o'.repeat(32)}`,
      olderStartedAt,
      `rep-1-${suffix}`,
    );
    expect(await createRecoveryAlertEpisode(owner, newer, newerStartedAt)).toMatchObject({
      replayed: false,
      episode: { id: newer.id, cancelledAt: null },
    });
    const delayed = await createRecoveryAlertEpisode(owner, older, newerStartedAt + 100);
    expect(delayed).toMatchObject({
      replayed: false,
      conflict: false,
      episode: { id: older.id, cancelledAt: newerStartedAt + 100 },
    });
    expect(await loadActiveRecoveryAlertEpisode(owner, newerStartedAt + 100)).toMatchObject({
      id: newer.id,
      repetitionId: newer.repetitionId,
      cancelledAt: null,
    });
    expect(await createRecoveryAlertEpisode(owner, older, newerStartedAt + 200)).toMatchObject({
      replayed: true,
      conflict: false,
      episode: { id: older.id, cancelledAt: newerStartedAt + 100 },
    });
    expect(await loadActiveRecoveryAlertEpisode(owner, newerStartedAt + 200)).toMatchObject({
      id: newer.id,
    });
  });

  it('evaluates every newly inserted point in a 13-sample batch in Watch order', async () => {
    const suffix = `batch-${Date.now()}`;
    const owner = `user:recovery-${suffix}`;
    const startedAt = 6_000_000;
    const firstSampleAt = startedAt + 16_000;
    const batchReceivedAt = firstSampleAt + 10_000;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    const episode = candidate(
      `recovery_${suffix}`,
      `${'b'.repeat(32)}`,
      startedAt,
      `batch-rep-${suffix}`,
    );
    await createRecoveryAlertEpisode(owner, episode, startedAt);
    const batch = Array.from({ length: 13 }, (_, index) => ({
      sequence: index,
      recordedAt: firstSampleAt + index * 1_000,
      activeElapsedMs: 16_000 + index * 1_000,
      bpm: 110,
    }));
    expect(await insertHeartRateSamples(streamId, tokenHash, batch, batchReceivedAt))
      .toEqual(batch.map((sample) => sample.sequence));
    await applyRecoveryHeartRateSamples(owner, streamId, batch, batchReceivedAt);

    // Watch starts the 12-second hold when its second point confirms a median.
    // Processing only the stored tail-five would incorrectly start at sample 9.
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 13,
      belowTargetStartedAt: firstSampleAt + 1_000,
      lastHeartRateRecordedAt: firstSampleAt + 12_000,
      readyAt: null,
    });

    const completingSample = {
      sequence: 13,
      recordedAt: firstSampleAt + 13_000,
      activeElapsedMs: 29_000,
      bpm: 110,
    };
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      [completingSample],
      completingSample.recordedAt,
    )).toEqual([13]);
    await applyRecoveryHeartRateSamples(
      owner,
      streamId,
      [completingSample],
      completingSample.recordedAt,
    );
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 14,
      readyAt: firstSampleAt + 13_000,
      readyReason: 'heart-rate-target',
      recoverySummary: { sampleCount: 14, sustainedTargetSeconds: 12 },
    });
  });

  it('ignores a cross-batch equal-clock duplicate without replacing the prior median point', async () => {
    const suffix = `equal-clock-${Date.now()}`;
    const owner = `user:recovery-${suffix}`;
    const startedAt = 6_500_000;
    const firstSampleAt = startedAt + 16_000;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    const episode = {
      ...candidate(
        `recovery_${suffix}`,
        `${'e'.repeat(32)}`,
        startedAt,
        `equal-clock-rep-${suffix}`,
      ),
      targetBpm: 115,
    };
    await createRecoveryAlertEpisode(owner, episode, startedAt);
    const prior = {
      sequence: 0,
      recordedAt: firstSampleAt,
      activeElapsedMs: 16_000,
      bpm: 200,
    };
    expect(await insertHeartRateSamples(streamId, tokenHash, [prior], firstSampleAt)).toEqual([0]);
    await applyRecoveryHeartRateSamples(owner, streamId, [prior], firstSampleAt);

    const duplicateAndNext = [{
      sequence: 1,
      recordedAt: firstSampleAt,
      activeElapsedMs: 16_000,
      bpm: 100,
    }, {
      sequence: 2,
      recordedAt: firstSampleAt + 1_000,
      activeElapsedMs: 17_000,
      bpm: 100,
    }];
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      duplicateAndNext,
      firstSampleAt + 1_000,
    )).toEqual([1, 2]);
    await applyRecoveryHeartRateSamples(
      owner,
      streamId,
      duplicateAndNext,
      firstSampleAt + 1_000,
    );
    // Watch ignores the duplicate t0=100. Its median is [200,100] = 150,
    // above target; the server must not start a false low-heart-rate hold.
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 2,
      lastHeartRateRecordedAt: firstSampleAt + 1_000,
      belowTargetStartedAt: null,
      readyAt: null,
    });

    const next = {
      sequence: 3,
      recordedAt: firstSampleAt + 2_000,
      activeElapsedMs: 18_000,
      bpm: 100,
    };
    expect(await insertHeartRateSamples(streamId, tokenHash, [next], next.recordedAt)).toEqual([3]);
    await applyRecoveryHeartRateSamples(owner, streamId, [next], next.recordedAt);
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 3,
      belowTargetStartedAt: next.recordedAt,
      readyAt: null,
    });
  });

  it('resets only the hold for an invalid point and reuses prior valid median points', async () => {
    const suffix = `invalid-${Date.now()}`;
    const owner = `user:recovery-${suffix}`;
    const startedAt = 7_000_000;
    const firstSampleAt = startedAt + 16_000;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    const episode = candidate(
      `recovery_${suffix}`,
      `${'i'.repeat(32)}`,
      startedAt,
      `invalid-rep-${suffix}`,
    );
    await createRecoveryAlertEpisode(owner, episode, startedAt);

    const firstValid = [0, 1].map((offset) => ({
      sequence: offset,
      recordedAt: firstSampleAt + offset * 1_000,
      activeElapsedMs: 16_000 + offset * 1_000,
      bpm: 110,
    }));
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      firstValid,
      firstSampleAt + 1_000,
    )).toEqual([0, 1]);
    await applyRecoveryHeartRateSamples(owner, streamId, firstValid, firstSampleAt + 1_000);
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 2,
      belowTargetStartedAt: firstSampleAt + 1_000,
    });

    const invalidFuture = {
      sequence: 2,
      recordedAt: firstSampleAt + 4_001,
      activeElapsedMs: 20_001,
      bpm: 110,
    };
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      [invalidFuture],
      firstSampleAt + 2_000,
    )).toEqual([2]);
    await applyRecoveryHeartRateSamples(
      owner,
      streamId,
      [invalidFuture],
      firstSampleAt + 2_000,
    );
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 2,
      belowTargetStartedAt: null,
    });

    const immediateValid = {
      sequence: 3,
      recordedAt: firstSampleAt + 5_000,
      activeElapsedMs: 21_000,
      bpm: 110,
    };
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      [immediateValid],
      immediateValid.recordedAt,
    )).toEqual([3]);
    await applyRecoveryHeartRateSamples(
      owner,
      streamId,
      [immediateValid],
      immediateValid.recordedAt,
    );
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 3,
      belowTargetStartedAt: immediateValid.recordedAt,
      lastHeartRateRecordedAt: immediateValid.recordedAt,
      readyAt: null,
    });

    const completingBatch = Array.from({ length: 12 }, (_, index) => ({
      sequence: index + 4,
      recordedAt: firstSampleAt + (index + 6) * 1_000,
      activeElapsedMs: 22_000 + index * 1_000,
      bpm: 110,
    }));
    const completingReceivedAt = firstSampleAt + 15_000;
    expect(await insertHeartRateSamples(
      streamId,
      tokenHash,
      completingBatch,
      completingReceivedAt,
    )).toEqual(completingBatch.map((sample) => sample.sequence));
    await applyRecoveryHeartRateSamples(
      owner,
      streamId,
      completingBatch,
      completingReceivedAt,
    );
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 15,
      belowTargetStartedAt: immediateValid.recordedAt,
      readyAt: firstSampleAt + 17_000,
      readyReason: 'heart-rate-target',
    });
  });

  it('keeps preferences, idempotency, summaries, and erasure scoped to one account', async () => {
    const owner = `user:recovery-memory-${Date.now()}`;
    const other = `user:recovery-memory-other-${Date.now()}`;
    const startedAt = 1_000_000;
    const first = candidate('recovery_memory_1', `${'a'.repeat(32)}`, startedAt, 'rep-1');

    await saveRecoveryAlertPreference(owner, {
      mode: 'heart-rate', timerSeconds: 120, targetBpm: 120,
      minimumSeconds: 15, maximumSeconds: 60,
    }, startedAt);
    expect(await loadRecoveryAlertPreference(owner)).toMatchObject({ mode: 'heart-rate', targetBpm: 120 });
    expect(await loadRecoveryAlertPreference(other)).toBeNull();

    const created = await createRecoveryAlertEpisode(owner, first, startedAt);
    expect(created).toMatchObject({ replayed: false, conflict: false, episode: { id: first.id } });
    const replay = await createRecoveryAlertEpisode(owner, { ...first, id: 'ignored-new-id' }, startedAt + 1);
    expect(replay).toMatchObject({ replayed: true, conflict: false, episode: { id: first.id } });
    const conflict = await createRecoveryAlertEpisode(owner, {
      ...first,
      id: 'conflicting-id',
      repetitionId: 'rep-foreign',
      requestFingerprint: 'different',
    }, startedAt + 2);
    expect(conflict).toMatchObject({ replayed: false, conflict: true });
    expect(await loadRecoveryAlertEpisode(other, first.id)).toBeNull();

    const suffix = `scope-${Date.now()}`;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    let sequence = 0;
    for (let offset = 16_000; offset <= 32_000; offset += 4_000) {
      const at = startedAt + offset;
      const sample = { sequence, bpm: 110, recordedAt: at, activeElapsedMs: offset };
      sequence += 1;
      expect(await insertHeartRateSamples(streamId, tokenHash, [sample], at)).toEqual([sample.sequence]);
      await applyRecoveryHeartRateSamples(owner, streamId, [sample], at);
    }
    const ready = await loadActiveRecoveryAlertEpisode(owner, startedAt + 32_000);
    expect(ready).toMatchObject({
      id: first.id,
      readyAt: startedAt + 32_000,
      readyReason: 'heart-rate-target',
      freshSampleCount: 5,
      recoverySummary: { recoverySeconds: 32, sampleCount: 5, sustainedTargetSeconds: 12 },
    });
    expect(JSON.stringify(ready)).not.toContain('bpm');
    expect(await loadRecoveryLearningSummaries(owner, 'bmx-race', 120)).toEqual([{
      recoverySeconds: 32,
      sampleCount: 5,
      effortSummary: first.effortSummary,
    }]);
    expect(await loadRecoveryLearningSummaries(other, 'bmx-race', 120)).toEqual([]);
    expect(await loadRecoveryLearningSummaries(owner, 'bmx-race', 100)).toEqual([]);
    expect(await loadActiveRecoveryAlertEpisode(owner, startedAt + 24 * 60 * 60 * 1_000)).toBeNull();
    expect(await loadRecoveryLearningSummaries(owner, 'bmx-race', 120)).toHaveLength(1);

    // A device event clock may be ahead of the server. It is stored as the
    // alert time, but must never become the server revision or make an
    // immediate Add time update look stale to iPhone/Watch.
    const acknowledged = await acknowledgeRecoveryAlert(
      owner,
      first.id,
      'target',
      startedAt + 50_000,
      startedAt + 32_000,
    );
    expect(acknowledged?.alertedAt).toBe(startedAt + 50_000);
    expect(acknowledged!.updatedAt).toBeLessThan(acknowledged!.alertedAt!);
    const extended = await updateRecoveryAlertEpisode(
      owner,
      first.id,
      'add-time',
      { seconds: 30 },
      startedAt + 32_000,
    );
    expect(extended!.updatedAt).toBeGreaterThan(acknowledged!.updatedAt);

    await deleteRecoveryAlertData(owner);
    expect(await loadRecoveryAlertPreference(owner)).toBeNull();
    expect(await loadRecoveryAlertEpisode(owner, first.id)).toBeNull();
  });

  it('matches the Watch rolling median through a noisy above-target spike', async () => {
    const owner = `user:recovery-median-${Date.now()}`;
    const startedAt = 2_000_000;
    const episode = {
      ...candidate('recovery_median_1', `${'m'.repeat(32)}`, startedAt, 'median-rep'),
      targetBpm: 118,
    };
    await createRecoveryAlertEpisode(owner, episode, startedAt);
    const suffix = `median-${Date.now()}`;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    const vector = [
      { bpm: 119, offset: 16_000 },
      { bpm: 117, offset: 20_000 },
      // Raw 121 is above target and resets the median hold at 24s.
      { bpm: 121, offset: 24_000 },
      { bpm: 116, offset: 28_000 },
      { bpm: 115, offset: 32_000 },
      { bpm: 116, offset: 36_000 },
      { bpm: 115, offset: 40_000 },
    ];
    for (const [sequence, point] of vector.entries()) {
      const recordedAt = startedAt + point.offset;
      const sample = {
        sequence,
        bpm: point.bpm,
        recordedAt,
        activeElapsedMs: point.offset,
      };
      expect(await insertHeartRateSamples(streamId, tokenHash, [sample], recordedAt))
        .toEqual([sequence]);
      await applyRecoveryHeartRateSamples(owner, streamId, [sample], recordedAt);
      const current = await loadActiveRecoveryAlertEpisode(owner, recordedAt);
      if (point.offset < 40_000) expect(current?.readyAt).toBeNull();
    }
    expect(await loadActiveRecoveryAlertEpisode(owner, startedAt + 40_000)).toMatchObject({
      readyAt: startedAt + 40_000,
      readyReason: 'heart-rate-target',
      recoverySummary: { sustainedTargetSeconds: 12 },
    });
  });

  it('fails closed on pre-minimum, stale, future, unordered, and gapped sensor data', async () => {
    const owner = `user:recovery-freshness-${Date.now()}`;
    const startedAt = 3_000_000;
    const episode = candidate('recovery_freshness_1', `${'f'.repeat(32)}`, startedAt, 'freshness-rep');
    await createRecoveryAlertEpisode(owner, episode, startedAt);
    const suffix = `freshness-${Date.now()}`;
    const { streamId, tokenHash } = await createPrivateWatchStream(owner, startedAt, suffix);
    let sequence = 0;

    const ingest = async (offset: number, sampleReceivedAt: number) => {
      const sample = {
        sequence,
        bpm: 110,
        recordedAt: startedAt + offset,
        activeElapsedMs: offset,
      };
      sequence += 1;
      expect(await insertHeartRateSamples(streamId, tokenHash, [sample], sampleReceivedAt))
        .toEqual([sample.sequence]);
      await applyRecoveryHeartRateSamples(owner, streamId, [sample], sampleReceivedAt);
    };

    await ingest(14_000, startedAt + 14_000);
    await ingest(20_001, startedAt + 17_000);
    expect((await loadRecoveryAlertEpisode(owner, episode.id))?.freshSampleCount).toBe(0);

    for (const offset of [16_000, 17_000]) {
      await ingest(offset, startedAt + offset);
    }
    await ingest(18_000, startedAt + 28_501);
    await ingest(17_000, startedAt + 17_001);
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 2,
      belowTargetStartedAt: null,
    });

    // The eight-second sensor gap clears the first hold. A full new 12-second
    // median-confirmed hold is required before READY.
    for (const offset of [29_000, 33_000, 37_000, 41_000, 45_000]) {
      await ingest(offset, startedAt + offset);
      const current = await loadRecoveryAlertEpisode(owner, episode.id);
      if (offset < 45_000) expect(current?.readyAt).toBeNull();
    }
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      readyAt: startedAt + 45_000,
      freshSampleCount: 7,
    });
  });

  it('never resurrects a receipt-invalid future sample after wall clock catches up', async () => {
    const suffix = `${Date.now()}`;
    const owner = `user:recovery-future-${suffix}`;
    const base = 5_000_000;
    const enrollmentId = `recovery-future-enrollment-${suffix}`;
    const tokenHash = `recovery-future-token-${suffix}`;
    expect(await createOrRefreshHeartRateWatchEnrollment({
      id: enrollmentId,
      ownerProfileKey: owner,
      requestId: `recovery-future-enrollment-request-${suffix}`,
      installIdHash: `recovery-future-install-${suffix}`,
      scope: 'personal',
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
      now: base,
    })).toMatchObject({ status: 'created' });
    const connection = await createHeartRateWatchConnection({
      id: `recovery-future-connection-${suffix}`,
      enrollmentId,
      ownerProfileKey: owner,
      requestId: `recovery-future-connect-request-${suffix}`,
      installIdHash: `recovery-future-install-${suffix}`,
      pairingId: `recovery-future-pairing-${suffix}`,
      relaySessionId: `watch-connect:recovery-future-${suffix}`,
      riderId: `account:recovery-future-${suffix}`,
      pairCodeHash: `recovery-future-code-${suffix}`,
      ingestTokenHash: tokenHash,
      connectedUntil: base + 4 * 60 * 60 * 1_000,
      now: base,
    });
    expect(connection).toMatchObject({ status: 'created' });
    const streamId = `recovery-future-stream-${suffix}`;
    expect(await createHeartRateStream(
      connection.pairing!.id,
      tokenHash,
      streamId,
      base - 20_000,
      base,
    )).toMatchObject({ id: streamId });
    const episode = candidate(
      `recovery_future_${suffix}`,
      `${'u'.repeat(32)}`,
      base - 20_000,
      `future-rep-${suffix}`,
    );
    await createRecoveryAlertEpisode(owner, episode, base - 20_000);

    const invalidFuture = {
      sequence: 0,
      recordedAt: base + 3_001,
      activeElapsedMs: 23_001,
      bpm: 110,
    };
    expect(await insertHeartRateSamples(streamId, tokenHash, [invalidFuture], base)).toEqual([0]);
    await applyRecoveryHeartRateSamples(owner, streamId, [invalidFuture], base);
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 0,
      belowTargetStartedAt: null,
    });

    const laterValid = {
      sequence: 1,
      recordedAt: base + 4_000,
      activeElapsedMs: 24_000,
      bpm: 110,
    };
    expect(await insertHeartRateSamples(streamId, tokenHash, [laterValid], base + 4_000)).toEqual([1]);
    await applyRecoveryHeartRateSamples(owner, streamId, [laterValid], base + 4_000);
    // The earlier 3.001-second-future point remains in private history, but it
    // cannot seed the rolling median or sustained hold on this second ingest.
    expect(await loadRecoveryAlertEpisode(owner, episode.id)).toMatchObject({
      freshSampleCount: 1,
      belowTargetStartedAt: null,
      readyAt: null,
    });
  });
});
