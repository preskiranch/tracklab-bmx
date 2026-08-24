import { describe, expect, it, vi } from 'vitest';
import type { GetPulledSessionArm } from '../../src/components/GetPulledView';
import {
  createClubOwnerExploreRequest,
  createClubOwnerGetPulledRequest,
  resumeClubOwnerExploreTraining,
} from '../../src/lib/clubOwnerUtilityTrainingActions';
import {
  activateClubOwnerTrainingGroup,
  armClubOwnerTrainingGroup,
  cancelClubOwnerTrainingGroup,
  clubOwnerExploreAuthorizationReferences,
  completeClubOwnerExploreRide,
  completeClubOwnerGetPulledResult,
  recoverClubOwnerExploreBinding,
  waitForClubOwnerTrainingContinuation,
  type ClubOwnerTrainingCoordinatorApi,
} from '../../src/lib/clubOwnerTrainingCoordinator';
import type {
  ClubOwnerTrainingAuthorization,
  ClubOwnerTrainingAuthorizationRequest,
  ClubOwnerTrainingCredential,
} from '../../src/lib/clubOwnerTrainingHistory';
import { createExploreRideStudioBinding } from '../../src/lib/exploreRideCheckpoint';
import type {
  ExploreRideCompleteEvent,
  ExploreRideSessionArm,
  ExploreRoute,
  PlayerSlot,
} from '../../src/types';

const startedAt = 2_000;

function route(): ExploreRoute {
  return {
    id: 'route-owner-four',
    name: 'Owner four-bike route',
    origin: { lat: 38.5, lng: -121.5 },
    destination: { lat: 38.6, lng: -121.4 },
    originLabel: 'Studio',
    destinationLabel: 'Finish',
    travelMode: 'bicycle',
    distanceMeters: 1_000,
    durationSeconds: 600,
    encodedPolyline: 'encoded',
    createdAt: 1_000,
  };
}

function requestFor(
  activityType: 'get-pulled' | 'explore',
  playerIds: readonly PlayerSlot['id'][],
): ClubOwnerTrainingAuthorizationRequest {
  return {
    requestId: `request-${activityType}`,
    clubId: 'club-owner',
    sessionId: `session-${activityType}`,
    activityType,
    armedAt: 1_000,
    assignments: playerIds.map((playerId) => ({
      studioRiderId: `rider-${playerId}`,
      bikeDeviceId: 100 + playerId,
      playerId,
    })),
  };
}

function authorization(
  request: ClubOwnerTrainingAuthorizationRequest,
  starts: ReadonlyMap<PlayerSlot['id'], number> = new Map(),
): ClubOwnerTrainingAuthorization {
  return {
    id: `group-${request.activityType}`,
    ...request,
    expiresAt: 901_000,
    state: starts.size === 0 ? 'armed' : starts.size === request.assignments.length ? 'active' : 'partially-active',
    completedAt: null,
    cancelledAt: null,
    createdAt: 900,
    updatedAt: 1_500,
    assignments: request.assignments.map((assignment) => ({
      id: `assignment-${assignment.playerId}`,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: String(assignment.bikeDeviceId),
      playerId: assignment.playerId,
      startedAt: starts.get(assignment.playerId) ?? null,
      activatedAt: starts.has(assignment.playerId) ? (starts.get(assignment.playerId) ?? 0) + 1 : null,
      endedAt: null,
      state: starts.has(assignment.playerId) ? 'active' : 'waiting',
    })),
  };
}

function credential(value: ClubOwnerTrainingAuthorization): ClubOwnerTrainingCredential {
  const secured = {
    authorization: value,
    replayed: false as const,
    recovered: false,
  } as ClubOwnerTrainingCredential;
  Object.defineProperty(secured, 'completionToken', { value: 's'.repeat(48), enumerable: false });
  return secured;
}

