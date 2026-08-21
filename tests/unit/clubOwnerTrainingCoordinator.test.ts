import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RaceCapture, TrainingSession } from '../../src/types';
import {
  activateClubOwnerTrainingGroup,
  armClubOwnerTrainingGroup,
  buildClubOwnerRaceTrainingSession,
  cancelClubOwnerTrainingGroup,
  checkpointClubOwnerTrainingGroup,
  clearClubOwnerTrainingCheckpoint,
  completeClubOwnerTraining,
  loadClubOwnerTrainingCheckpoint,
  prepareClubOwnerTrainingGroup,
  recoverClubOwnerTrainingGroup,
  sanitizeClubOwnerTrainingCheckpoint,
  saveClubOwnerTrainingCheckpoint,
  waitForClubOwnerTrainingGroup,
  type ClubOwnerTrainingCoordinatorApi,
} from '../../src/lib/clubOwnerTrainingCoordinator';
import type {
  ClubOwnerTrainingAuthorization,
  ClubOwnerTrainingCompletionResult,
  ClubOwnerTrainingCredential,
} from '../../src/lib/clubOwnerTrainingHistory';

const gateDropAt = 2_000;
const finishTimes = [4_100, 4_250, 4_450, 4_700];
const request = {
  requestId: 'club-race-session-four',
  clubId: 'club-one',
  sessionId: 'session-four',
  activityType: 'bmx-race' as const,
  armedAt: 1_000,
  assignments: [1, 2, 3, 4].map((playerId) => ({
    studioRiderId: `rider-${playerId}`,
    bikeDeviceId: 100 + playerId,
    playerId: playerId as 1 | 2 | 3 | 4,
  })),
};

function authorization(activePlayers: readonly number[] = []): ClubOwnerTrainingAuthorization {
  const active = new Set(activePlayers);
  return {
    id: 'group-four',
    ...request,
    expiresAt: 901_000,
    state: active.size === 0 ? 'armed' : active.size === 4 ? 'active' : 'partially-active',
    completedAt: null,
    cancelledAt: null,
    createdAt: 900,
    updatedAt: 1_500,
    assignments: request.assignments.map((assignment, index) => ({
      id: `assignment-${index + 1}`,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: String(assignment.bikeDeviceId),
      playerId: assignment.playerId,
      startedAt: active.has(assignment.playerId) ? gateDropAt : null,
      activatedAt: active.has(assignment.playerId) ? gateDropAt + index + 1 : null,
      endedAt: null,
      state: active.has(assignment.playerId) ? 'active' : 'waiting',
    })),
  };
}

function credential(value: ClubOwnerTrainingAuthorization): ClubOwnerTrainingCredential {
  const secured = {
    authorization: value,
    replayed: false as const,
    recovered: false,
  } as ClubOwnerTrainingCredential;
  Object.defineProperty(secured, 'completionToken', { value: 'x'.repeat(48), enumerable: false });
  return secured;
}

function raceCapture(): RaceCapture {
  return {
    version: 1,
    sessionId: request.sessionId,
    createdAt: request.armedAt,
    startedAt: gateDropAt,
    endedAt: 8_000,
    status: 'finished',
    source: 'live',
    track: {
      id: 'track-twelve',
      name: 'Twelve Zone Track',
      country: 'United States',
      state: 'CA',
      lengthMeters: 350,
    },
    sessionMode: 'sprint',
    selectedMetrics: ['cadence', 'speed', 'power', 'reaction'],
    players: request.assignments.map((assignment) => ({
      id: assignment.playerId,
      name: `Private rider ${assignment.playerId}`,
      deviceId: Number(assignment.bikeDeviceId),
      colorName: 'lime',
      riderId: assignment.studioRiderId,
    })),
    zones: [],
    events: [],
    samples: [],
    reactionTimesByPlayer: { 1: 210, 2: 220, 3: 230, 4: 240 },
    summary: request.assignments.map((assignment, index) => ({
      playerId: assignment.playerId,
      riderId: `untrusted-${4 - index}`,
      riderName: `Untrusted ${4 - index}`,
      colorName: 'lime',
      accent: '#65a30d',
      deviceLabel: `Wrong bike ${4 - index}`,
      rank: index + 1,
      finishTimeMs: finishTimes[index],
      thirtyFootTimeMs: 1_000 + index,
      distanceMeters: 350 - index,
      sampleCount: 100 + index,
      topSpeedKph: 50 - index,
      averageSpeedKph: 40 - index,
      topCadence: 180 - index,
      averageCadence: 150 - index,
      topWatts: 1_400 - index,
      averageWatts: 700 - index,
    })),
    zoneResults: Array.from({ length: 12 }, (_, zoneIndex) => ({
      zoneId: `zone-${zoneIndex + 1}`,
      zoneName: `Zone ${zoneIndex + 1}`,
      zoneType: 'pedal' as const,
      startMeter: zoneIndex * 25,
      endMeter: zoneIndex * 25 + 24,
      riders: request.assignments.map((assignment) => ({
        playerId: assignment.playerId,
        sampleCount: 10,
        entryElapsedMs: zoneIndex * 300,
        exitElapsedMs: zoneIndex * 300 + 250,
        durationMs: 250,
        topSpeedKph: 45,
        averageSpeedKph: 40,
        topCadence: 170,
        averageCadence: 150,
        topWatts: 1_200,
        averageWatts: 650,
      })),
    })),
  };
}

