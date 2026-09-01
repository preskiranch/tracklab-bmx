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
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Heart-rate cloud test server did not become healthy.\n${serverOutput}`);
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
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];
  const body = await response.json() as { user: { id: string } };
  expect(cookie).toContain('tracklab_session=');
  return { cookie, user: body.user };
}

type EventStream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

async function openLiveStream(cookie: string, clubId = ''): Promise<EventStream> {
  const controller = new AbortController();
  const query = clubId ? `?clubId=${encodeURIComponent(clubId)}` : '';
  const response = await fetch(`${baseUrl}/api/heart-rate/live${query}`, {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('Heart-rate SSE response did not include a body.');
  return { controller, reader: response.body.getReader(), decoder: new TextDecoder(), buffer: '' };
}

async function waitForEvent(stream: EventStream, eventName: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.+)$/m)?.[1]?.trim();
      if (event === eventName) return data ? JSON.parse(data) : {};
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), remaining);
      }),
    ]);
    if (chunk.done) throw new Error(`Heart-rate SSE ended before ${eventName}.`);
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
  throw new Error(`Timed out waiting for ${eventName}.`);
}

async function expectNoEvent(stream: EventStream, eventName: string, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      if (event === eventName) throw new Error(`Unexpected ${eventName} event.`);
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      stream.reader.read().then((chunk) => ({ kind: 'chunk' as const, chunk })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: 'timeout' }), remaining);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (result.kind === 'timeout') return;
    if (result.chunk.done) return;
    stream.buffer += stream.decoder.decode(result.chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'hr-club-owner@tracklab.test',
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

describe('private Apple Watch heart-rate cloud relay', () => {
  it('scopes pairing, deduplicates samples, relays live BPM, and computes private zone summaries', async () => {
    const athlete = await register('heart-rate-athlete@tracklab.test', 'Heart Rate Athlete');
    const other = await register('heart-rate-other@tracklab.test', 'Other Rider');
    const sessionId = `monitor-sprint-${Date.now()}`;

    const wrongRider = await api('/api/heart-rate/pairings', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        riderId: `account:${other.user.id}`,
        playerId: 1,
      }),
    }, athlete.cookie);
    expect(wrongRider.status).toBe(400);

    const unclaimedStudioConsent = await api('/api/heart-rate/pairings', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        riderId: `account:${athlete.user.id}`,
        playerId: 1,
        liveStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(unclaimedStudioConsent.status).toBe(400);

    const pairingResponse = await api('/api/heart-rate/pairings', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        riderId: `account:${athlete.user.id}`,
        playerId: 1,
      }),
    }, athlete.cookie);
    expect(pairingResponse.status).toBe(201);
    const pairingBody = await pairingResponse.json() as any;
    expect(pairingBody.pairCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(pairingBody.pairing).not.toHaveProperty('pairCodeHash');
    expect(pairingBody.pairing).not.toHaveProperty('ingestTokenHash');

    const claimResponse = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: pairingBody.pairCode }),
    }, athlete.cookie);
    expect(claimResponse.status).toBe(200);
    const claimBody = await claimResponse.json() as any;
    expect(claimBody.ingestToken.length).toBeGreaterThanOrEqual(32);
    expect(claimBody.pairing).toMatchObject({ sessionId, activityType: 'monitor-sprint', playerId: 1 });

    const replayedClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: pairingBody.pairCode }),
    }, athlete.cookie);
    expect(replayedClaim.status).toBe(409);

    // Model sensor samples that have already happened. Future-dated batches
    // are retained privately but intentionally never projected as live BPM.
    const startedAt = Date.now() - 10_000;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ startedAt }),
    });
    expect(streamResponse.status).toBe(201);
    const streamBody = await streamResponse.json() as any;
    const streamId = streamBody.stream.id as string;

    const liveStream = await openLiveStream(athlete.cookie);
    await waitForEvent(liveStream, 'ready');
    const samples = [
      { sequence: 0, recordedAt: startedAt, activeElapsedMs: 0, bpm: 100 },
      { sequence: 1, recordedAt: startedAt + 5_000, activeElapsedMs: 5_000, bpm: 120 },
      { sequence: 2, recordedAt: startedAt + 10_000, activeElapsedMs: 10_000, bpm: 140 },
    ];
    const samplesResponse = await api(`/api/heart-rate/streams/${streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ samples }),
    });
    expect(samplesResponse.status).toBe(200);
    expect(await samplesResponse.json()).toEqual({ accepted: 3, duplicates: 0 });
    const liveEvent = await waitForEvent(liveStream, 'heart-rate');
    expect(liveEvent).toMatchObject({ streamId, sessionId, bpm: 140, activeElapsedMs: 10_000 });
    expect(liveEvent.freshUntil).toBeGreaterThan(liveEvent.receivedAt);
    liveStream.controller.abort();

    const duplicateResponse = await api(`/api/heart-rate/streams/${streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ samples }),
    });
    expect(await duplicateResponse.json()).toEqual({ accepted: 0, duplicates: 3 });

    const backwardClock = await api(`/api/heart-rate/streams/${streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ samples: [{
        sequence: 3,
        recordedAt: startedAt + 11_000,
        activeElapsedMs: 1_000,
        bpm: 150,
      }] }),
    });
    expect(backwardClock.status).toBe(400);

    const invalidSample = await api(`/api/heart-rate/streams/${streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ samples: [{ sequence: 3, recordedAt: startedAt, activeElapsedMs: 15_000, bpm: 301 }] }),
    });
    expect(invalidSample.status).toBe(400);

    const finalizeResponse = await api(`/api/heart-rate/streams/${streamId}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({
        endedAt: startedAt + 15_000,
        activeDurationMs: 15_000,
        summary: { averageBpm: 1_000 },
        zoneWindows: [
          { zoneId: 'pedal-zone-1', zoneName: 'Zone 1', startElapsedMs: 0, endElapsedMs: 7_500 },
          { zoneId: 'pedal-zone-2', zoneName: 'Zone 2', startElapsedMs: 7_500, endElapsedMs: 15_000 },
        ],
      }),
    });
    expect(finalizeResponse.status).toBe(200);
    const finalized = (await finalizeResponse.json() as any).stream;
    expect(finalized.summary).toEqual({
      sampleCount: 3,
      coverageMs: 15_000,
      coveragePercent: 100,
      firstSampleElapsedMs: 0,
      lastSampleElapsedMs: 10_000,
      minimumBpm: 100,
      averageBpm: 120,
      peakBpm: 140,
    });
    expect(finalized.zoneSummaries).toHaveLength(2);
    expect(finalized.zoneSummaries[0]).toMatchObject({
      zoneId: 'pedal-zone-1',
      zoneName: 'Zone 1',
      sampleCount: 2,
      minimumBpm: 100,
      peakBpm: 120,
    });
    expect(finalized.zoneSummaries[1]).toMatchObject({
      zoneId: 'pedal-zone-2',
      zoneName: 'Zone 2',
      sampleCount: 1,
      minimumBpm: 140,
      peakBpm: 140,
    });

    const trainingResponse = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: sessionId,
          activityType: 'monitor-sprint',
          title: 'Monitor sprint',
          startedAt,
          endedAt: startedAt + 15_000,
          durationMs: 15_000,
          distanceMeters: 120,
          details: { cadence: 180 },
          createdAt: startedAt,
        },
      }),
    }, athlete.cookie);
    expect(trainingResponse.status).toBe(201);
    const trainingHistory = await api('/api/training-sessions', {}, athlete.cookie);
    const trainingText = await trainingHistory.text();
    expect(trainingText).not.toContain('averageBpm');
    expect(trainingText).not.toContain('heartRate');

    const ownerSamples = await api(`/api/heart-rate/streams/${streamId}/samples`, {}, athlete.cookie);
    expect(ownerSamples.status).toBe(200);
    expect((await ownerSamples.json() as any).samples).toEqual(samples);
    const otherSamples = await api(`/api/heart-rate/streams/${streamId}/samples`, {}, other.cookie);
    expect(otherSamples.status).toBe(404);

    const revoked = await api(`/api/heart-rate/pairings/${pairingBody.pairing.id}`, {
      method: 'DELETE',
    }, athlete.cookie);
    expect(revoked.status).toBe(200);
    const rejectedAfterRevoke = await api(`/api/heart-rate/streams/${streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimBody.ingestToken}` },
      body: JSON.stringify({ samples: [{ sequence: 4, recordedAt: startedAt + 15_000, activeElapsedMs: 15_000, bpm: 150 }] }),
    });
    expect(rejectedAfterRevoke.status).toBe(401);

    const clubOwner = await register('hr-club-owner@tracklab.test', 'TrackLab Test Club');
    const studioRiderId = `studio-rider-${Date.now()}`;
    const userDataResponse = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Heart Rate Athlete',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      }),
    }, clubOwner.cookie);
    expect(userDataResponse.status).toBe(200);

    const clubInviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, clubOwner.cookie);
    expect(clubInviteResponse.status).toBe(201);
    const clubInvite = await clubInviteResponse.json() as any;
    const clubClaimResponse = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: clubInvite.token, fullName: 'Heart Rate Athlete' }),
    }, athlete.cookie);
    expect(clubClaimResponse.status).toBe(200);

    const clubStateResponse = await api('/api/club-connect', {}, athlete.cookie);
    const clubState = await clubStateResponse.json() as any;
    const membership = clubState.memberships.find((candidate: any) => candidate.studioRiderId === studioRiderId);
    expect(membership).toBeTruthy();
    const clubId = membership.clubId as string;
    const clubAccess = await api(`/api/club-live/access?clubId=${encodeURIComponent(clubId)}`, {}, athlete.cookie);
    expect(clubAccess.status).toBe(200);
    expect((await clubAccess.json() as any).active).toBe(true);

    const studioSessionId = `monitor-sprint-studio-${Date.now()}`;
    const livePublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId,
        studioRiderId,
        sessionId: studioSessionId,
        activityType: 'monitor-sprint',
        status: 'ready',
        startedAt: Date.now(),
        progress: { fraction: 0 },
        metrics: { watts: 0, cadence: 0, speedKph: 0, distanceMeters: 0, elapsedMs: 0 },
      }),
    }, athlete.cookie);
    expect(livePublish.status).toBe(200);

    const studioInvitationResponse = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: studioSessionId,
        activityType: 'monitor-sprint',
        relayScope: 'session',
        studioRiderId,
        playerId: 2,
      }),
    }, clubOwner.cookie);
    expect(studioInvitationResponse.status).toBe(201);
    const studioInvitation = await studioInvitationResponse.json() as any;
    expect(studioInvitation.inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const wrongAthleteClaim = await api('/api/heart-rate/studio-invitations/claim', {
      method: 'POST',
      body: JSON.stringify({
        inviteCode: studioInvitation.inviteCode,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, other.cookie);
    expect(wrongAthleteClaim.status).toBe(409);

    const athleteStudioClaim = await api('/api/heart-rate/studio-invitations/claim', {
      method: 'POST',
      body: JSON.stringify({
        inviteCode: studioInvitation.inviteCode,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(athleteStudioClaim.status).toBe(201);
    const studioPairing = await athleteStudioClaim.json() as any;
    expect(studioPairing.pairing).toMatchObject({
      sessionId: studioSessionId,
      clubId,
      studioRiderId,
      liveStudioConsent: true,
      sessionStudioConsent: true,
    });

    const studioWatchClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: studioPairing.pairCode }),
    }, athlete.cookie);
    expect(studioWatchClaim.status).toBe(200);
    const studioWatch = await studioWatchClaim.json() as any;
    const studioStartedAt = Date.now();
    const studioStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studioWatch.ingestToken}` },
      body: JSON.stringify({ startedAt: studioStartedAt }),
    });
    expect(studioStreamResponse.status).toBe(201);
    const studioStreamId = (await studioStreamResponse.json() as any).stream.id as string;
    const clubLiveStream = await openLiveStream(clubOwner.cookie, clubId);
    await waitForEvent(clubLiveStream, 'ready');
    const studioSampleResponse = await api(`/api/heart-rate/streams/${studioStreamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studioWatch.ingestToken}` },
      body: JSON.stringify({
        samples: [{ sequence: 0, recordedAt: studioStartedAt, activeElapsedMs: 0, bpm: 155 }],
      }),
    });
    expect(studioSampleResponse.status).toBe(200);
    const clubLiveEvent = await waitForEvent(clubLiveStream, 'heart-rate');
    expect(clubLiveEvent).toMatchObject({
      streamId: studioStreamId,
      sessionId: studioSessionId,
      studioRiderId,
      playerId: 2,
      bpm: 155,
    });
    expect(clubLiveEvent).not.toHaveProperty('riderId');
    expect(clubLiveEvent).not.toHaveProperty('activeElapsedMs');
    clubLiveStream.controller.abort();

    const studioFinalize = await api(`/api/heart-rate/streams/${studioStreamId}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studioWatch.ingestToken}` },
      body: JSON.stringify({ endedAt: studioStartedAt + 5_000, activeDurationMs: 5_000 }),
    });
    expect(studioFinalize.status).toBe(200);
    const clubSummariesResponse = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(studioSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      clubOwner.cookie,
    );
    expect(clubSummariesResponse.status).toBe(200);
    const clubSummaries = await clubSummariesResponse.json() as any;
    expect(clubSummaries.streams).toHaveLength(1);
    expect(clubSummaries.streams[0]).toMatchObject({
      sessionId: studioSessionId,
      studioRiderId,
      summary: { sampleCount: 1, averageBpm: 155, peakBpm: 155 },
    });
    expect(clubSummaries.streams[0]).not.toHaveProperty('id');
    expect(clubSummaries.streams[0]).not.toHaveProperty('streamId');
    expect(clubSummaries.streams[0]).not.toHaveProperty('riderId');
    expect(clubSummaries.streams[0]).not.toHaveProperty('pairingId');
    expect(clubSummaries.streams[0]).not.toHaveProperty('relayScope');
    expect((await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(studioSessionId)}`,
      {},
      clubOwner.cookie,
    )).status).toBe(400);
    const wrongRiderSummaries = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(studioSessionId)}&studioRiderId=another-studio-rider`,
      {},
      clubOwner.cookie,
    );
    expect(wrongRiderSummaries.status).toBe(200);
    expect((await wrongRiderSummaries.json() as any).streams).toEqual([]);
    const clubOwnerRawSamples = await api(
      `/api/heart-rate/streams/${studioStreamId}/samples`,
      {},
      clubOwner.cookie,
    );
    expect(clubOwnerRawSamples.status).toBe(404);
    const revokeMembership = await api('/api/club-connect/revoke', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, clubOwner.cookie);
    expect(revokeMembership.status).toBe(200);
    const summariesAfterRevoke = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(studioSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      clubOwner.cookie,
    );
    expect((await summariesAfterRevoke.json() as any).streams).toEqual([]);
    const athleteStillOwnsSamples = await api(
      `/api/heart-rate/streams/${studioStreamId}/samples`,
      {},
      athlete.cookie,
    );
    expect(athleteStillOwnsSamples.status).toBe(200);
  }, 20_000);

  it('stores delayed and future batches privately without projecting them as live', async () => {
    const athlete = await register(
      `heart-rate-live-freshness-${Date.now()}@tracklab.test`,
      'Live Freshness Athlete',
    );
    const createRelay = async (label: string, startedAt: number) => {
      const sessionId = `live-freshness-${label}-${Date.now()}`;
      const pairingResponse = await api('/api/heart-rate/pairings', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          activityType: 'straight-sprint',
          riderId: `account:${athlete.user.id}`,
          playerId: 1,
        }),
      }, athlete.cookie);
      expect(pairingResponse.status).toBe(201);
      const pairing = await pairingResponse.json() as any;
      const claimResponse = await api('/api/heart-rate/pairings/claim', {
        method: 'POST',
        body: JSON.stringify({ pairCode: pairing.pairCode }),
      }, athlete.cookie);
      expect(claimResponse.status).toBe(200);
      const claim = await claimResponse.json() as any;
      const streamResponse = await api('/api/heart-rate/streams', {
        method: 'POST',
        headers: { Authorization: `Bearer ${claim.ingestToken}` },
        body: JSON.stringify({ startedAt }),
      });
      expect(streamResponse.status).toBe(201);
      return {
        ingestToken: claim.ingestToken as string,
        streamId: (await streamResponse.json() as any).stream.id as string,
      };
    };

    const delayedRecordedAt = Date.now() - 30_000;
    const delayed = await createRelay('delayed', delayedRecordedAt);
    const delayedEvents = await openLiveStream(athlete.cookie);
    await waitForEvent(delayedEvents, 'ready');
    const delayedUpload = await api(`/api/heart-rate/streams/${delayed.streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${delayed.ingestToken}` },
      body: JSON.stringify({ samples: [{
        sequence: 0,
        recordedAt: delayedRecordedAt,
        activeElapsedMs: 0,
        bpm: 141,
      }] }),
    });
    expect(delayedUpload.status).toBe(200);
    await expectNoEvent(delayedEvents, 'heart-rate');
    delayedEvents.controller.abort();
    const delayedSamples = await api(
      `/api/heart-rate/streams/${delayed.streamId}/samples`,
      {},
      athlete.cookie,
    );
    expect((await delayedSamples.json() as any).samples).toEqual([
      expect.objectContaining({ bpm: 141 }),
    ]);
    expect(await (await api('/api/heart-rate/live/latest', {}, athlete.cookie)).json())
      .toEqual({ reading: null, freshnessMs: 10_000 });

    const future = await createRelay('future', Date.now());
    const futureEvents = await openLiveStream(athlete.cookie);
    await waitForEvent(futureEvents, 'ready');
    const exactFutureRecordedAt = Date.now() + 2_000;
    const exactFutureUpload = await api(`/api/heart-rate/streams/${future.streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${future.ingestToken}` },
      body: JSON.stringify({ samples: [{
        sequence: 0,
        recordedAt: exactFutureRecordedAt,
        activeElapsedMs: 0,
        bpm: 142,
      }] }),
    });
    expect(exactFutureUpload.status).toBe(200);
    expect(await waitForEvent(futureEvents, 'heart-rate')).toMatchObject({
      streamId: future.streamId,
      bpm: 142,
    });

    const tooFutureRecordedAt = Date.now() + 5_000;
    const futureUpload = await api(`/api/heart-rate/streams/${future.streamId}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${future.ingestToken}` },
      body: JSON.stringify({ samples: [{
        sequence: 1,
        recordedAt: tooFutureRecordedAt,
        activeElapsedMs: 1,
        bpm: 143,
      }] }),
    });
    expect(futureUpload.status).toBe(200);
    await expectNoEvent(futureEvents, 'heart-rate');
    futureEvents.controller.abort();
    const storedFutureSamples = await api(
      `/api/heart-rate/streams/${future.streamId}/samples`,
      {},
      athlete.cookie,
    );
    expect((await storedFutureSamples.json() as any).samples).toEqual([
      expect.objectContaining({ sequence: 0, bpm: 142 }),
      expect.objectContaining({ sequence: 1, bpm: 143 }),
    ]);
    expect(await (await api('/api/heart-rate/live/latest', {}, athlete.cookie)).json())
      .toEqual({ reading: null, freshnessMs: 10_000 });
  });
});
