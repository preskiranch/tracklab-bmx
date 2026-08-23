import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';
let serverOutput = '';

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The isolated memory server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Recovery Alert test server did not become healthy.\n${serverOutput}`);
}

function api(pathname: string, init: RequestInit = {}, cookie = '') {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

async function register(email: string, name: string) {
  const response = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, password: 'tracklab-test-password' }),
  });
  expect(response.status).toBe(201);
  return {
    cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0],
    user: (await response.json() as any).user,
  };
}

const requestId = (label: string) => `${label}_${'x'.repeat(32)}`;

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('private individual Recovery Alert API', () => {
  it('persists all modes, isolates accounts, and evaluates exact accepted Watch samples', async () => {
    const athlete = await register('recovery-athlete@tracklab.test', 'Recovery Athlete');
    const other = await register('recovery-other@tracklab.test', 'Other Athlete');

    expect((await api('/api/recovery-alert/preferences')).status).toBe(401);
    const defaultsResponse = await api('/api/recovery-alert/preferences', {}, athlete.cookie);
    expect(defaultsResponse.status).toBe(200);
    const defaults = await defaultsResponse.json() as any;
    expect(defaults.accountId).toMatch(/^recacct_[a-f0-9]{32}$/);
    expect(defaults.preference).toMatchObject({ mode: 'off', timerSeconds: 120, targetBpm: 120 });
    expect(JSON.stringify(defaults)).not.toContain(athlete.user.id);

    const offFinish = Date.now();
    const offResponse = await api('/api/recovery-alert/episodes', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('off'),
        activityType: 'bmx-race',
        sessionId: 'off-race-session',
        repetitionId: 'off-race-repetition',
        finishedAt: offFinish,
      }),
    }, athlete.cookie);
    expect(offResponse.status).toBe(200);
    expect(await offResponse.json()).toMatchObject({
      accountId: defaults.accountId,
      episode: null,
      activeEpisode: null,
    });

    const timerPreferenceResponse = await api('/api/recovery-alert/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        mode: 'timer', timerSeconds: 120, targetBpm: 120,
        minimumSeconds: 120, maximumSeconds: 600,
      }),
    }, athlete.cookie);
    expect(timerPreferenceResponse.status).toBe(200);
    const timerPreference = (await timerPreferenceResponse.json() as any).preference;
    expect(timerPreference).toMatchObject({ mode: 'timer', timerSeconds: 120, minimumSeconds: 120 });

    const identityBearingFinish = await api('/api/recovery-alert/episodes', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('identity-bearing'),
        activityType: 'get-pulled',
        sessionId: `get-pulled:account:${athlete.user.id}:${Date.now()}`,
        repetitionId: `get-pulled:${athlete.user.id}`,
        finishedAt: Date.now(),
      }),
    }, athlete.cookie);
    expect(identityBearingFinish.status).toBe(400);

    let timerEpisode: any = null;
    const timerSequenceStartedAt = Date.now() - 60_000;
    for (const activityType of ['get-pulled', 'straight-sprint', 'bmx-race']) {
      const finishedAt = timerSequenceStartedAt + (
        activityType === 'straight-sprint' ? 1_000 : activityType === 'bmx-race' ? 1_100 : 0
      );
      const input = {
        requestId: requestId(`timer-${activityType}`),
        activityType,
        sessionId: `timer-${activityType}-session`,
        repetitionId: `timer-${activityType}-rep-1`,
        finishedAt,
        effortSummary: { finishTimeMs: 15_000, peakPowerWatts: 1_300 },
      };
      const response = await api('/api/recovery-alert/episodes', {
        method: 'POST', body: JSON.stringify(input),
      }, athlete.cookie);
      expect(response.status).toBe(201);
      const body = await response.json() as any;
      timerEpisode = body.episode;
      expect(body.activeEpisode).toMatchObject({ id: timerEpisode.id });
      expect(timerEpisode).toMatchObject({ activityType, mode: 'timer', confidence: 'fixed' });
      expect(timerEpisode.notBeforeAt).toBe(finishedAt);
      expect(timerEpisode.plannedReadyAt).toBe(finishedAt + 120_000);
      expect(timerEpisode.fallbackAt).toBe(timerEpisode.plannedReadyAt);
      expect(timerEpisode.readyAt).toBeNull();
      expect(timerEpisode.updatedAt).toBeGreaterThanOrEqual(timerEpisode.startedAt);
    }

    const replayInput = {
      requestId: requestId('timer-bmx-race'),
      activityType: 'bmx-race',
      sessionId: 'timer-bmx-race-session',
      repetitionId: 'timer-bmx-race-rep-1',
      finishedAt: timerEpisode.startedAt,
      effortSummary: { finishTimeMs: 15_000, peakPowerWatts: 1_300 },
    };
    const replay = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(replayInput),
    }, athlete.cookie);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      episode: { id: timerEpisode.id },
      activeEpisode: { id: timerEpisode.id },
    });

    const conflict = await api('/api/recovery-alert/episodes', {
      method: 'POST',
      body: JSON.stringify({ ...replayInput, repetitionId: 'different-repetition' }),
    }, athlete.cookie);
    expect(conflict.status).toBe(409);

    const otherActive = await api('/api/recovery-alert/episodes/active', {}, other.cookie);
    expect(otherActive.status).toBe(200);
    expect(await otherActive.json()).toMatchObject({ episode: null });
    const otherAction = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(timerEpisode.id)}/actions`,
      { method: 'POST', body: JSON.stringify({ action: 'start-anyway' }) },
      other.cookie,
    );
    expect(otherAction.status).toBe(404);

    const extended = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(timerEpisode.id)}/actions`,
      { method: 'POST', body: JSON.stringify({ action: 'add-time', seconds: 30 }) },
      athlete.cookie,
    );
    expect(extended.status).toBe(200);
    const extendedEpisode = (await extended.json() as any).episode;
    expect(extendedEpisode.plannedReadyAt).toBe(timerEpisode.plannedReadyAt + 30_000);
    const activeAfterExtend = await api('/api/recovery-alert/episodes/active', {}, athlete.cookie);
    expect((await activeAfterExtend.json() as any).episode.plannedReadyAt)
      .toBe(extendedEpisode.plannedReadyAt);

    const manualStart = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(timerEpisode.id)}/actions`,
      { method: 'POST', body: JSON.stringify({ action: 'start-anyway' }) },
      athlete.cookie,
    );
    expect(manualStart.status).toBe(200);
    const manualEpisode = (await manualStart.json() as any).episode;
    expect(manualEpisode).toMatchObject({
      state: 'ready',
      reason: 'manual-start',
      alertTrigger: 'manual',
    });
    expect(manualEpisode.alertedAt).toBe(manualEpisode.readyAt);
    expect(manualEpisode.updatedAt).toBeGreaterThan(extendedEpisode.updatedAt);

    // A lost response for repetition 1 may be retried only after repetition 2
    // has committed. Keep the exact replay for idempotency, but separately
    // return repetition 2 as authoritative so clients never regress state.
    const newerInput = {
      requestId: requestId('timer-bmx-race-rep-2'),
      activityType: 'bmx-race',
      sessionId: replayInput.sessionId,
      repetitionId: 'timer-bmx-race-rep-2',
      finishedAt: timerEpisode.startedAt + 100,
      effortSummary: { finishTimeMs: 14_500, peakPowerWatts: 1_350 },
    };
    const newerResponse = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(newerInput),
    }, athlete.cookie);
    expect(newerResponse.status).toBe(201);
    const newerBody = await newerResponse.json() as any;
    expect(newerBody).toMatchObject({
      replayed: false,
      episode: { repetitionId: newerInput.repetitionId },
      activeEpisode: { repetitionId: newerInput.repetitionId },
    });
    const delayedReplay = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(replayInput),
    }, athlete.cookie);
    expect(delayedReplay.status).toBe(200);
    expect(await delayedReplay.json()).toMatchObject({
      replayed: true,
      episode: { id: timerEpisode.id, repetitionId: replayInput.repetitionId },
      activeEpisode: {
        id: newerBody.episode.id,
        repetitionId: newerInput.repetitionId,
        state: 'recovering',
      },
    });
    const authoritativeActive = await api('/api/recovery-alert/episodes/active', {}, athlete.cookie);
    expect(await authoritativeActive.json()).toMatchObject({
      episode: { id: newerBody.episode.id, repetitionId: newerInput.repetitionId },
    });

    const heartRatePreference = await api('/api/recovery-alert/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        mode: 'heart-rate', timerSeconds: 120, targetBpm: 120,
        minimumSeconds: 15, maximumSeconds: 60,
      }),
    }, athlete.cookie);
    expect(heartRatePreference.status).toBe(200);

    const installId = `wci_${'a'.repeat(64)}`;
    const enrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({ requestId: requestId('recovery-watch-enroll'), installId, scope: 'personal' }),
    }, athlete.cookie);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = (await enrollmentResponse.json() as any).enrollment;
    const connectionResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('recovery-watch-connect'),
        enrollmentId: enrollment.id,
        installId,
      }),
    }, athlete.cookie);
    expect(connectionResponse.status).toBe(201);
    const connection = await connectionResponse.json() as any;
    const streamStartedAt = Date.now() - 12_000;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: streamStartedAt }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;

    const heartRateFinishedAt = Date.now() - 30_000;
    const heartRateCreate = await api('/api/recovery-alert/episodes', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('heart-rate-race'),
        activityType: 'bmx-race',
        sessionId: 'heart-rate-race-session',
        repetitionId: 'heart-rate-race-rep-1',
        finishedAt: heartRateFinishedAt,
        effortSummary: { finishTimeMs: 20_000, peakPowerWatts: 1_500 },
      }),
    }, athlete.cookie);
    expect(heartRateCreate.status).toBe(201);
    const heartRateEpisode = (await heartRateCreate.json() as any).episode;
    expect(heartRateEpisode).toMatchObject({
      mode: 'heart-rate',
      plannedReadyAt: null,
      readyAt: null,
      targetBpm: 120,
    });
    expect(heartRateEpisode.notBeforeAt).toBe(heartRateFinishedAt + 15_000);
    expect(heartRateEpisode.fallbackAt).toBe(heartRateFinishedAt + 60_000);

    const sampleClock = Date.now();
    const firstSamples = [
      { sequence: 0, recordedAt: sampleClock - 9_000, activeElapsedMs: 3_000, bpm: 110 },
      { sequence: 1, recordedAt: sampleClock - 8_000, activeElapsedMs: 4_000, bpm: 111 },
      { sequence: 2, recordedAt: sampleClock - 4_000, activeElapsedMs: 8_000, bpm: 112 },
      { sequence: 3, recordedAt: sampleClock - 500, activeElapsedMs: 11_500, bpm: 113 },
    ];
    const firstIngest = await api(`/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({ samples: firstSamples }),
    });
    expect(firstIngest.status).toBe(200);
    const firstIngestBody = await firstIngest.json() as any;
    expect(firstIngestBody).toMatchObject({
      accepted: 4,
      recoveryAlert: {
        version: 1,
        accountId: defaults.accountId,
        id: heartRateEpisode.id,
        state: 'recovering',
      },
    });
    expect(firstIngestBody.recoveryAlert.issuedAt).toBe(firstIngestBody.recoveryAlert.updatedAt);
    expect(JSON.stringify(firstIngestBody.recoveryAlert)).not.toMatch(/profileKey|userId|samples|owner/i);

    const repeatedIngest = await api(`/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({ samples: firstSamples }),
    });
    expect(repeatedIngest.status).toBe(200);
    expect((await repeatedIngest.json() as any).recoveryAlert.issuedAt)
      .toBe(firstIngestBody.recoveryAlert.issuedAt);

    const earlyTargetAck = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/ack`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
        body: JSON.stringify({
          accountId: defaults.accountId,
          sessionId: heartRateEpisode.sessionId,
          repetitionId: heartRateEpisode.repetitionId,
          trigger: 'target',
          triggeredAt: Date.now(),
          issuedAt: firstIngestBody.recoveryAlert.issuedAt,
          mode: heartRateEpisode.mode,
          notBeforeAt: heartRateEpisode.notBeforeAt,
          plannedReadyAt: heartRateEpisode.plannedReadyAt,
          fallbackAt: heartRateEpisode.fallbackAt,
          targetBpm: heartRateEpisode.targetBpm,
        }),
      },
    );
    // The relay retries after uploading the threshold-crossing samples; an ACK
    // can never self-assert readiness ahead of the server-authoritative model.
    expect(earlyTargetAck.status).toBe(409);

    const forgedBpm = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/heart-rate`,
      {
        method: 'POST',
        body: JSON.stringify({
          streamId: stream.id,
          recordedAt: firstSamples[3].recordedAt,
          bpm: 80,
        }),
      },
      athlete.cookie,
    );
    expect(forgedBpm.status).toBe(409);
    const forgedTimestamp = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/heart-rate`,
      {
        method: 'POST',
        body: JSON.stringify({ streamId: stream.id, recordedAt: Date.now(), bpm: 112 }),
      },
      athlete.cookie,
    );
    expect(forgedTimestamp.status).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 4_200));
    const thresholdAt = Date.now();
    const thresholdIngest = await api(`/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({
        samples: [{
          sequence: 4,
          recordedAt: thresholdAt,
          activeElapsedMs: thresholdAt - streamStartedAt,
          bpm: 113,
        }],
      }),
    });
    expect(thresholdIngest.status).toBe(200);
    const thresholdBody = await thresholdIngest.json() as any;
    expect(thresholdBody.recoveryAlert).toMatchObject({
      id: heartRateEpisode.id,
      state: 'ready',
      reason: 'heart-rate-target',
      readyAt: thresholdAt,
    });
    expect(thresholdBody.recoveryAlert.issuedAt).toBe(thresholdBody.recoveryAlert.updatedAt);
    expect(thresholdBody.recoveryAlert.explanation).toContain('start when you feel ready');

    const staleScheduleAck = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/ack`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
        body: JSON.stringify({
          accountId: defaults.accountId,
          sessionId: heartRateEpisode.sessionId,
          repetitionId: heartRateEpisode.repetitionId,
          trigger: 'target',
          triggeredAt: thresholdAt,
          issuedAt: firstIngestBody.recoveryAlert.issuedAt,
          mode: heartRateEpisode.mode,
          notBeforeAt: heartRateEpisode.notBeforeAt,
          plannedReadyAt: heartRateEpisode.plannedReadyAt,
          fallbackAt: heartRateEpisode.fallbackAt + 30_000,
          targetBpm: heartRateEpisode.targetBpm,
        }),
      },
    );
    expect(staleScheduleAck.status).toBe(409);

    const earlyForeignAck = await api(
      `/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/ack`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${'z'.repeat(64)}` },
        body: JSON.stringify({}),
      },
    );
    expect(earlyForeignAck.status).toBe(401);
    const ack = await api(`/api/recovery-alert/episodes/${encodeURIComponent(heartRateEpisode.id)}/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({
        accountId: defaults.accountId,
        sessionId: heartRateEpisode.sessionId,
        repetitionId: heartRateEpisode.repetitionId,
        trigger: 'target',
        triggeredAt: thresholdAt,
        issuedAt: firstIngestBody.recoveryAlert.issuedAt,
        mode: heartRateEpisode.mode,
        notBeforeAt: heartRateEpisode.notBeforeAt,
        plannedReadyAt: heartRateEpisode.plannedReadyAt,
        fallbackAt: heartRateEpisode.fallbackAt,
        targetBpm: heartRateEpisode.targetBpm,
      }),
    });
    expect(ack.status).toBe(200);
    const ackDirective = (await ack.json() as any).recoveryAlert;
    expect(ackDirective).toMatchObject({
      id: heartRateEpisode.id,
      alertedAt: thresholdAt,
      alertTrigger: 'target',
    });
    expect(ackDirective.issuedAt).toBeGreaterThan(thresholdBody.recoveryAlert.issuedAt);

    const smartPreference = await api('/api/recovery-alert/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'smart' }),
    }, athlete.cookie);
    expect(smartPreference.status).toBe(200);
    expect((await smartPreference.json() as any).preference).toMatchObject({
      mode: 'smart',
      timerSeconds: 120,
      maximumSeconds: 120,
    });
    const smartFinish = Date.now();
    const smartCreate = await api('/api/recovery-alert/episodes', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('smart-race'),
        activityType: 'bmx-race',
        sessionId: 'smart-race-session',
        repetitionId: 'smart-race-rep-1',
        finishedAt: smartFinish,
        effortSummary: { finishTimeMs: 18_000, peakPowerWatts: 1_600 },
      }),
    }, athlete.cookie);
    expect(smartCreate.status).toBe(201);
    const smartEpisode = (await smartCreate.json() as any).episode;
    expect(smartEpisode).toMatchObject({
      mode: 'smart',
      confidence: 'fixed',
      learningEpisodeCount: 1,
      targetBpm: 120,
    });
    expect(smartEpisode.plannedReadyAt).toBe(smartFinish + 120_000);
    expect(smartEpisode.fallbackAt).toBe(smartFinish + 120_000);

    const invalidPreference = await api('/api/recovery-alert/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ targetBpm: 500 }),
    }, athlete.cookie);
    expect(invalidPreference.status).toBe(400);
  }, 20_000);

  it('keeps a newer repetition authoritative when an older first delivery arrives late', async () => {
    const suffix = `${Date.now()}`;
    const athlete = await register(`recovery-order-${suffix}@tracklab.test`, 'Ordered Recovery');
    const preference = await api('/api/recovery-alert/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'timer', timerSeconds: 120 }),
    }, athlete.cookie);
    expect(preference.status).toBe(200);

    const newerFinishedAt = Date.now() - 500;
    const newerInput = {
      requestId: requestId(`ordered-rep-2-${suffix}`),
      activityType: 'straight-sprint',
      sessionId: `ordered-session-${suffix}`,
      repetitionId: `ordered-rep-2-${suffix}`,
      finishedAt: newerFinishedAt,
      effortSummary: { finishTimeMs: 9_500, peakPowerWatts: 1_450 },
    };
    const newerResponse = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(newerInput),
    }, athlete.cookie);
    expect(newerResponse.status).toBe(201);
    const newerBody = await newerResponse.json() as any;
    expect(newerBody.activeEpisode).toMatchObject({ repetitionId: newerInput.repetitionId });

    const olderInput = {
      ...newerInput,
      requestId: requestId(`ordered-rep-1-${suffix}`),
      repetitionId: `ordered-rep-1-${suffix}`,
      finishedAt: newerFinishedAt - 1_000,
      effortSummary: { finishTimeMs: 10_000, peakPowerWatts: 1_350 },
    };
    const delayedOlder = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(olderInput),
    }, athlete.cookie);
    expect(delayedOlder.status).toBe(201);
    const delayedBody = await delayedOlder.json() as any;
    expect(delayedBody).toMatchObject({
      replayed: false,
      episode: { repetitionId: olderInput.repetitionId, state: 'cancelled' },
      activeEpisode: {
        id: newerBody.episode.id,
        repetitionId: newerInput.repetitionId,
        state: 'recovering',
      },
    });
    const active = await api('/api/recovery-alert/episodes/active', {}, athlete.cookie);
    expect(await active.json()).toMatchObject({
      episode: { id: newerBody.episode.id, repetitionId: newerInput.repetitionId },
    });

    const retry = await api('/api/recovery-alert/episodes', {
      method: 'POST', body: JSON.stringify(olderInput),
    }, athlete.cookie);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      replayed: true,
      episode: { repetitionId: olderInput.repetitionId, state: 'cancelled' },
      activeEpisode: { id: newerBody.episode.id, repetitionId: newerInput.repetitionId },
    });
  });
});