function savedResult(session: Parameters<ClubOwnerTrainingCoordinatorApi['complete']>[1]): ClubOwnerTrainingCompletionResult {
  const sessions = request.assignments.map((assignment, index) => ({
    ...session,
    id: `${session.id}:assignment-${index + 1}`,
    startedAt: gateDropAt,
    endedAt: gateDropAt + finishTimes[index],
    durationMs: finishTimes[index],
    club: {
      id: request.clubId,
      name: 'Club One',
      studioRiderId: assignment.studioRiderId,
      riderName: `Athlete ${index + 1}`,
      role: 'athlete' as const,
    },
    createdAt: 8_000,
    updatedAt: 8_000,
  })) satisfies TrainingSession[];
  return {
    authorization: { ...authorization([1, 2, 3, 4]), state: 'completed', completedAt: 8_000 },
    sessions,
    replayed: false,
    persistence: true,
  };
}

function workingApi() {
  let active: number[] = [];
  const api: ClubOwnerTrainingCoordinatorApi = {
    create: vi.fn(async () => credential(authorization())),
    recover: vi.fn(async () => credential(authorization())),
    activate: vi.fn(async (_secured, assignmentId, startedAt) => {
      expect(startedAt).toBe(gateDropAt);
      const playerId = Number(assignmentId.split('-').at(-1));
      if (!active.includes(playerId)) active = [...active, playerId];
      return credential(authorization(active));
    }),
    complete: vi.fn(async (_secured, session) => savedResult(session)),
    cancel: vi.fn(async (secured) => ({
      authorization: {
        ...secured.authorization,
        state: 'cancelled',
        cancelledAt: 3_000,
      },
      cancelled: true,
      replayed: false,
    })),
  };
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('club owner training group coordinator', () => {
  it('locks four exact snapshots, activates all at one gate drop, and atomically keeps all 12 zones scoped', async () => {
    const api = workingApi();
    const entry = armClubOwnerTrainingGroup(request, api);
    expect(JSON.stringify(entry)).not.toContain('completionToken');
    await waitForClubOwnerTrainingGroup(entry);
    await activateClubOwnerTrainingGroup(entry, gateDropAt);

    const session = buildClubOwnerRaceTrainingSession({
      entry,
      capture: raceCapture(),
      title: 'Four-rider BMX race',
      lapCount: 1,
      routeVariantId: 'amateur',
    });
    const completed = await completeClubOwnerTraining(entry, session);

    expect(api.activate).toHaveBeenCalledTimes(4);
    expect((api.activate as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2])).toEqual([
      gateDropAt, gateDropAt, gateDropAt, gateDropAt,
    ]);
    expect(api.complete).toHaveBeenCalledTimes(1);
    const [, sanitized, windows] = (api.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((sanitized.details.zoneResults as unknown[])).toHaveLength(12);
    expect(windows).toEqual(finishTimes.map((finishTimeMs, index) => ({
      assignmentId: `assignment-${index + 1}`,
      status: 'finished',
      endedAt: gateDropAt + finishTimeMs,
    })));
    expect(completed.sessions.map((saved) => saved.club?.studioRiderId)).toEqual([
      'rider-1', 'rider-2', 'rider-3', 'rider-4',
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(/Untrusted|Wrong bike|untrusted-/u);
  });

  it('deduplicates double activation/completion and rejects a second gate clock', async () => {
    const api = workingApi();
    const entry = armClubOwnerTrainingGroup(request, api);
    await Promise.all([
      activateClubOwnerTrainingGroup(entry, gateDropAt),
      activateClubOwnerTrainingGroup(entry, gateDropAt),
    ]);
    await expect(activateClubOwnerTrainingGroup(entry, gateDropAt + 1)).rejects.toThrow('different gate drop');
    const session = buildClubOwnerRaceTrainingSession({
      entry,
      capture: raceCapture(),
      title: 'Four-rider BMX race',
      lapCount: 1,
      routeVariantId: undefined,
    });
    const [first, second] = await Promise.all([
      completeClubOwnerTraining(entry, session),
      completeClubOwnerTraining(entry, session),
    ]);
    expect(first).toBe(second);
    expect(api.activate).toHaveBeenCalledTimes(4);
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it('atomically saves four assigned riders when three finish and one is explicitly DNF', async () => {
    const api = workingApi();
    const entry = armClubOwnerTrainingGroup(request, api);
    await activateClubOwnerTrainingGroup(entry, gateDropAt);
    const capture = raceCapture();
    const dnfCapture: RaceCapture = {
      ...capture,
      summary: capture.summary.map((summary) => (
        summary.playerId === 4 ? { ...summary, finishTimeMs: null } : summary
      )),
    };
    const session = buildClubOwnerRaceTrainingSession({
      entry,
      capture: dnfCapture,
      title: 'Four-rider BMX race',
      lapCount: 1,
      routeVariantId: undefined,
    });

    await completeClubOwnerTraining(entry, session, {
      dnfEndedAtByPlayerId: { 4: { endedAt: dnfCapture.endedAt! } },
    });

    const [, sanitized, windows] = (api.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(windows).toEqual([
      { assignmentId: 'assignment-1', status: 'finished', endedAt: gateDropAt + finishTimes[0] },
      { assignmentId: 'assignment-2', status: 'finished', endedAt: gateDropAt + finishTimes[1] },
      { assignmentId: 'assignment-3', status: 'finished', endedAt: gateDropAt + finishTimes[2] },
      { assignmentId: 'assignment-4', status: 'dnf', endedAt: dnfCapture.endedAt },
    ]);
    const summaries = (sanitized.details.summaries as Array<{ playerId: number; finishTimeMs: number | null }>);
    expect(summaries.map((summary) => [summary.playerId, summary.finishTimeMs])).toEqual([
      [1, finishTimes[0]],
      [2, finishTimes[1]],
      [3, finishTimes[2]],
      [4, null],
    ]);
  });

  it('waits for a pending reservation and cancels it exactly once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const api = workingApi();
    api.create = vi.fn(async () => {
      await gate;
      return credential(authorization());
    });
    const entry = armClubOwnerTrainingGroup(request, api);
    const first = cancelClubOwnerTrainingGroup(entry, { keepalive: true });
    const second = cancelClubOwnerTrainingGroup(entry, { keepalive: true });
    expect(api.cancel).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledWith(expect.anything(), { keepalive: true });
  });

  it('retains the latest safe credential so a partial activation failure can still cancel', async () => {
    const api = workingApi();
    let failed = false;
    const baseActivate = api.activate;
    api.activate = vi.fn(async (secured, assignmentId, startedAt) => {
      if (assignmentId === 'assignment-2' && !failed) {
        failed = true;
        throw new Error('second lane unavailable');
      }
      return baseActivate(secured, assignmentId, startedAt);
    });
    const entry = armClubOwnerTrainingGroup(request, api);
    await expect(activateClubOwnerTrainingGroup(entry, gateDropAt)).rejects.toThrow('second lane unavailable');
    await cancelClubOwnerTrainingGroup(entry);
    expect(api.cancel).toHaveBeenCalledTimes(1);
    const cancelledCredential = (api.cancel as ReturnType<typeof vi.fn>).mock.calls[0][0] as ClubOwnerTrainingCredential;
    expect(cancelledCredential.authorization.assignments.find((assignment) => assignment.playerId === 1)?.state).toBe('active');
  });

  it('persists the full immutable non-secret binding and recovers a rotated credential after reload', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    const api = workingApi();
    const entry = armClubOwnerTrainingGroup(request, api);
    await activateClubOwnerTrainingGroup(entry, gateDropAt);
    const checkpoint = await checkpointClubOwnerTrainingGroup(entry, 2_500);
    const serialized = JSON.stringify({ ...checkpoint, completionToken: 'must-never-survive' });
    const sanitized = sanitizeClubOwnerTrainingCheckpoint(JSON.parse(serialized));
    expect(sanitized).not.toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain('must-never-survive');
    expect(sanitized?.request).toEqual(expect.objectContaining({
      requestId: request.requestId,
      clubId: request.clubId,
      sessionId: request.sessionId,
      armedAt: request.armedAt,
      assignments: request.assignments.map((assignment) => ({
        ...assignment,
        bikeDeviceId: String(assignment.bikeDeviceId),
      })),
    }));
    expect(sanitized?.authorization.assignments.map((assignment) => assignment.id)).toEqual([
      'assignment-1', 'assignment-2', 'assignment-3', 'assignment-4',
    ]);
    expect(saveClubOwnerTrainingCheckpoint('owner-profile', checkpoint)).not.toBeNull();
    const loaded = loadClubOwnerTrainingCheckpoint('owner-profile');
    expect(loaded).not.toBeNull();

    const recoveryApi = workingApi();
    recoveryApi.recover = vi.fn(async () => credential(authorization([1, 2, 3, 4])));
    const restored = recoverClubOwnerTrainingGroup(loaded!, recoveryApi);
    await waitForClubOwnerTrainingGroup(restored);
    expect(recoveryApi.recover).toHaveBeenCalledWith('group-four', loaded!.request);
    expect(recoveryApi.create).not.toHaveBeenCalled();
    await activateClubOwnerTrainingGroup(restored, gateDropAt);
    clearClubOwnerTrainingCheckpoint('owner-profile');
    expect(loadClubOwnerTrainingCheckpoint('owner-profile')).toBeNull();
  });

  it('replays an ambiguous create, recovers its token, and cancels the real reservation', async () => {
    const api = workingApi();
    api.create = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        authorization: authorization(),
        replayed: true,
        recovered: false,
        requiresTokenRecovery: true,
      });
    api.recover = vi.fn(async () => credential(authorization()));
    const entry = armClubOwnerTrainingGroup(request, api);
    await cancelClubOwnerTrainingGroup(entry);
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.recover).toHaveBeenCalledWith('group-four', entry.request);
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not cache a transient cancellation failure', async () => {
    const api = workingApi();
    api.cancel = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        authorization: { ...authorization(), state: 'cancelled', cancelledAt: 3_000 },
        cancelled: true,
        replayed: false,
      });
    const entry = armClubOwnerTrainingGroup(request, api);
    await expect(cancelClubOwnerTrainingGroup(entry)).rejects.toThrow('network unavailable');
    await expect(cancelClubOwnerTrainingGroup(entry)).resolves.toBeUndefined();
    expect(api.cancel).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed preparation cleanup retryable on the same in-memory entry', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('storage unavailable'); },
        removeItem: () => undefined,
      },
    });
    const api = workingApi();
    api.cancel = vi.fn()
      .mockRejectedValueOnce(new Error('cleanup offline'))
      .mockResolvedValueOnce({
        authorization: { ...authorization(), state: 'cancelled', cancelledAt: 3_000 },
        cancelled: true,
        replayed: false,
      });
    let armedEntry: ReturnType<typeof armClubOwnerTrainingGroup> | null = null;

    await expect(prepareClubOwnerTrainingGroup({
      request,
      checkpointScope: 'owner-profile',
      isCurrent: () => true,
      onArm: (entry) => { armedEntry = entry; },
      api,
    })).rejects.toThrow('cleanup offline');

    expect(armedEntry).not.toBeNull();
    await expect(cancelClubOwnerTrainingGroup(armedEntry!)).resolves.toBeUndefined();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledTimes(2);
  });

  it('awaits a pending failed completion before cancelling the activated group', async () => {
    let rejectCompletion!: (error: Error) => void;
    const pendingCompletion = new Promise<ClubOwnerTrainingCompletionResult>((_resolve, reject) => {
      rejectCompletion = reject;
    });
    const api = workingApi();
    api.complete = vi.fn(() => pendingCompletion);
    const entry = armClubOwnerTrainingGroup(request, api);
    await activateClubOwnerTrainingGroup(entry, gateDropAt);
    const session = buildClubOwnerRaceTrainingSession({
      entry,
      capture: raceCapture(),
      title: 'Four-rider BMX race',
      lapCount: 1,
      routeVariantId: undefined,
    });
    const completion = completeClubOwnerTraining(entry, session);
    const cancellation = cancelClubOwnerTrainingGroup(entry);
    expect(api.cancel).not.toHaveBeenCalled();
    rejectCompletion(new Error('completion response lost'));
    await expect(completion).rejects.toThrow('completion response lost');
    await expect(cancellation).resolves.toBeUndefined();
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });
});
