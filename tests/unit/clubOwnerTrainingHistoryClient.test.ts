import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateClubOwnerTrainingAssignment,
  cancelClubOwnerTrainingAuthorization,
  completeClubOwnerTrainingGroup,
  createClubOwnerTrainingAuthorization,
  recoverClubOwnerTrainingCompletionToken,
  type ClubOwnerTrainingAuthorization,
  type ClubOwnerTrainingAuthorizationRequest,
} from '../../src/lib/clubOwnerTrainingHistory';
import type { TrainingSessionInput } from '../../src/lib/trainingHistory';

const request: ClubOwnerTrainingAuthorizationRequest = {
  requestId: 'request-bmx-4',
  clubId: 'club-test',
  sessionId: 'session-bmx-race',
  activityType: 'bmx-race',
  armedAt: 1_000,
  assignments: [1, 2, 3, 4].map((playerId) => ({
    studioRiderId: `rider-${playerId}`,
    bikeDeviceId: 100 + playerId,
    playerId: playerId as 1 | 2 | 3 | 4,
  })),
};

function authorization(
  state: ClubOwnerTrainingAuthorization['state'] = 'armed',
  activeCount = 0,
): ClubOwnerTrainingAuthorization {
  const completed = state === 'completed';
  const cancelled = state === 'cancelled';
  return {
    id: 'authorization-group-4',
    clubId: request.clubId,
    requestId: request.requestId,
    sessionId: request.sessionId,
    activityType: request.activityType,
    armedAt: request.armedAt,
    expiresAt: 901_000,
    state,
    completedAt: completed ? 8_000 : null,
    cancelledAt: cancelled ? 2_000 : null,
    createdAt: 900,
    updatedAt: completed ? 8_000 : cancelled ? 2_000 : 1_500,
    assignments: request.assignments.map((assignment, index) => {
      const isActive = index < activeCount || completed;
      const startedAt = isActive ? 1_100 + index * 100 : null;
      return {
        id: `assignment-${index + 1}`,
        studioRiderId: assignment.studioRiderId,
        bikeDeviceId: String(assignment.bikeDeviceId),
        playerId: assignment.playerId,
        startedAt,
        activatedAt: isActive ? startedAt! + 5 : null,
        endedAt: completed ? startedAt! + 4_000 + index * 100 : null,
        state: completed ? 'completed' : cancelled ? 'cancelled' : isActive ? 'active' : 'waiting',
      };
    }),
  };
}

