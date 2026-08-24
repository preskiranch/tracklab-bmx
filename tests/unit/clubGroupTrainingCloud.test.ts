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
  throw new Error(`Club group cloud test server did not become healthy.\n${serverOutput}`);
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

async function claimStudioRider(
  ownerCookie: string,
  athleteCookie: string,
  studioRiderId: string,
  fullName: string,
) {
  const inviteResponse = await api('/api/club-connect/invites', {
    method: 'POST',
    body: JSON.stringify({ studioRiderId }),
  }, ownerCookie);
  expect(inviteResponse.status).toBe(201);
  const invite = await inviteResponse.json() as any;
  const claimResponse = await api('/api/club-connect/claim', {
    method: 'POST',
    body: JSON.stringify({ token: invite.token, fullName }),
  }, athleteCookie);
  expect(claimResponse.status).toBe(200);
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
      TRACKLAB_ADMIN_EMAILS: 'v22-club-owner@tracklab.test',
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

describe('owner assigned multi-bike training history', () => {
  it('binds seats, recovers tokens, splits all four modes, and commits without cross-rider leakage', async () => {
    const owner = await register('v22-club-owner@tracklab.test', 'V22 Test Club');
    const athletes = await Promise.all([1, 2, 3, 4].map((playerId) => (
      register(`v22-athlete-${playerId}@tracklab.test`, `V22 Athlete ${playerId}`)
    )));
    const stamp = Date.now();
    const riders = [1, 2, 3, 4].map((playerId) => ({
      studioRiderId: `v22-rider-${playerId}-${stamp}`,
      riderName: `V22 Athlete ${playerId}`,
      playerId,
      bikeDeviceId: String(700 + playerId),
    }));
    const duplicateAccountRider = {
      studioRiderId: `v22-rider-duplicate-account-${stamp}`,
      riderName: 'V22 Duplicate Account Seat',
      playerId: 2,
      bikeDeviceId: '799',
    };
    const roster = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [...riders, duplicateAccountRider].map((rider) => ({
          id: rider.studioRiderId,
          name: rider.riderName,
          createdAt: stamp,
          updatedAt: stamp,
        })),
      }),
    }, owner.cookie);
    expect(roster.status).toBe(200);
    for (let index = 0; index < riders.length; index += 1) {
      await claimStudioRider(
        owner.cookie,
        athletes[index].cookie,
        riders[index].studioRiderId,
        riders[index].riderName,
      );
    }
    await claimStudioRider(
      owner.cookie,
      athletes[0].cookie,
      duplicateAccountRider.studioRiderId,
      duplicateAccountRider.riderName,
    );
    const clubStateResponse = await api('/api/club-connect', {}, owner.cookie);
    expect(clubStateResponse.status).toBe(200);
    const clubId = (await clubStateResponse.json() as any).ownedClub.id as string;

    const duplicateAthleteAuthorization = await api('/api/club-live/training-authorizations', {
      method: 'POST',
      body: JSON.stringify({
        requestId: `v22-duplicate-athlete-${stamp}-secure`,
        clubId,
        sessionId: `v22-duplicate-athlete-session-${stamp}`,
        activityType: 'bmx-race',
        armedAt: Date.now() - 1_000,
        assignments: [
          { studioRiderId: riders[0].studioRiderId, bikeDeviceId: 701, playerId: 1 },
          { studioRiderId: duplicateAccountRider.studioRiderId, bikeDeviceId: 799, playerId: 2 },
        ],
      }),
    }, owner.cookie);
    expect(duplicateAthleteAuthorization.status).toBe(409);

    let sequence = 0;
    const arm = async (
      activityType: 'bmx-race' | 'straight-sprint' | 'get-pulled' | 'explore',
      selectedRiders = riders,
      startedAtOverride: number | null = null,
    ) => {
      sequence += 1;
      const startedAt = startedAtOverride ?? Date.now() - 12_000;
      const binding = {
        requestId: `v22-group-request-${stamp}-${sequence}-secure`,
        clubId,
        sessionId: `v22-${activityType}-${stamp}-${sequence}`,
        activityType,
        armedAt: startedAt - 1_000,
        assignments: selectedRiders.map((rider) => ({
          studioRiderId: rider.studioRiderId,
          bikeDeviceId: Number(rider.bikeDeviceId) + sequence * 10,
          playerId: rider.playerId,
        })),
      };
      const response = await api('/api/club-live/training-authorizations', {
        method: 'POST',
        body: JSON.stringify(binding),
      }, owner.cookie);
      expect(response.status).toBe(201);
      const credential = await response.json() as any;
      expect(credential.completionToken).toMatch(/^[a-zA-Z0-9_-]{40,}$/);
      expect(JSON.stringify(credential.authorization)).not.toMatch(/profileKey|token|hash|digest/i);
      return { binding, credential, startedAt };
    };

    const activateAll = async (group: any, token = group.credential.completionToken) => {
      const startedAtByPlayer = new Map<number, number>();
      for (const assignment of group.credential.authorization.assignments) {
        const startedAt = group.startedAt + assignment.playerId * 50;
        const response = await api(
          `/api/club-live/training-authorizations/${group.credential.authorization.id}/assignments/${assignment.id}/activate`,
          {
            method: 'POST',
            headers: { 'X-TrackLab-Group-Completion-Token': token },
            body: JSON.stringify({ startedAt }),
          },
          owner.cookie,
        );
        expect(response.status).toBe(200);
        startedAtByPlayer.set(assignment.playerId, startedAt);
      }
      return startedAtByPlayer;
    };

    const recoveryGroup = await arm('explore', [riders[0]]);
    const conflictingPersonalAccess = await api(
      `/api/club-live/access?clubId=${encodeURIComponent(clubId)}`,
      {},
      athletes[0].cookie,
    );
    expect(conflictingPersonalAccess.status).toBe(200);
    expect(await conflictingPersonalAccess.json()).toMatchObject({
      active: false,
      reason: 'athlete-active-in-owner-session',
    });
    const monitorConflict = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify({
        clubId,
        studioRiderId: riders[0].studioRiderId,
        bikeDeviceId: recoveryGroup.binding.assignments[0].bikeDeviceId,
        sessionId: `monitor-conflict-${stamp}`,
        playerId: 1,
        armedAt: Date.now() - 2_000,
      }),
    }, owner.cookie);
    expect(monitorConflict.status).toBe(409);
    const wrongOwnerRecovery = await api(
      `/api/club-live/training-authorizations/${recoveryGroup.credential.authorization.id}/recover`,
      { method: 'POST', body: JSON.stringify(recoveryGroup.binding) },
      athletes[3].cookie,
    );
    expect(wrongOwnerRecovery.status).toBe(403);
    const changedRecovery = await api(
      `/api/club-live/training-authorizations/${recoveryGroup.credential.authorization.id}/recover`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...recoveryGroup.binding,
          assignments: [{ ...recoveryGroup.binding.assignments[0], bikeDeviceId: 999 }],
        }),
      },
      owner.cookie,
    );
    expect(changedRecovery.status).toBe(409);
    const recoveredResponse = await api(
      `/api/club-live/training-authorizations/${recoveryGroup.credential.authorization.id}/recover`,
      { method: 'POST', body: JSON.stringify(recoveryGroup.binding) },
      owner.cookie,
    );
    expect(recoveredResponse.status).toBe(200);
    const recovered = await recoveredResponse.json() as any;
    expect(recovered.completionToken).not.toBe(recoveryGroup.credential.completionToken);
    expect(recovered.authorization.expiresAt).toBe(
      recoveryGroup.credential.authorization.expiresAt,
    );
    const oldTokenActivation = await api(
      `/api/club-live/training-authorizations/${recoveryGroup.credential.authorization.id}/assignments/${recoveryGroup.credential.authorization.assignments[0].id}/activate`,
      {
        method: 'POST',
        headers: { 'X-TrackLab-Group-Completion-Token': recoveryGroup.credential.completionToken },
        body: JSON.stringify({ startedAt: Date.now() - 1_000 }),
      },
      owner.cookie,
    );
    expect(oldTokenActivation.status).toBe(401);
    const cancelRecovered = await api(
      `/api/club-live/training-authorizations/${recoveryGroup.credential.authorization.id}`,
      {
        method: 'DELETE',
        headers: { 'X-TrackLab-Group-Completion-Token': recovered.completionToken },
      },
      owner.cookie,
    );
    expect(cancelRecovered.status).toBe(200);
    expect((await cancelRecovered.json() as any)).toMatchObject({ cancelled: true, replayed: false });

    const delayedSprintGroup = await arm('straight-sprint', [riders[0]], Date.now() - 118_900);
    while (Date.now() - (delayedSprintGroup.startedAt + 50) <= 120_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const delayedSprintStarts = await activateAll(delayedSprintGroup);
    expect(Date.now() - delayedSprintStarts.get(1)!).toBeGreaterThan(2 * 60_000);
    const cancelDelayedSprint = await api(
      `/api/club-live/training-authorizations/${delayedSprintGroup.credential.authorization.id}`,
      {
        method: 'DELETE',
        headers: {
          'X-TrackLab-Group-Completion-Token': delayedSprintGroup.credential.completionToken,
        },
      },
      owner.cookie,
    );
    expect(cancelDelayedSprint.status).toBe(200);

    const raceGroup = await arm('bmx-race');
    const raceStarts = await activateAll(raceGroup);
    const raceSummaries = riders.map((rider) => ({
      playerId: rider.playerId,
      riderId: riders[(rider.playerId) % riders.length].studioRiderId,
      riderName: `LEAK-SUMMARY-${rider.playerId}`,
      rank: rider.playerId,
      finishTimeMs: rider.playerId === 4 ? null : 5_000 + rider.playerId * 100,
      distanceMeters: rider.playerId === 4 ? 315 : 360,
      topSpeedKph: 55 + rider.playerId,
      averageSpeedKph: 42,
      topCadence: 190 + rider.playerId,
      averageCadence: 170,
      topWatts: 1_500 + rider.playerId,
      averageWatts: 900,
    }));
    const raceZones = Array.from({ length: 12 }, (_, zoneIndex) => ({
      zoneId: `zone-${zoneIndex + 1}`,
      zoneName: `Zone ${zoneIndex + 1}`,
      zoneType: 'pedal',
      startMeter: zoneIndex * 30,
      endMeter: (zoneIndex + 1) * 30,
      riders: riders.map((rider) => {
        const dnfOpenZone = rider.playerId === 4 && zoneIndex === 10;
        const dnfUnenteredZone = rider.playerId === 4 && zoneIndex === 11;
        return {
          playerId: rider.playerId,
          sampleCount: dnfUnenteredZone ? 0 : 8,
          entryElapsedMs: dnfUnenteredZone ? null : zoneIndex * 300,
          exitElapsedMs: dnfOpenZone || dnfUnenteredZone ? null : (zoneIndex + 1) * 300,
          durationMs: dnfOpenZone || dnfUnenteredZone ? null : 300,
          topSpeedKph: 50 + rider.playerId,
          averageSpeedKph: 40,
          topCadence: 190 + rider.playerId,
          averageCadence: 160,
          topWatts: 1_400 + rider.playerId,
          averageWatts: 850,
        };
      }),
    }));
    const raceEndedAt = Math.max(...raceSummaries.map((summary) => (
      raceStarts.get(summary.playerId)! + (summary.finishTimeMs ?? 3_150)
    )));
    const raceBody = {
      authorizationId: raceGroup.credential.authorization.id,
      session: {
        id: raceGroup.binding.sessionId,
        activityType: 'bmx-race',
        title: 'Untrusted group title naming another athlete',
        startedAt: Math.min(...raceStarts.values()),
        endedAt: raceEndedAt,
        durationMs: raceEndedAt - Math.min(...raceStarts.values()),
        distanceMeters: 360,
        trackId: 'v22-track-12-zones',
        trackName: 'V22 Twelve Zone Track',
        details: {
          summaries: raceSummaries,
          zoneResults: raceZones,
          reactionTimesByPlayer: { 1: 110, 2: 120, 3: 130, 4: 140 },
          events: [{ type: 'finish', label: 'LEAK-EVENT-ALL-RIDERS' }],
          selectedMetrics: ['cadence', 'speed', 'power', 'reaction'],
          lapCount: 1,
          routeVariantId: 'default',
        },
      },
      riderWindows: raceGroup.credential.authorization.assignments.map((assignment: any) => ({
        assignmentId: assignment.id,
        status: assignment.playerId === 4 ? 'dnf' : 'finished',
        endedAt: raceStarts.get(assignment.playerId)!
          + (raceSummaries[assignment.playerId - 1].finishTimeMs ?? 3_150),
      })),
    };
    const raceComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': raceGroup.credential.completionToken },
      body: JSON.stringify(raceBody),
    }, owner.cookie);
    expect(raceComplete.status, `${await raceComplete.clone().text()}\n${serverOutput}`).toBe(201);
    const raceSaved = await raceComplete.json() as any;
    expect(raceSaved.sessions).toHaveLength(4);
    expect(JSON.stringify(raceSaved)).not.toMatch(/profileKey|completionToken|tokenHash|completionDigest|bpm|relayScope/i);
    raceSaved.sessions.forEach((savedSession: any) => {
      expect(savedSession.details.summaries).toHaveLength(1);
      const playerId = savedSession.details.summaries[0].playerId;
      expect(savedSession.details.zoneResults).toHaveLength(playerId === 4 ? 11 : 12);
      expect(savedSession.details.zoneResults.every((zone: any) => zone.riders.length === 1)).toBe(true);
      expect(Object.keys(savedSession.details.reactionTimesByPlayer)).toHaveLength(1);
      expect(savedSession.details.events).toEqual([]);
      expect(savedSession.details.resultStatus).toBe(playerId === 4 ? 'dnf' : 'finished');
      expect(savedSession.details.summaries[0].resultStatus).toBe(
        playerId === 4 ? 'dnf' : 'finished',
      );
      if (playerId === 4) {
        expect(savedSession.details.zoneResults.at(-1).riders[0]).toMatchObject({
          entryElapsedMs: 3_000,
          exitElapsedMs: 3_150,
          durationMs: 150,
        });
      }
      expect(JSON.stringify(savedSession)).not.toContain('LEAK-');
    });
    const raceReplay = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': raceGroup.credential.completionToken },
      body: JSON.stringify(raceBody),
    }, owner.cookie);
    expect(raceReplay.status).toBe(200);
    expect((await raceReplay.json() as any).replayed).toBe(true);
    const mutableNameReplayBody = structuredClone(raceBody);
    mutableNameReplayBody.session.details.summaries.forEach((summary: any) => {
      summary.riderName = `Renamed display ${summary.playerId}`;
      summary.photoUrl = 'data:image/png;base64,changed-display-only';
    });
    const mutableNameReplay = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': raceGroup.credential.completionToken },
      body: JSON.stringify(mutableNameReplayBody),
    }, owner.cookie);
    expect(mutableNameReplay.status).toBe(200);
    expect((await mutableNameReplay.json() as any).replayed).toBe(true);
    const raceMutation = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': raceGroup.credential.completionToken },
      body: JSON.stringify({
        ...raceBody,
        session: { ...raceBody.session, trackName: 'Mutated replay track' },
      }),
    }, owner.cookie);
    expect(raceMutation.status).toBe(409);

    const straightGroup = await arm('straight-sprint', riders.slice(0, 2));
    const straightStarts = await activateAll(straightGroup);
    const straightSummaries = riders.slice(0, 2).map((rider) => ({
      playerId: rider.playerId,
      riderName: `LEAK-STRAIGHT-${rider.playerId}`,
      rank: rider.playerId,
      finishTimeMs: 4_000 + rider.playerId * 100,
      distanceMeters: 44.196,
      topSpeedKph: 51,
      averageSpeedKph: 39,
      topCadence: 195,
      averageCadence: 160,
      topWatts: 1_400,
      averageWatts: 820,
    }));
    const straightBody = {
      authorizationId: straightGroup.credential.authorization.id,
      session: {
        id: straightGroup.binding.sessionId,
        activityType: 'straight-sprint',
        title: 'Untrusted sprint',
        startedAt: Math.min(...straightStarts.values()),
        endedAt: Math.max(...straightSummaries.map((summary) => straightStarts.get(summary.playerId)! + summary.finishTimeMs)),
        durationMs: 5_000,
        distanceMeters: 44.196,
        trackId: 'v22-straight',
        trackName: 'V22 Straight',
        details: {
          summaries: straightSummaries,
          zoneResults: [],
          reactionTimesByPlayer: { 1: 100, 2: 115 },
          events: [{ label: 'LEAK-STRAIGHT-EVENT' }],
          selectedMetrics: ['cadence', 'speed', 'reaction'],
          sprintDistanceFeet: 145,
          sprintAirSetting: 3,
          lapCount: 1,
          routeVariantId: 'default',
        },
      },
      riderWindows: straightGroup.credential.authorization.assignments.map((assignment: any) => ({
        assignmentId: assignment.id,
        status: 'finished',
        endedAt: straightStarts.get(assignment.playerId)! + straightSummaries[assignment.playerId - 1].finishTimeMs,
      })),
    };
    const straightComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': straightGroup.credential.completionToken },
      body: JSON.stringify(straightBody),
    }, owner.cookie);
    expect(straightComplete.status).toBe(201);
    expect((await straightComplete.json() as any).sessions).toHaveLength(2);

    const invalidZoneGroup = await arm('straight-sprint', [riders[0]]);
    const invalidZoneStarts = await activateAll(invalidZoneGroup);
    const invalidZoneStart = invalidZoneStarts.get(1)!;
    const buildStrictZones = (count: number, invalidAverage = true) => Array.from(
      { length: count },
      (_, zoneIndex) => ({
      zoneId: `strict-zone-${zoneIndex + 1}`,
      zoneName: `Zone ${zoneIndex + 1}`,
      zoneType: 'pedal',
      startMeter: zoneIndex * (44.196 / count),
      endMeter: (zoneIndex + 1) * (44.196 / count),
      riders: [{
        playerId: 1,
        sampleCount: 2,
        entryElapsedMs: zoneIndex * 20,
        exitElapsedMs: (zoneIndex + 1) * 20,
        durationMs: 20,
        topSpeedKph: 50,
        averageSpeedKph: invalidAverage && zoneIndex === count - 1 ? 51 : 40,
        topCadence: 200,
        averageCadence: 160,
        topWatts: 1_300,
        averageWatts: 800,
      }],
    }),
    );
    const invalidZoneSession = {
      id: invalidZoneGroup.binding.sessionId,
      activityType: 'straight-sprint',
      title: 'Invalid zone bounds',
      startedAt: invalidZoneStart,
      endedAt: invalidZoneStart + 4_000,
      durationMs: 4_000,
      distanceMeters: 44.196,
      trackId: 'v22-strict-zone-track',
      trackName: 'Strict Zone Track',
      details: {
        summaries: [{
          playerId: 1,
          rank: 1,
          finishTimeMs: 4_000,
          distanceMeters: 44.196,
          topSpeedKph: 51,
          averageSpeedKph: 39,
          topCadence: 205,
          averageCadence: 160,
          topWatts: 1_400,
          averageWatts: 820,
        }],
        zoneResults: buildStrictZones(13),
        reactionTimesByPlayer: { 1: 100 },
        selectedMetrics: ['cadence', 'speed', 'power'],
        sprintDistanceFeet: 145,
        sprintAirSetting: 3,
      },
    };
    const invalidZoneWindow = [{
      assignmentId: invalidZoneGroup.credential.authorization.assignments[0].id,
      status: 'finished',
      endedAt: invalidZoneStart + 4_000,
    }];
    const invalidMetricCompletion = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: {
        'X-TrackLab-Group-Completion-Token': invalidZoneGroup.credential.completionToken,
      },
      body: JSON.stringify({
        authorizationId: invalidZoneGroup.credential.authorization.id,
        session: invalidZoneSession,
        riderWindows: invalidZoneWindow,
      }),
    }, owner.cookie);
    expect(invalidMetricCompletion.status).toBe(400);
    const tooManyZoneCompletion = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: {
        'X-TrackLab-Group-Completion-Token': invalidZoneGroup.credential.completionToken,
      },
      body: JSON.stringify({
        authorizationId: invalidZoneGroup.credential.authorization.id,
        session: {
          ...invalidZoneSession,
          details: { ...invalidZoneSession.details, zoneResults: buildStrictZones(501, false) },
        },
        riderWindows: invalidZoneWindow,
      }),
    }, owner.cookie);
    expect(tooManyZoneCompletion.status).toBe(400);
    const cancelInvalidZone = await api(
      `/api/club-live/training-authorizations/${invalidZoneGroup.credential.authorization.id}`,
      {
        method: 'DELETE',
        headers: {
          'X-TrackLab-Group-Completion-Token': invalidZoneGroup.credential.completionToken,
        },
      },
      owner.cookie,
    );
    expect(cancelInvalidZone.status).toBe(200);

    const pullGroup = await arm('get-pulled', [riders[0]], Date.now() - 1_000);
    const pullAssignment = pullGroup.credential.authorization.assignments[0];
    const studioInvitation = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: pullGroup.binding.sessionId,
        activityType: 'get-pulled',
        relayScope: 'studio-block',
        studioRiderId: riders[0].studioRiderId,
        playerId: 1,
      }),
    }, owner.cookie);
    expect(studioInvitation.status).toBe(201);
    const studioInvite = await studioInvitation.json() as any;
    const studioClaim = await api('/api/heart-rate/studio-invitations/claim', {
      method: 'POST',
      body: JSON.stringify({
        inviteCode: studioInvite.inviteCode,
        studioBlockConsent: true,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athletes[0].cookie);
    expect(studioClaim.status).toBe(201);
    const studioClaimBody = await studioClaim.json() as any;
    const studioWatchClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: studioClaimBody.pairCode }),
    }, athletes[0].cookie);
    expect(studioWatchClaim.status).toBe(200);
    const studioWatch = await studioWatchClaim.json() as any;
    const pullStarts = await activateAll(pullGroup);
    const pullStart = pullStarts.get(1)!;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studioWatch.ingestToken}` },
      body: JSON.stringify({ startedAt: pullStart }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;
    const sampleResponse = await api(`/api/heart-rate/streams/${stream.id}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studioWatch.ingestToken}` },
      body: JSON.stringify({ samples: [
        { sequence: 1, recordedAt: pullStart, activeElapsedMs: 0, bpm: 130 },
        { sequence: 2, recordedAt: pullStart + 1_500, activeElapsedMs: 1_500, bpm: 160 },
        { sequence: 3, recordedAt: pullStart + 3_000, activeElapsedMs: 3_000, bpm: 175 },
      ] }),
    });
    expect(sampleResponse.status).toBe(200);
    const accountBlock = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: `v22-account-block-${stamp}-secure` }),
    }, athletes[0].cookie);
    expect(accountBlock.status).toBe(201);
    const pullBody = {
      authorizationId: pullGroup.credential.authorization.id,
      session: {
        id: pullGroup.binding.sessionId,
        activityType: 'get-pulled',
        title: 'Untrusted pull',
        startedAt: pullStart,
        endedAt: pullStart + 3_000,
        durationMs: 3_000,
        distanceMeters: 40,
        trackId: 'preski-ranch-pull-lane',
        trackName: 'Preski Ranch Pull Lane',
        details: {
          durationSeconds: 3,
          airSetting: 4,
          riders: [{
            playerId: 1,
            riderId: riders[1].studioRiderId,
            name: 'LEAK-PULL-RIDER',
            distanceMeters: 40,
            averageWatts: 700,
            peakWatts: 1_250,
            averageCadence: 160,
            peakCadence: 200,
            averageSpeedKph: 42,
            peakSpeedKph: 58,
          }],
        },
      },
      riderWindows: [{
        assignmentId: pullAssignment.id,
        status: 'finished',
        endedAt: pullStart + 3_000,
      }],
    };
    const pullComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': pullGroup.credential.completionToken },
      body: JSON.stringify(pullBody),
    }, owner.cookie);
    expect(pullComplete.status).toBe(201);
    const pullCompleteBody = await pullComplete.json() as any;
    expect(pullCompleteBody.authorization.assignments[0].heartRateAttachmentStatus).toBe(
      'shared-attached',
    );
    expect(JSON.stringify(pullCompleteBody)).not.toMatch(/bpm|profileKey|token|relayScope|segment/i);
    const pullHeartRate = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(pullGroup.binding.sessionId)}`,
      {},
      athletes[0].cookie,
    );
    expect(pullHeartRate.status).toBe(200);
    const pullHeartRateBody = await pullHeartRate.json() as any;
    expect(pullHeartRateBody.segments).toEqual([
      expect.objectContaining({
        relayScope: 'studio-block',
        trainingSessionId: pullGroup.binding.sessionId,
        summary: expect.objectContaining({ sampleCount: 3, peakBpm: 175 }),
      }),
    ]);

    const fallbackGroup = await arm('get-pulled', [riders[1]], Date.now() - 1_000);
    const fallbackAssignment = fallbackGroup.credential.authorization.assignments[0];
    const fallbackStudioInvitation = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: fallbackGroup.binding.sessionId,
        activityType: 'get-pulled',
        relayScope: 'studio-block',
        studioRiderId: riders[1].studioRiderId,
        playerId: 2,
      }),
    }, owner.cookie);
    expect(fallbackStudioInvitation.status).toBe(201);
    const fallbackInvite = await fallbackStudioInvitation.json() as any;
    const fallbackStudioClaim = await api('/api/heart-rate/studio-invitations/claim', {
      method: 'POST',
      body: JSON.stringify({
        inviteCode: fallbackInvite.inviteCode,
        studioBlockConsent: true,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athletes[1].cookie);
    expect(fallbackStudioClaim.status).toBe(201);
    const fallbackStudioPair = await fallbackStudioClaim.json() as any;
    const fallbackStudioWatchClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: fallbackStudioPair.pairCode }),
    }, athletes[1].cookie);
    expect(fallbackStudioWatchClaim.status).toBe(200);

    const fallbackAccountCreate = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: `v22-private-fallback-${stamp}-secure` }),
    }, athletes[1].cookie);
    expect(fallbackAccountCreate.status).toBe(201);
    const fallbackAccount = await fallbackAccountCreate.json() as any;
    const fallbackAccountClaim = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: fallbackAccount.pairCode }),
    }, athletes[1].cookie);
    expect(fallbackAccountClaim.status).toBe(200);
    const fallbackAccountWatch = await fallbackAccountClaim.json() as any;

    const fallbackStarts = await activateAll(fallbackGroup);
    const fallbackStart = fallbackStarts.get(2)!;
    const fallbackStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fallbackAccountWatch.ingestToken}` },
      body: JSON.stringify({ startedAt: fallbackStart }),
    });
    expect(fallbackStreamResponse.status).toBe(201);
    const fallbackStream = (await fallbackStreamResponse.json() as any).stream;
    const fallbackSamples = await api(`/api/heart-rate/streams/${fallbackStream.id}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fallbackAccountWatch.ingestToken}` },
      body: JSON.stringify({ samples: [
        { sequence: 1, recordedAt: fallbackStart, activeElapsedMs: 0, bpm: 125 },
        { sequence: 2, recordedAt: fallbackStart + 1_500, activeElapsedMs: 1_500, bpm: 150 },
        { sequence: 3, recordedAt: fallbackStart + 3_000, activeElapsedMs: 3_000, bpm: 165 },
      ] }),
    });
    expect(fallbackSamples.status).toBe(200);
    const fallbackComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: {
        'X-TrackLab-Group-Completion-Token': fallbackGroup.credential.completionToken,
      },
      body: JSON.stringify({
        authorizationId: fallbackGroup.credential.authorization.id,
        session: {
          id: fallbackGroup.binding.sessionId,
          activityType: 'get-pulled',
          title: 'Private fallback pull',
          startedAt: fallbackStart,
          endedAt: fallbackStart + 3_000,
          durationMs: 3_000,
          distanceMeters: 38,
          trackId: 'preski-ranch-pull-lane',
          trackName: 'Preski Ranch Pull Lane',
          details: {
            durationSeconds: 3,
            airSetting: 4,
            riders: [{
              playerId: 2,
              distanceMeters: 38,
              averageWatts: 680,
              peakWatts: 1_200,
              averageCadence: 155,
              peakCadence: 195,
              averageSpeedKph: 40,
              peakSpeedKph: 56,
            }],
          },
        },
        riderWindows: [{
          assignmentId: fallbackAssignment.id,
          status: 'finished',
          endedAt: fallbackStart + 3_000,
        }],
      }),
    }, owner.cookie);
    expect(fallbackComplete.status).toBe(201);
    const fallbackCompleteBody = await fallbackComplete.json() as any;
    expect(fallbackCompleteBody.authorization.assignments[0].heartRateAttachmentStatus).toBe(
      'not-shared',
    );
    expect(JSON.stringify(fallbackCompleteBody)).not.toMatch(
      /account-block|relayScope|bpm|profileKey|token|segment/i,
    );
    const fallbackHeartRate = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(fallbackGroup.binding.sessionId)}`,
      {},
      athletes[1].cookie,
    );
    expect(fallbackHeartRate.status).toBe(200);
    const fallbackHeartRateBody = await fallbackHeartRate.json() as any;
    expect(fallbackHeartRateBody.segments).toEqual([
      expect.objectContaining({
        relayScope: 'account-block',
        trainingSessionId: fallbackGroup.binding.sessionId,
        summary: expect.objectContaining({ sampleCount: 3, peakBpm: 165 }),
      }),
    ]);

    const exploreGroup = await arm('explore', riders.slice(0, 2));
    const exploreStarts = await activateAll(exploreGroup);
    const exploreWindows = exploreGroup.credential.authorization.assignments.map((assignment: any) => {
      const start = exploreStarts.get(assignment.playerId)!;
      return {
        assignmentId: assignment.id,
        status: 'finished',
        endedAt: start + 5_000,
        activeClockSegments: [
          { startedAt: start, endedAt: start + 2_000, activeElapsedAtStartMs: 999_999 },
          { startedAt: start + 3_000, endedAt: start + 5_000, activeElapsedAtStartMs: 999_999 },
        ],
      };
    });
    const exploreBody = {
      authorizationId: exploreGroup.credential.authorization.id,
      session: {
        id: exploreGroup.binding.sessionId,
        activityType: 'explore',
        title: 'Untrusted Explore title',
        startedAt: Math.min(...exploreStarts.values()),
        endedAt: Math.max(...exploreWindows.map((window: any) => window.endedAt)),
        durationMs: 4_000,
        distanceMeters: 70,
        trackId: 'v22-explore-route',
        trackName: 'V22 Explore Route',
        details: {
          originLabel: 'Start',
          destinationLabel: 'Finish',
          travelMode: 'drive',
          elevationGainMeters: 25,
          elevationLossMeters: 12,
          riders: riders.slice(0, 2).map((rider) => ({
            playerId: rider.playerId,
            riderId: riders[(rider.playerId) % riders.length].studioRiderId,
            name: `LEAK-EXPLORE-${rider.playerId}`,
            distanceMeters: 60 + rider.playerId * 5,
            averageSpeedMph: 20 + rider.playerId,
          })),
        },
      },
      riderWindows: exploreWindows,
    };
    const invalidExploreBody = structuredClone(exploreBody);
    invalidExploreBody.session.details.riders[0].averageSpeedMph = 999;
    const invalidExploreComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': exploreGroup.credential.completionToken },
      body: JSON.stringify(invalidExploreBody),
    }, owner.cookie);
    expect(invalidExploreComplete.status).toBe(400);

    const exploreComplete = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': exploreGroup.credential.completionToken },
      body: JSON.stringify(exploreBody),
    }, owner.cookie);
    expect(exploreComplete.status, await exploreComplete.clone().text()).toBe(201);
    const exploreSaved = await exploreComplete.json() as any;
    expect(exploreSaved.sessions).toHaveLength(2);
    exploreSaved.sessions.forEach((savedSession: any) => {
      expect(savedSession.durationMs).toBe(4_000);
      expect(savedSession.details.travelMode).toBe('drive');
      expect(savedSession.details.riders).toHaveLength(1);
      expect(savedSession.details.activeClockSegments).toEqual([
        expect.objectContaining({ activeElapsedAtStartMs: 0 }),
        expect.objectContaining({ activeElapsedAtStartMs: 2_000 }),
      ]);
      expect(savedSession.details.riders[0].averageSpeedMph).toBeLessThan(40);
      expect(JSON.stringify(savedSession)).not.toContain('LEAK-');
    });

    for (let index = 0; index < athletes.length; index += 1) {
      const historyResponse = await api('/api/training-sessions', {}, athletes[index].cookie);
      expect(historyResponse.status).toBe(200);
      const history = (await historyResponse.json() as any).sessions;
      const raceSession = history.find((entry: any) => entry.id === raceGroup.binding.sessionId);
      expect(raceSession.details.summaries).toHaveLength(1);
      expect(raceSession.details.summaries[0].studioRiderId).toBe(riders[index].studioRiderId);
      expect(raceSession.details.summaries[0].topWatts).toBeGreaterThan(0);
      expect(raceSession.details.resultStatus).toBe(index === 3 ? 'dnf' : 'finished');
      expect(JSON.stringify(raceSession)).not.toContain('LEAK-');
    }

    const conflictGroup = await arm('bmx-race', riders.slice(0, 2));
    const conflictStarts = await activateAll(conflictGroup);
    const personalConflict = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: conflictGroup.binding.sessionId,
          activityType: 'straight-sprint',
          title: 'Existing conflicting athlete session',
          startedAt: Date.now() - 2_000,
          endedAt: Date.now() - 1_000,
          durationMs: 1_000,
          distanceMeters: 10,
          details: { summaries: [{ playerId: 1, finishTimeMs: 1_000 }] },
        },
      }),
    }, athletes[0].cookie);
    expect(personalConflict.status).toBe(201);
    const conflictSummaries = riders.slice(0, 2).map((rider) => ({
      playerId: rider.playerId,
      rank: rider.playerId,
      finishTimeMs: 4_000,
      distanceMeters: 300,
      topSpeedKph: 50,
      averageSpeedKph: 40,
      topCadence: 200,
      averageCadence: 160,
      topWatts: 1_300,
      averageWatts: 800,
    }));
    const atomicFailure = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Group-Completion-Token': conflictGroup.credential.completionToken },
      body: JSON.stringify({
        authorizationId: conflictGroup.credential.authorization.id,
        session: {
          id: conflictGroup.binding.sessionId,
          activityType: 'bmx-race',
          title: 'Atomic conflict test',
          startedAt: Math.min(...conflictStarts.values()),
          endedAt: Math.max(...conflictStarts.values()) + 4_000,
          durationMs: 4_000,
          distanceMeters: 300,
          trackId: 'atomic-track',
          trackName: 'Atomic Track',
          details: { summaries: conflictSummaries, zoneResults: [], reactionTimesByPlayer: {} },
        },
        riderWindows: conflictGroup.credential.authorization.assignments.map((assignment: any) => ({
          assignmentId: assignment.id,
          status: 'finished',
          endedAt: conflictStarts.get(assignment.playerId)! + 4_000,
        })),
      }),
    }, owner.cookie);
    expect(atomicFailure.status).toBe(409);
    const secondHistory = await api('/api/training-sessions', {}, athletes[1].cookie);
    const secondSessions = (await secondHistory.json() as any).sessions;
    expect(secondSessions.some((entry: any) => entry.id === conflictGroup.binding.sessionId)).toBe(false);
  }, 40_000);
});
