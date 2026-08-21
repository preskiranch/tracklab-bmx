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
  throw new Error(`Account heart-rate cloud test server did not become healthy.\n${serverOutput}`);
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
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  const body = await response.json() as { user: { id: string } };
  return { cookie, user: body.user };
}

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
      TRACKLAB_HEART_RATE_PAIR_CODE_TTL_MS: '1100',
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

describe('private continuous account heart-rate blocks', () => {
  it('publishes universal-link rules for query studio invites and fragment-only account handoffs', async () => {
    for (const pathname of ['/.well-known/apple-app-site-association', '/apple-app-site-association']) {
      const response = await api(pathname);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const association = await response.json() as any;
      const details = association?.applinks?.details;
      expect(details).toHaveLength(1);
      expect(details[0].appIDs).toEqual(['DU7FUS4N34.com.preskilranch.tracklabbmx']);
      expect(details[0].components).toEqual(expect.arrayContaining([
        expect.objectContaining({
          '/': '/',
          '?': { heartRateStudioInvite: '*' },
        }),
        expect.objectContaining({
          '/': '/',
          '#': 'heartRateAccountBlock=*',
        }),
      ]));
      expect(JSON.stringify(association)).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/u);
    }
  });

  it('binds one private block to its account and backfills exact personal session zones', async () => {
    const athlete = await register('account-block-athlete@tracklab.test', 'Account Block Athlete');
    const other = await register('account-block-other@tracklab.test', 'Other Account');

    expect((await api('/api/heart-rate/account-blocks')).status).toBe(401);
    const rejectedIdentity = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({
        requestId: `account-block-request-${Date.now()}`,
        clubId: 'untrusted-club',
        liveStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(rejectedIdentity.status).toBe(400);

    const requestId = `account-block-request-${Date.now()}`;
    const createResponse = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }, athlete.cookie);
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as any;
    expect(created.replayed).toBe(false);
    expect(created.pairCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(created.block).toMatchObject({
      pairingId: created.pairing.id,
      blockId: created.pairing.sessionId,
      relayScope: 'account-block',
      state: 'waiting-watch',
    });
    expect(created.pairing).toMatchObject({
      activityType: 'training-block',
      relayScope: 'account-block',
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    });
    expect(created.pairing).not.toHaveProperty('ownerProfileKey');
    expect(created.pairing).not.toHaveProperty('pairCodeHash');
    expect(created.pairing).not.toHaveProperty('ingestTokenHash');

    const replayResponse = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }, athlete.cookie);
    expect(replayResponse.status).toBe(200);
    const replayed = await replayResponse.json() as any;
    expect(replayed).toMatchObject({
      pairCode: created.pairCode,
      replayed: true,
      block: { pairingId: created.block.pairingId },
    });

    const competingStart = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: `competing-block-request-${Date.now()}` }),
    }, athlete.cookie);
    expect(competingStart.status).toBe(409);
    expect((await competingStart.json() as any).block.pairingId).toBe(created.block.pairingId);

    const otherBlocks = await api('/api/heart-rate/account-blocks', {}, other.cookie);
    expect(otherBlocks.status).toBe(200);
    expect(await otherBlocks.json()).toEqual({ blocks: [] });
    const otherStop = await api(`/api/heart-rate/account-blocks/${created.block.pairingId}`, {
      method: 'DELETE',
    }, other.cookie);
    expect(otherStop.status).toBe(404);

    const otherHandoff = await api(
      `/api/heart-rate/account-blocks/${created.block.pairingId}/handoff`,
      { method: 'POST', body: JSON.stringify({}) },
      other.cookie,
    );
    expect(otherHandoff.status).toBe(404);
    const handoffResponse = await api(
      `/api/heart-rate/account-blocks/${created.block.pairingId}/handoff`,
      { method: 'POST', body: JSON.stringify({}) },
      athlete.cookie,
    );
    expect(handoffResponse.status).toBe(200);
    const recoveredHandoff = await handoffResponse.json() as any;
    expect(recoveredHandoff).toMatchObject({
      block: { pairingId: created.block.pairingId, state: 'waiting-watch' },
    });
    expect(recoveredHandoff.pairCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(recoveredHandoff.pairCode).not.toBe(created.pairCode);
    expect(JSON.stringify(recoveredHandoff)).not.toMatch(/token|hash|profileKey/i);

    const invalidatedOldCode = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: created.pairCode }),
    }, athlete.cookie);
    expect(invalidatedOldCode.status).toBe(409);

    const unauthenticatedClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: recoveredHandoff.pairCode }),
    });
    expect(unauthenticatedClaim.status).toBe(401);

    const wrongAccountClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: recoveredHandoff.pairCode }),
    }, other.cookie);
    expect(wrongAccountClaim.status).toBe(403);

    const claimResponse = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: recoveredHandoff.pairCode }),
    }, athlete.cookie);
    expect(claimResponse.status).toBe(200);
    const claimed = await claimResponse.json() as any;
    expect(claimed.pairing).toMatchObject({
      id: created.block.pairingId,
      sessionId: created.block.blockId,
      activityType: 'training-block',
      relayScope: 'account-block',
    });
    expect(claimed.ingestExpiresAt - Date.now()).toBeLessThanOrEqual(12 * 60 * 60 * 1000);

    const claimedHandoff = await api(
      `/api/heart-rate/account-blocks/${created.block.pairingId}/handoff`,
      { method: 'POST', body: JSON.stringify({}) },
      athlete.cookie,
    );
    expect(claimedHandoff.status).toBe(409);

    const claimedStatuses = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    const claimedBlock = (await claimedStatuses.json() as any).blocks[0];
    expect(claimedBlock.state).toBe('stale');
    expect(claimedBlock.ingestExpiresAt).toBe(claimed.ingestExpiresAt);
    expect(claimedBlock.effectiveExpiresAt).toBe(claimed.ingestExpiresAt);
    expect(JSON.stringify(claimedBlock)).not.toMatch(/token|hash|profileKey/i);

    const endedAt = Date.now();
    const startedAt = endedAt - 8_000;
    const trainingSessionId = `account-block-training-${Date.now()}`;
    const saveResponse = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: trainingSessionId,
          activityType: 'explore',
          title: 'Personal iPad paused Explore ride',
          startedAt,
          endedAt,
          durationMs: 4_000,
          distanceMeters: 90,
          source: 'live',
          createdAt: startedAt,
          details: {
            summaries: [{ playerId: 1, finishTimeMs: 4_000, cadence: 170, averageBpm: 999 }],
            nested: { HealthKit: { bpm: 999 }, allowed: true },
            activeClockSegments: [{
              startedAt,
              endedAt: startedAt + 2_000,
              activeElapsedAtStartMs: 0,
            }, {
              startedAt: startedAt + 6_000,
              endedAt,
              // Deliberately untrusted: the server derives 2,000 from windows.
              activeElapsedAtStartMs: 999_999,
            }],
            zoneResults: [{
              zoneId: 'zone-1',
              zoneName: 'Zone 1',
              riders: [{ playerId: 1, entryElapsedMs: 0, exitElapsedMs: 2_000 }],
            }, {
              zoneId: 'zone-2',
              zoneName: 'Zone 2',
              riders: [{ playerId: 1, entryElapsedMs: 2_000, exitElapsedMs: 4_000 }],
            }],
          },
        },
      }),
    }, athlete.cookie);
    expect(saveResponse.status).toBe(201);
    const saved = await saveResponse.json() as any;
    expect(saved.heartRate).toEqual({ status: 'pending' });
    expect(saved.session.details.nested).toEqual({ allowed: true });
    expect(JSON.stringify(saved.session.details)).not.toMatch(/heart.?rate|health.?kit|bpm|"HR"/i);

    const streamStartedAt = startedAt - 500;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimed.ingestToken}` },
      body: JSON.stringify({ startedAt: streamStartedAt, relayScope: 'studio-block' }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;
    expect(stream).toMatchObject({
      sessionId: created.block.blockId,
      activityType: 'training-block',
      relayScope: 'account-block',
      liveStudioConsent: false,
      sessionStudioConsent: false,
    });
    expect(stream).not.toHaveProperty('clubId');
    expect(stream).not.toHaveProperty('studioRiderId');

    const queuedStopResponse = await api(`/api/heart-rate/account-blocks/${created.block.pairingId}`, {
      method: 'DELETE',
    }, athlete.cookie);
    expect(queuedStopResponse.status).toBe(202);
    const queuedStop = await queuedStopResponse.json() as any;
    expect(queuedStop).toMatchObject({
      draining: true,
      block: { pairingId: created.block.pairingId },
    });
    expect(queuedStop.block.stopRequestedAt).toBeGreaterThanOrEqual(endedAt);
    expect(queuedStop.block.drainExpiresAt).toBeGreaterThan(queuedStop.block.stopRequestedAt);

    const replacementWhileDraining = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: `next-account-block-${Date.now()}` }),
    }, athlete.cookie);
    expect(replacementWhileDraining.status).toBe(201);
    expect((await replacementWhileDraining.json() as any).block.state).toBe('waiting-watch');

    const samples = [
      { sequence: 1, recordedAt: startedAt, activeElapsedMs: 500, bpm: 120 },
      { sequence: 2, recordedAt: startedAt + 1_500, activeElapsedMs: 2_000, bpm: 140 },
      { sequence: 3, recordedAt: startedAt + 3_000, activeElapsedMs: 3_500, bpm: 250 },
      { sequence: 4, recordedAt: startedAt + 5_000, activeElapsedMs: 5_500, bpm: 250 },
      { sequence: 5, recordedAt: startedAt + 6_500, activeElapsedMs: 7_000, bpm: 160 },
      { sequence: 6, recordedAt: endedAt - 1, activeElapsedMs: 8_499, bpm: 180 },
      {
        sequence: 7,
        recordedAt: queuedStop.block.stopRequestedAt + 1,
        activeElapsedMs: queuedStop.block.stopRequestedAt + 1 - streamStartedAt,
        bpm: 250,
      },
    ];
    const sampleResponse = await api(`/api/heart-rate/streams/${stream.id}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimed.ingestToken}` },
      body: JSON.stringify({ samples }),
    });
    expect(sampleResponse.status).toBe(200);
    expect(await sampleResponse.json()).toEqual({ accepted: 6, duplicates: 1 });

    const historyResponse = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as any;
    expect(history.streams).toEqual([]);
    expect(history.segments).toHaveLength(1);
    expect(history.segments[0]).toMatchObject({
      trainingSessionId,
      activityType: 'explore',
      relayScope: 'account-block',
      playerId: 1,
      activeDurationMs: 4_000,
      summary: {
        sampleCount: 4,
        minimumBpm: 120,
        peakBpm: 180,
      },
      zoneSummaries: [{ zoneId: 'zone-1', sampleCount: 2 }, { zoneId: 'zone-2', sampleCount: 2 }],
    });
    expect(history.segments[0]).not.toHaveProperty('clubId');
    expect(history.segments[0]).not.toHaveProperty('studioRiderId');
    expect(JSON.stringify(history.segments[0])).not.toMatch(/pairingId|profileKey|token|hash/i);

    const otherHistory = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      other.cookie,
    );
    expect(otherHistory.status).toBe(200);
    expect(await otherHistory.json()).toEqual({ streams: [], segments: [] });
    expect((await api(`/api/heart-rate/streams/${stream.id}/samples`, {}, other.cookie)).status).toBe(404);
    expect((await api(
      `/api/heart-rate/club-streams?clubId=untrusted-club&sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    )).status).toBe(403);

    const finalizeResponse = await api(`/api/heart-rate/streams/${stream.id}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claimed.ingestToken}` },
      body: JSON.stringify({ endedAt: Date.now() }),
    });
    expect(finalizeResponse.status).toBe(200);
    const endedStatuses = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    const endedBlocks = (await endedStatuses.json() as any).blocks;
    expect(endedBlocks.find((block: any) => block.pairingId === created.block.pairingId).state).toBe('ended');

    const stopResponse = await api(`/api/heart-rate/account-blocks/${created.block.pairingId}`, {
      method: 'DELETE',
    }, athlete.cookie);
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toMatchObject({ draining: false, block: { state: 'revoked' } });
  });

  it('atomically releases an expired unrevoked block before a new start', async () => {
    const athlete = await register('account-block-expiry@tracklab.test', 'Expiry Athlete');
    const firstRequestId = `expiring-account-block-${Date.now()}`;
    const firstResponse = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: firstRequestId }),
    }, athlete.cookie);
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as any;

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const expiredResponse = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    const expired = (await expiredResponse.json() as any).blocks
      .find((block: any) => block.pairingId === first.block.pairingId);
    expect(expired.state).toBe('expired');

    const replacementResponse = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: `replacement-account-block-${Date.now()}` }),
    }, athlete.cookie);
    expect(replacementResponse.status).toBe(201);
    const replacement = await replacementResponse.json() as any;
    expect(replacement.block).toMatchObject({ relayScope: 'account-block', state: 'waiting-watch' });
    expect(replacement.block.pairingId).not.toBe(first.block.pairingId);

    const statuses = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    const blocks = (await statuses.json() as any).blocks;
    expect(blocks.filter((block: any) => block.state === 'waiting-watch')).toHaveLength(1);
    expect(blocks.find((block: any) => block.pairingId === first.block.pairingId).state).toBe('revoked');
  });
});