function sharedRaceSession(): TrainingSessionInput {
  return {
    id: request.sessionId,
    activityType: 'bmx-race',
    title: 'Four-bike club race',
    startedAt: 1_000,
    endedAt: 7_000,
    durationMs: 6_000,
    distanceMeters: 350,
    trackId: 'track-test',
    trackName: 'Test Track',
    details: {
      summaries: [1, 2, 3, 4].map((playerId, index) => ({
        playerId,
        riderId: `client-identity-${playerId}`,
        riderName: `Client Rider ${playerId}`,
        photoUrl: `https://example.invalid/${playerId}.jpg`,
        rank: index + 1,
        finishTimeMs: 4_000 + index * 100,
        thirtyFootTimeMs: 1_000,
        distanceMeters: 350,
        sampleCount: 100,
        topSpeedKph: 50,
        averageSpeedKph: 40,
        topCadence: 180,
        averageCadence: 150,
        topWatts: 1_300,
        averageWatts: 700,
      })),
      zoneResults: [],
      reactionTimesByPlayer: { 1: 210, 2: 220, 3: 230, 4: 240 },
      selectedMetrics: ['cadence', 'speed', 'power', 'reaction'],
      events: [{ at: 1_000, type: 'race-start', label: 'discard me' }],
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('club owner group training history client', () => {
  it('represents a create replay without a token and recovers a rotated memory-only token', async () => {
    const rotatedToken = 'r'.repeat(48);
    const storageSetItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: storageSetItem, removeItem: vi.fn() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        authorization: authorization(),
        replayed: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        authorization: authorization(),
        completionToken: rotatedToken,
        recovered: true,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const replay = await createClubOwnerTrainingAuthorization(request);
    expect(replay).toMatchObject({ replayed: true, requiresTokenRecovery: true });
    expect('completionToken' in replay).toBe(false);

    const recovered = await recoverClubOwnerTrainingCompletionToken(replay.authorization.id, request);
    expect(recovered.completionToken).toBe(rotatedToken);
    expect(recovered.recovered).toBe(true);
    expect(Object.keys(recovered)).not.toContain('completionToken');
    expect({ ...recovered }).not.toHaveProperty('completionToken');
    expect(structuredClone(recovered)).not.toHaveProperty('completionToken');
    expect(JSON.stringify(recovered)).not.toContain(rotatedToken);
    expect(JSON.stringify(recovered)).not.toContain('completionToken');
    expect(storageSetItem).not.toHaveBeenCalled();

    const createBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const recoveryBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(createBody.assignments.map((assignment: { bikeDeviceId: unknown }) => assignment.bikeDeviceId)).toEqual([
      '101', '102', '103', '104',
    ]);
    expect(recoveryBody).toEqual(createBody);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-TrackLab-Group-Completion-Token')).toBe(false);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('X-TrackLab-Group-Completion-Token')).toBe(false);
  });

  it('activates four riders and atomically completes three finishes plus one DNF row', async () => {
    const token = 'c'.repeat(48);
    let currentAuthorization = authorization();
    let activationCount = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/club-live/training-authorizations') {
        return jsonResponse({
          authorization: currentAuthorization,
          completionToken: token,
          replayed: false,
        }, 201);
      }
      if (url.endsWith('/activate')) {
        activationCount += 1;
        currentAuthorization = authorization(activationCount === 4 ? 'active' : 'partially-active', activationCount);
        return jsonResponse({ authorization: currentAuthorization });
      }
      if (url === '/api/club-live/assigned-training-sessions') {
        const completed = authorization('completed', 4);
        completed.assignments[3] = { ...completed.assignments[3], endedAt: 2_600 };
        return jsonResponse({
          authorization: completed,
          sessions: completed.assignments.map((assignment, index) => ({
            id: `${request.sessionId}:${assignment.id}`,
            activityType: request.activityType,
            title: 'Four-bike club race',
            startedAt: assignment.startedAt,
            endedAt: assignment.endedAt,
            durationMs: assignment.endedAt! - assignment.startedAt!,
            distanceMeters: 350,
            trackId: 'track-test',
            trackName: 'Test Track',
            source: 'live',
            club: {
              id: request.clubId,
              name: 'Club Test',
              studioRiderId: assignment.studioRiderId,
              riderName: `Athlete ${index + 1}`,
              role: 'athlete',
            },
            details: {
              summaries: [{
                playerId: assignment.playerId,
                finishTimeMs: index === 3 ? null : 4_000 + index * 100,
                resultStatus: index === 3 ? 'dnf' : 'finished',
              }],
              zoneResults: [],
              reactionTimesByPlayer: { [assignment.playerId]: 210 + index * 10 },
            },
            createdAt: 8_000,
            updatedAt: 8_000,
          })),
          replayed: false,
          persistence: true,
        }, 201);
      }
      throw new Error(`Unexpected request ${url} ${init.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createClubOwnerTrainingAuthorization(request);
    if (created.replayed) throw new Error('Expected a new group authorization.');
    let credential = created;
    for (let index = 0; index < 4; index += 1) {
      credential = await activateClubOwnerTrainingAssignment(
        credential,
        `assignment-${index + 1}`,
        1_100 + index * 100,
      );
    }
    expect(JSON.stringify(credential)).not.toContain(token);

    const session = sharedRaceSession();
    const summaries = (session.details as { summaries: Array<Record<string, unknown>> }).summaries;
    summaries[3] = { ...summaries[3], finishTimeMs: null, distanceMeters: 80 };
    const riderWindows = credential.authorization.assignments.map((assignment, index) => ({
      assignmentId: assignment.id,
      status: index === 3 ? 'dnf' as const : 'finished' as const,
      endedAt: index === 3 ? 2_600 : assignment.startedAt! + 4_000 + index * 100,
    }));
    const completed = await completeClubOwnerTrainingGroup(credential, session, riderWindows);

    expect(completed.sessions).toHaveLength(4);
    expect(new Set(completed.sessions.map((session) => session.club?.studioRiderId))).toEqual(
      new Set(['rider-1', 'rider-2', 'rider-3', 'rider-4']),
    );
    expect(completed).toMatchObject({ replayed: false, persistence: true });

    const activationCalls = fetchMock.mock.calls.slice(1, 5);
    expect(activationCalls.map(([url]) => url)).toEqual([1, 2, 3, 4].map(
      (playerId) => `/api/club-live/training-authorizations/authorization-group-4/assignments/assignment-${playerId}/activate`,
    ));
    activationCalls.forEach(([, init], index) => {
      expect(new Headers(init.headers).get('X-TrackLab-Group-Completion-Token')).toBe(token);
      expect(JSON.parse(String(init.body))).toEqual({ startedAt: 1_100 + index * 100 });
    });

    const completionCall = fetchMock.mock.calls[5];
    const completionBody = JSON.parse(String(completionCall[1].body));
    expect(completionCall[0]).toBe('/api/club-live/assigned-training-sessions');
    expect(new Headers(completionCall[1].headers).get('X-TrackLab-Group-Completion-Token')).toBe(token);
    expect(completionBody).toMatchObject({
      authorizationId: 'authorization-group-4',
      riderWindows,
    });
    expect(completionBody.riderWindows.map((window: { status: string }) => window.status)).toEqual([
      'finished', 'finished', 'finished', 'dnf',
    ]);
    expect(completionBody.sessions).toBeUndefined();
    expect(completionBody.completionToken).toBeUndefined();
    expect(completionBody.session.details.events).toBeUndefined();
    expect(JSON.stringify(completionBody.session)).not.toMatch(/client-identity|Client Rider|photoUrl/u);
  });

  it('cancels with the one-use token in the header and never in the body', async () => {
    const token = 'x'.repeat(48);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        authorization: authorization(),
        completionToken: token,
        replayed: false,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        authorization: authorization('cancelled'),
        cancelled: true,
        replayed: false,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await createClubOwnerTrainingAuthorization(request);
    if (created.replayed) throw new Error('Expected a new group authorization.');
    const cancelled = await cancelClubOwnerTrainingAuthorization(created, { keepalive: true });

    expect(cancelled).toMatchObject({ cancelled: true, replayed: false });
    const [, init] = fetchMock.mock.calls[1];
    expect(init).toMatchObject({ method: 'DELETE', keepalive: true, body: '{}' });
    expect(new Headers(init.headers).get('X-TrackLab-Group-Completion-Token')).toBe(token);
    expect(String(init.body)).not.toContain(token);
  });

  it('rejects duplicate rider, bike, or player seats before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createClubOwnerTrainingAuthorization({
      ...request,
      assignments: [request.assignments[0], { ...request.assignments[1], bikeDeviceId: 101 }],
    })).rejects.toThrow('Each club rider, Wattbike, and player can be assigned only once.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