function apiFor(request: ClubOwnerTrainingAuthorizationRequest): ClubOwnerTrainingCoordinatorApi {
  const starts = new Map<PlayerSlot['id'], number>();
  return {
    create: vi.fn(async () => credential(authorization(request))),
    recover: vi.fn(async () => credential(authorization(request, starts))),
    activate: vi.fn(async (_secured, assignmentId, exactStartedAt) => {
      const playerId = Number(assignmentId.split('-').at(-1)) as PlayerSlot['id'];
      starts.set(playerId, exactStartedAt);
      return credential(authorization(request, starts));
    }),
    complete: vi.fn(async (secured, session) => ({
      authorization: { ...secured.authorization, state: 'completed' as const, completedAt: session.endedAt },
      sessions: [],
      replayed: false,
      persistence: true,
    })),
    cancel: vi.fn(async (secured) => ({
      authorization: { ...secured.authorization, state: 'cancelled' as const, cancelledAt: 1_500 },
      cancelled: true,
      replayed: false,
    })),
  };
}

describe('club owner utility training actions', () => {
  it('builds only exact claimed non-account assignments for Get Pulled and mixed Explore rides', () => {
    const getPulledArm: GetPulledSessionArm = {
      sessionId: 'get-pulled:one',
      playerId: 1,
      riderId: 'rider-1',
      riderName: 'Rider 1',
      deviceId: 101,
      armedAt: 1_000,
      durationMs: 6_000,
      airSetting: 5,
    };
    expect(createClubOwnerGetPulledRequest('club-owner', getPulledArm, new Set(['rider-1'])))
      .toMatchObject({ activityType: 'get-pulled', assignments: [{ playerId: 1, bikeDeviceId: 101 }] });
    expect(createClubOwnerGetPulledRequest('club-owner', getPulledArm, new Set())).toBeNull();

    const arm: ExploreRideSessionArm = {
      sessionId: 'explore:mixed',
      route: route(),
      armedAt: 1_000,
      riderBindings: ([1, 2, 3, 4] as const).map((playerId) => ({
        playerId,
        riderId: playerId === 1 ? 'account:owner' : `rider-${playerId}`,
        riderName: `Rider ${playerId}`,
        deviceId: 100 + playerId,
      })),
    };
    const request = createClubOwnerExploreRequest(
      'club-owner',
      arm,
      new Set(['rider-2', 'rider-4']),
      'account:owner',
    );
    expect(request?.assignments.map((assignment) => assignment.playerId)).toEqual([2, 4]);
  });

  it('activates Get Pulled on the exact first-watt clock and atomically saves its planned finish', async () => {
    const request = requestFor('get-pulled', [1]);
    const api = apiFor(request);
    const entry = armClubOwnerTrainingGroup(request, api);
    await completeClubOwnerGetPulledResult(entry, {
      id: request.sessionId,
      playerId: 1,
      riderId: 'rider-1',
      riderName: 'Rider 1',
      startedAt,
      endedAt: startedAt + 6_000,
      durationSeconds: 6,
      airSetting: 5,
      distanceMeters: 70,
      averageWatts: 650,
      peakWatts: 1_200,
      averageCadence: 150,
      peakCadence: 200,
      averageSpeedKph: 42,
      peakSpeedKph: 58,
    });

    expect(api.activate).toHaveBeenCalledWith(expect.anything(), 'assignment-1', startedAt);
    const [, , windows] = (api.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(windows).toEqual([{ assignmentId: 'assignment-1', status: 'finished', endedAt: 8_000 }]);
  });

  it('clips four Explore rider clocks independently with no cross-rider window leakage', async () => {
    const request = requestFor('explore', [1, 2, 3, 4]);
    const api = apiFor(request);
    const entry = armClubOwnerTrainingGroup(request, api);
    const finishClocks = [3_500, 6_000, 8_000, 9_000];
    const result: ExploreRideCompleteEvent = {
      sessionId: request.sessionId,
      route: route(),
      startedAt,
      endedAt: 9_000,
      durationMs: 6_000,
      activeClockSegments: [
        { startedAt: 2_000, endedAt: 4_000, activeElapsedAtStartMs: 0 },
        { startedAt: 5_000, endedAt: 9_000, activeElapsedAtStartMs: 2_000 },
      ],
      riders: request.assignments.map((assignment, index) => ({
        id: `local:${assignment.playerId}`,
        clientId: 'local',
        playerId: assignment.playerId,
        riderId: assignment.studioRiderId,
        name: `Untrusted display ${assignment.playerId}`,
        colorName: 'lime',
        accent: '#74e430',
        distanceMeters: 20 - index * 2,
        velocityMps: 0,
        cadence: 0,
        watts: 0,
        signal: 1,
        finishedAt: finishClocks[index],
        at: finishClocks[index],
      })),
    };

    await completeClubOwnerExploreRide(entry, result);

    expect((api.activate as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2]))
      .toEqual([startedAt, startedAt, startedAt, startedAt]);
    const [, session, windows] = (api.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(windows.map((window: { assignmentId: string; endedAt: number }) => [window.assignmentId, window.endedAt]))
      .toEqual([
        ['assignment-1', 3_500],
        ['assignment-2', 6_000],
        ['assignment-3', 8_000],
        ['assignment-4', 9_000],
      ]);
    expect(windows[0].activeClockSegments).toEqual([
      { startedAt: 2_000, endedAt: 3_500, activeElapsedAtStartMs: 0 },
    ]);
    expect(windows[1].activeClockSegments).toEqual([
      { startedAt: 2_000, endedAt: 4_000, activeElapsedAtStartMs: 0 },
      { startedAt: 5_000, endedAt: 6_000, activeElapsedAtStartMs: 2_000 },
    ]);
    const riders = session.details.riders as Array<{ playerId: number; averageSpeedMph: number }>;
    expect(riders[0].averageSpeedMph).toBeCloseTo((20 / 1609.344) / (1_500 / 3_600_000), 8);
    expect(riders[1].averageSpeedMph).toBeCloseTo((18 / 1609.344) / (3_000 / 3_600_000), 8);
    expect(JSON.stringify(session)).not.toContain('Untrusted display');
  });

  it('persists full token-free Explore recovery material and rotates the credential after reload', async () => {
    const request = requestFor('explore', [1, 2]);
    const api = apiFor(request);
    const entry = armClubOwnerTrainingGroup(request, api);
    const references = await clubOwnerExploreAuthorizationReferences(entry);
    const arm: ExploreRideSessionArm = {
      sessionId: request.sessionId,
      route: route(),
      armedAt: request.armedAt,
      riderBindings: request.assignments.map((assignment) => ({
        playerId: assignment.playerId,
        riderId: assignment.studioRiderId,
        riderName: `Rider ${assignment.playerId}`,
        deviceId: Number(assignment.bikeDeviceId),
      })),
    };
    const binding = createExploreRideStudioBinding(arm, references)!;
    expect(binding.authorizationCheckpoint?.request).toEqual(entry.request);
    expect(JSON.stringify(binding)).not.toMatch(/completionToken|bearer|token/iu);

    const recoveryApi = apiFor(request);
    const recovered = await recoverClubOwnerExploreBinding(binding, recoveryApi);
    await activateClubOwnerTrainingGroup(recovered, startedAt);
    expect(recoveryApi.recover).toHaveBeenCalledWith('group-explore', binding.authorizationCheckpoint?.request);
    expect(recoveryApi.create).not.toHaveBeenCalled();
    expect(recoveryApi.activate).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a restored studio binding has no authorization checkpoint', async () => {
    await expect(resumeClubOwnerExploreTraining({
      existing: null,
      binding: {
        authorizationGroupId: 'legacy-group',
        riders: [{
          playerId: 1,
          riderId: 'rider-1',
          riderName: 'Rider 1',
          deviceId: 101,
          authorizationId: 'legacy-assignment',
        }],
      },
      sessionId: 'legacy-session',
      clubId: 'club-owner',
      startedAt,
      checkpointScope: 'owner-profile',
    })).rejects.toThrow('no recoverable club authorization');
  });

  it('releases an awaited preparation decision before serialized cancellation', async () => {
    const request = requestFor('get-pulled', [1]);
    const api = apiFor(request);
    const entry = armClubOwnerTrainingGroup(request, api);
    const continuation = waitForClubOwnerTrainingContinuation(entry);
    const cancellation = cancelClubOwnerTrainingGroup(entry);
    await expect(continuation).resolves.toBe(false);
    await cancellation;
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });
});
