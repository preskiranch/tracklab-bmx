import type {
  ExploreRideAuthorizationReferences,
  ExploreRideCompleteEvent,
  ExploreRideStudioBinding,
  PlayerSlot,
  RaceCapture,
} from '../types';
import type { GetPulledResult } from './getPulled';
import type { ClubOwnerActiveClockSegment } from './clubOwnerTrainingResults';
import type { TrainingSessionInput } from './trainingHistory';
import {
  activateClubOwnerTrainingAssignment,
  cancelClubOwnerTrainingAuthorization,
  completeClubOwnerTrainingGroup,
  createClubOwnerTrainingAuthorization,
  recoverClubOwnerTrainingCompletionToken,
  type ClubOwnerTrainingAuthorization,
  type ClubOwnerTrainingAuthorizationRequest,
  type ClubOwnerTrainingCancellationResult,
  type ClubOwnerTrainingCompletionResult,
  type ClubOwnerTrainingCreateResult,
  type ClubOwnerTrainingCredential,
} from './clubOwnerTrainingHistory';
import { buildClubOwnerTrainingResults } from './clubOwnerTrainingResults';

export type ClubOwnerTrainingRiderSnapshot = Readonly<{
  studioRiderId: string;
  bikeDeviceId: number;
  playerId: PlayerSlot['id'];
}>;

export type ClubOwnerTrainingCoordinatorEntry = Readonly<{
  request: ClubOwnerTrainingAuthorizationRequest;
  riders: readonly ClubOwnerTrainingRiderSnapshot[];
}>;

export type ClubOwnerTrainingCompletionOptions = Readonly<{
  dnfEndedAtByPlayerId?: Readonly<Partial<Record<PlayerSlot['id'], Readonly<{ endedAt: number }>>>>;
  exploreActiveClockSegmentsByPlayerId?: Readonly<Partial<Record<
    PlayerSlot['id'],
    readonly ClubOwnerActiveClockSegment[]
  >>>;
}>;

export type ClubOwnerTrainingCoordinatorApi = Readonly<{
  create: (request: ClubOwnerTrainingAuthorizationRequest) => Promise<ClubOwnerTrainingCreateResult>;
  recover: (
    authorizationId: string,
    request: ClubOwnerTrainingAuthorizationRequest,
  ) => Promise<ClubOwnerTrainingCredential>;
  activate: (
    credential: ClubOwnerTrainingCredential,
    assignmentId: string,
    startedAt: number,
  ) => Promise<ClubOwnerTrainingCredential>;
  complete: (
    credential: ClubOwnerTrainingCredential,
    session: TrainingSessionInput,
    riderWindows: ReturnType<typeof buildClubOwnerTrainingResults>['riderWindows'],
  ) => Promise<ClubOwnerTrainingCompletionResult>;
  cancel: (
    credential: ClubOwnerTrainingCredential,
    options?: { keepalive?: boolean },
  ) => Promise<ClubOwnerTrainingCancellationResult>;
}>;

type CoordinatorRuntime = {
  api: ClubOwnerTrainingCoordinatorApi;
  credential: Promise<ClubOwnerTrainingCredential>;
  activation: Promise<ClubOwnerTrainingCredential> | null;
  activatedAt: number | null;
  completion: Promise<ClubOwnerTrainingCompletionResult> | null;
  cancellation: Promise<void> | null;
  cancelled: boolean;
  completed: boolean;
  latestCredential: ClubOwnerTrainingCredential | null;
};

const defaultApi: ClubOwnerTrainingCoordinatorApi = {
  create: createClubOwnerTrainingAuthorization,
  recover: recoverClubOwnerTrainingCompletionToken,
  activate: activateClubOwnerTrainingAssignment,
  complete: completeClubOwnerTrainingGroup,
  cancel: cancelClubOwnerTrainingAuthorization,
};

// Credentials intentionally live only behind the entry held by the App ref.
// They cannot be enumerated, serialized into React state, or copied into logs.
const runtimes = new WeakMap<ClubOwnerTrainingCoordinatorEntry, CoordinatorRuntime>();
const continuations = new WeakMap<ClubOwnerTrainingCoordinatorEntry, {
  promise: Promise<boolean>;
  resolve: (accepted: boolean) => void;
  settled: boolean;
}>();
const checkpointStoragePrefix = 'tracklab-club-owner-training-v1';

export type ClubOwnerTrainingCheckpoint = Readonly<{
  version: 1;
  savedAt: number;
  request: ClubOwnerTrainingAuthorizationRequest;
  authorization: ClubOwnerTrainingAuthorization;
}>;

function validTimestamp(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}

function validIdentifier(value: unknown, maximum = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0
    && text.length <= maximum
    && /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(text)
    ? text
    : '';
}

function checkpointStorageKey(scope: string) {
  return `${checkpointStoragePrefix}:${encodeURIComponent(scope.trim())}`;
}

function copyAuthorization(authorization: ClubOwnerTrainingAuthorization): ClubOwnerTrainingAuthorization {
  return Object.freeze({
    id: authorization.id,
    clubId: authorization.clubId,
    requestId: authorization.requestId,
    sessionId: authorization.sessionId,
    activityType: authorization.activityType,
    armedAt: authorization.armedAt,
    expiresAt: authorization.expiresAt,
    state: authorization.state,
    completedAt: authorization.completedAt,
    cancelledAt: authorization.cancelledAt,
    createdAt: authorization.createdAt,
    updatedAt: authorization.updatedAt,
    assignments: Object.freeze(authorization.assignments.map((assignment) => Object.freeze({
      id: assignment.id,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: assignment.bikeDeviceId,
      playerId: assignment.playerId,
      startedAt: assignment.startedAt,
      activatedAt: assignment.activatedAt,
      endedAt: assignment.endedAt,
      state: assignment.state,
    }))),
  });
}

function sanitizeCheckpointRequest(value: unknown): ClubOwnerTrainingAuthorizationRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<ClubOwnerTrainingAuthorizationRequest>;
  const activityType = raw.activityType;
  if (
    !validIdentifier(raw.requestId)
    || !validIdentifier(raw.clubId)
    || !validIdentifier(raw.sessionId)
    || !['bmx-race', 'straight-sprint', 'get-pulled', 'explore'].includes(String(activityType))
    || !Number.isSafeInteger(raw.armedAt)
    || Number(raw.armedAt) < 0
    || !Array.isArray(raw.assignments)
    || raw.assignments.length < 1
    || raw.assignments.length > 4
  ) return null;
  const riders = new Set<string>();
  const bikes = new Set<string>();
  const players = new Set<number>();
  const assignments = raw.assignments.flatMap((rawAssignment) => {
    const assignment = rawAssignment as Partial<ClubOwnerTrainingAuthorizationRequest['assignments'][number]>;
    const studioRiderId = validIdentifier(assignment?.studioRiderId);
    const bikeDeviceId = String(assignment?.bikeDeviceId ?? '').trim();
    const playerId = Number(assignment?.playerId) as PlayerSlot['id'];
    if (
      !studioRiderId
      || !/^\d{1,16}$/u.test(bikeDeviceId)
      || ![1, 2, 3, 4].includes(playerId)
      || riders.has(studioRiderId)
      || bikes.has(bikeDeviceId)
      || players.has(playerId)
    ) return [];
    riders.add(studioRiderId);
    bikes.add(bikeDeviceId);
    players.add(playerId);
    return [{ studioRiderId, bikeDeviceId, playerId }];
  });
  if (assignments.length !== raw.assignments.length) return null;
  return freezeRequest({
    requestId: validIdentifier(raw.requestId),
    clubId: validIdentifier(raw.clubId),
    sessionId: validIdentifier(raw.sessionId),
    activityType: activityType as ClubOwnerTrainingAuthorizationRequest['activityType'],
    armedAt: Number(raw.armedAt),
    assignments,
  });
}

function sanitizeCheckpointAuthorization(
  value: unknown,
  request: ClubOwnerTrainingAuthorizationRequest,
): ClubOwnerTrainingAuthorization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<ClubOwnerTrainingAuthorization>;
  if (
    !validIdentifier(raw.id, 180)
    || raw.clubId !== request.clubId
    || raw.requestId !== request.requestId
    || raw.sessionId !== request.sessionId
    || raw.activityType !== request.activityType
    || raw.armedAt !== request.armedAt
    || !Number.isSafeInteger(raw.expiresAt)
    || !Number.isSafeInteger(raw.createdAt)
    || !Number.isSafeInteger(raw.updatedAt)
    || !['armed', 'partially-active', 'active', 'completed', 'cancelled', 'expired'].includes(String(raw.state))
    || !Array.isArray(raw.assignments)
    || raw.assignments.length !== request.assignments.length
  ) return null;
  const expected = new Map(request.assignments.map((assignment) => [assignment.playerId, assignment]));
  const ids = new Set<string>();
  const assignments = raw.assignments.flatMap((rawAssignment) => {
    const assignment = rawAssignment as ClubOwnerTrainingAuthorization['assignments'][number];
    const match = expected.get(Number(assignment?.playerId) as PlayerSlot['id']);
    const id = validIdentifier(assignment?.id, 180);
    const startedAt = assignment?.startedAt == null ? null : Number(assignment.startedAt);
    const activatedAt = assignment?.activatedAt == null ? null : Number(assignment.activatedAt);
    const endedAt = assignment?.endedAt == null ? null : Number(assignment.endedAt);
    if (
      !match
      || !id
      || ids.has(id)
      || assignment.studioRiderId !== match.studioRiderId
      || assignment.bikeDeviceId !== String(match.bikeDeviceId)
      || !['waiting', 'active', 'completed', 'cancelled', 'expired'].includes(String(assignment.state))
      || (startedAt != null && (!Number.isSafeInteger(startedAt) || startedAt < request.armedAt))
      || (activatedAt != null && (!Number.isSafeInteger(activatedAt) || startedAt == null || activatedAt < startedAt))
      || (endedAt != null && (!Number.isSafeInteger(endedAt) || startedAt == null || endedAt < startedAt))
      || ((startedAt == null) !== (activatedAt == null))
    ) return [];
    ids.add(id);
    return [Object.freeze({
      id,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: assignment.bikeDeviceId,
      playerId: assignment.playerId,
      startedAt,
      activatedAt,
      endedAt,
      state: assignment.state,
    })];
  });
  if (assignments.length !== raw.assignments.length) return null;
  const completedAt = raw.completedAt == null ? null : Number(raw.completedAt);
  const cancelledAt = raw.cancelledAt == null ? null : Number(raw.cancelledAt);
  if (
    (completedAt != null && !Number.isSafeInteger(completedAt))
    || (cancelledAt != null && !Number.isSafeInteger(cancelledAt))
  ) return null;
  return copyAuthorization({
    id: validIdentifier(raw.id, 180),
    clubId: request.clubId,
    requestId: request.requestId,
    sessionId: request.sessionId,
    activityType: request.activityType,
    armedAt: request.armedAt,
    expiresAt: Number(raw.expiresAt),
    state: raw.state!,
    completedAt,
    cancelledAt,
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
    assignments,
  });
}

export function sanitizeClubOwnerTrainingCheckpoint(value: unknown): ClubOwnerTrainingCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<ClubOwnerTrainingCheckpoint>;
  const request = sanitizeCheckpointRequest(raw.request);
  const savedAt = Number(raw.savedAt);
  if (raw.version !== 1 || !request || !Number.isSafeInteger(savedAt) || savedAt < 0) return null;
  const authorization = sanitizeCheckpointAuthorization(raw.authorization, request);
  if (!authorization || ['completed', 'cancelled', 'expired'].includes(authorization.state)) return null;
  return Object.freeze({ version: 1, savedAt, request, authorization });
}

function freezeRequest(request: ClubOwnerTrainingAuthorizationRequest) {
  const assignments = Object.freeze(request.assignments.map((assignment) => Object.freeze({
    studioRiderId: assignment.studioRiderId,
    bikeDeviceId: String(assignment.bikeDeviceId),
    playerId: assignment.playerId,
  })));
  return Object.freeze({ ...request, assignments });
}

function runtimeFor(entry: ClubOwnerTrainingCoordinatorEntry) {
  const runtime = runtimes.get(entry);
  if (!runtime) throw new Error('This club training preparation is no longer available.');
  return runtime;
}

function assignmentForSnapshot(
  authorization: ClubOwnerTrainingAuthorization,
  rider: ClubOwnerTrainingRiderSnapshot,
) {
  const assignment = authorization.assignments.find((candidate) => (
    candidate.studioRiderId === rider.studioRiderId
    && candidate.bikeDeviceId === String(rider.bikeDeviceId)
    && candidate.playerId === rider.playerId
  ));
  if (!assignment) throw new Error(`Player ${rider.playerId} no longer matches the reserved athlete and Wattbike.`);
  return assignment;
}

/**
 * Starts one idempotent group reservation immediately. The returned entry is
 * safe to keep in a React ref; its one-use completion credential is private to
 * this module's WeakMap runtime.
 */
export function armClubOwnerTrainingGroup(
  requestInput: ClubOwnerTrainingAuthorizationRequest,
  api: ClubOwnerTrainingCoordinatorApi = defaultApi,
): ClubOwnerTrainingCoordinatorEntry {
  const request = freezeRequest(requestInput);
  const riders = Object.freeze(request.assignments.map((assignment) => Object.freeze({
    studioRiderId: assignment.studioRiderId,
    bikeDeviceId: Number(assignment.bikeDeviceId),
    playerId: assignment.playerId,
  })));
  const entry = Object.freeze({ request, riders });
  let runtime!: CoordinatorRuntime;
  const credential = api.create(request).then((created) => (
    created.replayed
      ? api.recover(created.authorization.id, request)
      : created
  )).then((secured) => {
    runtime.latestCredential = secured;
    return secured;
  });
  runtime = {
    api,
    credential,
    activation: null,
    activatedAt: null,
    completion: null,
    cancellation: null,
    cancelled: false,
    completed: false,
    latestCredential: null,
  };
  runtimes.set(entry, runtime);
  return entry;
}

export async function prepareClubOwnerTrainingGroup(input: Readonly<{
  request: ClubOwnerTrainingAuthorizationRequest;
  checkpointScope: string;
  isCurrent: () => boolean;
  onArm: (entry: ClubOwnerTrainingCoordinatorEntry) => void;
  api?: ClubOwnerTrainingCoordinatorApi;
}>): Promise<ClubOwnerTrainingCoordinatorEntry | null> {
  if (!input.isCurrent()) return null;
  const entry = armClubOwnerTrainingGroup(input.request, input.api ?? defaultApi);
  input.onArm(entry);
  try {
    if (!input.isCurrent()) {
      await cancelClubOwnerTrainingGroup(entry, { keepalive: true });
      return null;
    }
    await waitForClubOwnerTrainingGroup(entry);
    if (!input.isCurrent()) {
      await cancelClubOwnerTrainingGroup(entry, { keepalive: true });
      return null;
    }
    const checkpoint = await checkpointClubOwnerTrainingGroup(entry);
    if (!saveClubOwnerTrainingCheckpoint(input.checkpointScope, checkpoint)) {
      throw new Error('TrackLab could not safely checkpoint this club preparation. Free device storage and retry.');
    }
    return entry;
  } catch (error) {
    await cancelClubOwnerTrainingGroup(entry, { keepalive: true });
    clearClubOwnerTrainingCheckpoint(input.checkpointScope);
    throw error;
  }
}

export async function waitForClubOwnerTrainingGroup(
  entry: ClubOwnerTrainingCoordinatorEntry,
): Promise<ClubOwnerTrainingAuthorization> {
  return (await runtimeFor(entry).credential).authorization;
}

/** Holds a mode at its prepared screen until the owner explicitly continues or cancels. */
export function waitForClubOwnerTrainingContinuation(entry: ClubOwnerTrainingCoordinatorEntry) {
  const existing = continuations.get(entry);
  if (existing) return existing.promise;
  let resolvePromise!: (accepted: boolean) => void;
  const state = {
    promise: new Promise<boolean>((resolve) => { resolvePromise = resolve; }),
    resolve: (accepted: boolean) => {
      if (state.settled) return;
      state.settled = true;
      resolvePromise(accepted);
    },
    settled: false,
  };
  continuations.set(entry, state);
  return state.promise;
}

export function resolveClubOwnerTrainingContinuation(
  entry: ClubOwnerTrainingCoordinatorEntry,
  accepted: boolean,
) {
  const state = continuations.get(entry);
  if (!state) return false;
  state.resolve(accepted);
  return true;
}

export async function checkpointClubOwnerTrainingGroup(
  entry: ClubOwnerTrainingCoordinatorEntry,
  savedAt = Date.now(),
): Promise<ClubOwnerTrainingCheckpoint> {
  const runtime = runtimeFor(entry);
  const credential = runtime.latestCredential ?? await runtime.credential;
  return Object.freeze({
    version: 1,
    savedAt: validTimestamp(savedAt, 'The club training checkpoint time'),
    request: entry.request,
    authorization: copyAuthorization(credential.authorization),
  });
}

export function saveClubOwnerTrainingCheckpoint(scope: string, checkpoint: ClubOwnerTrainingCheckpoint) {
  const normalizedScope = scope.trim();
  const sanitized = sanitizeClubOwnerTrainingCheckpoint(checkpoint);
  if (!normalizedScope || !sanitized || typeof window === 'undefined') return null;
  try {
    window.localStorage.setItem(checkpointStorageKey(normalizedScope), JSON.stringify(sanitized));
  } catch {
    return null;
  }
  return sanitized;
}

export function loadClubOwnerTrainingCheckpoint(scope: string) {
  const normalizedScope = scope.trim();
  if (!normalizedScope || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(checkpointStorageKey(normalizedScope));
    return value ? sanitizeClubOwnerTrainingCheckpoint(JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

export function clearClubOwnerTrainingCheckpoint(scope: string) {
  const normalizedScope = scope.trim();
  if (!normalizedScope || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(checkpointStorageKey(normalizedScope));
  } catch {
    // Server cancellation remains authoritative when local storage is blocked.
  }
}

export function recoverClubOwnerTrainingGroup(
  checkpointInput: ClubOwnerTrainingCheckpoint,
  api: ClubOwnerTrainingCoordinatorApi = defaultApi,
): ClubOwnerTrainingCoordinatorEntry {
  const checkpoint = sanitizeClubOwnerTrainingCheckpoint(checkpointInput);
  if (!checkpoint) throw new Error('The saved club training preparation is invalid or terminal.');
  const request = checkpoint.request;
  const riders = Object.freeze(request.assignments.map((assignment) => Object.freeze({
    studioRiderId: assignment.studioRiderId,
    bikeDeviceId: Number(assignment.bikeDeviceId),
    playerId: assignment.playerId,
  })));
  const entry = Object.freeze({ request, riders });
  let runtime!: CoordinatorRuntime;
  const credential = api.recover(checkpoint.authorization.id, request).then((secured) => {
    const previousIds = new Map(checkpoint.authorization.assignments.map((assignment) => (
      [assignment.playerId, assignment.id]
    )));
    if (secured.authorization.assignments.some((assignment) => (
      previousIds.get(assignment.playerId) !== assignment.id
    ))) {
      throw new Error('Recovered club assignments did not match the saved immutable IDs.');
    }
    runtime.latestCredential = secured;
    return secured;
  });
  runtime = {
    api,
    credential,
    activation: null,
    activatedAt: checkpoint.authorization.assignments.find((assignment) => assignment.startedAt != null)?.startedAt ?? null,
    completion: null,
    cancellation: null,
    cancelled: false,
    completed: false,
    latestCredential: null,
  };
  runtimes.set(entry, runtime);
  return entry;
}

export async function recoverClubOwnerRaceCheckpoint(input: Readonly<{
  scope: string;
  clubId: string;
  capture: RaceCapture | null;
  api?: ClubOwnerTrainingCoordinatorApi;
}>): Promise<Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  playerIds: readonly PlayerSlot['id'][];
}> | null> {
  const checkpoint = loadClubOwnerTrainingCheckpoint(input.scope);
  if (!checkpoint || !['bmx-race', 'straight-sprint'].includes(checkpoint.request.activityType)) return null;
  if (checkpoint.request.clubId !== input.clubId) return null;
  const entry = recoverClubOwnerTrainingGroup(checkpoint, input.api ?? defaultApi);
  await waitForClubOwnerTrainingGroup(entry);
  if (input.capture?.status !== 'finished' || input.capture.sessionId !== checkpoint.request.sessionId) {
    await cancelClubOwnerTrainingGroup(entry, { keepalive: true });
    clearClubOwnerTrainingCheckpoint(input.scope);
    return null;
  }
  return Object.freeze({ entry, playerIds: clubOwnerTrainingGroupPlayerIds(entry) });
}

/** Activates every locked assignment at one authoritative gate-drop clock. */
export function activateClubOwnerTrainingGroup(
  entry: ClubOwnerTrainingCoordinatorEntry,
  gateDropAt: number,
): Promise<ClubOwnerTrainingAuthorization> {
  const runtime = runtimeFor(entry);
  const startedAt = validTimestamp(gateDropAt, 'The authoritative gate-drop time');
  if (runtime.cancellation) return Promise.reject(new Error('This club training preparation is being cancelled.'));
  if (runtime.activation) {
    if (runtime.activatedAt !== startedAt) {
      return Promise.reject(new Error('This club training group is already bound to a different gate drop.'));
    }
    return runtime.activation.then((credential) => credential.authorization);
  }
  if (runtime.activatedAt != null && runtime.activatedAt !== startedAt) {
    return Promise.reject(new Error('This club training group is already bound to a different gate drop.'));
  }
  runtime.activatedAt = startedAt;
  const activation = runtime.credential.then(async (initial) => {
    let credential = initial;
    for (const rider of entry.riders) {
      const assignment = assignmentForSnapshot(credential.authorization, rider);
      credential = await runtime.api.activate(credential, assignment.id, startedAt);
      runtime.latestCredential = credential;
    }
    return credential;
  });
  runtime.activation = activation.catch((error) => {
    runtime.activation = null;
    if (runtime.latestCredential) runtime.credential = Promise.resolve(runtime.latestCredential);
    throw error;
  });
  runtime.credential = runtime.activation;
  return runtime.activation.then((credential) => credential.authorization);
}

export async function activateAndCheckpointClubOwnerTrainingGroup(
  entry: ClubOwnerTrainingCoordinatorEntry,
  startedAt: number,
  checkpointScope: string | null,
) {
  const authorization = await activateClubOwnerTrainingGroup(entry, startedAt);
  if (checkpointScope) {
    const checkpoint = await checkpointClubOwnerTrainingGroup(entry);
    if (!saveClubOwnerTrainingCheckpoint(checkpointScope, checkpoint)) {
      throw new Error('TrackLab could not checkpoint the activated club race.');
    }
  }
  return authorization;
}

/**
 * Completes once, atomically. The shared result is sanitized and its exact
 * rider-specific finish clocks are derived before the one server write.
 */
export function completeClubOwnerTraining(
  entry: ClubOwnerTrainingCoordinatorEntry,
  session: TrainingSessionInput,
  options: ClubOwnerTrainingCompletionOptions = {},
): Promise<ClubOwnerTrainingCompletionResult> {
  const runtime = runtimeFor(entry);
  if (runtime.completion) return runtime.completion;
  if (!runtime.activation) {
    return Promise.reject(new Error('The club training group did not reach its authoritative start.'));
  }
  if (runtime.cancellation) return Promise.reject(new Error('This club training preparation is being cancelled.'));
  const completion = runtime.activation.then((credential) => {
    const dnfByAssignmentId = Object.fromEntries(Object.entries(options.dnfEndedAtByPlayerId ?? {}).map(([
      rawPlayerId,
      outcome,
    ]) => {
      const playerId = Number(rawPlayerId) as PlayerSlot['id'];
      const rider = entry.riders.find((candidate) => candidate.playerId === playerId);
      if (!rider || !outcome) throw new Error(`Player ${rawPlayerId} is not part of this club training group.`);
      const assignment = assignmentForSnapshot(credential.authorization, rider);
      return [assignment.id, { endedAt: validTimestamp(outcome.endedAt, `Player ${playerId} DNF clock`) }];
    }));
    const exploreActiveClockSegmentsByAssignmentId = Object.fromEntries(Object.entries(
      options.exploreActiveClockSegmentsByPlayerId ?? {},
    ).map(([rawPlayerId, segments]) => {
      const playerId = Number(rawPlayerId) as PlayerSlot['id'];
      const rider = entry.riders.find((candidate) => candidate.playerId === playerId);
      if (!rider || !segments) throw new Error(`Player ${rawPlayerId} is not part of this club training group.`);
      const assignment = assignmentForSnapshot(credential.authorization, rider);
      return [assignment.id, segments];
    }));
    const build = buildClubOwnerTrainingResults(credential.authorization, session, {
      ...(Object.keys(dnfByAssignmentId).length > 0 ? { dnfByAssignmentId } : {}),
      ...(Object.keys(exploreActiveClockSegmentsByAssignmentId).length > 0
        ? { exploreActiveClockSegmentsByAssignmentId }
        : {}),
    });
    return runtime.api.complete(credential, build.session, build.riderWindows);
  }).then((result) => {
    runtime.completed = true;
    return result;
  });
  runtime.completion = completion.catch((error) => {
    runtime.completion = null;
    throw error;
  });
  return runtime.completion;
}

/** Waits for any pending reserve/activation, then performs one idempotent cancel. */
export function cancelClubOwnerTrainingGroup(
  entry: ClubOwnerTrainingCoordinatorEntry,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const runtime = runtimeFor(entry);
  resolveClubOwnerTrainingContinuation(entry, false);
  if (runtime.completed || runtime.cancelled) return Promise.resolve();
  if (runtime.cancellation) return runtime.cancellation;
  const cancellation = (async () => {
    const pendingCompletion = runtime.completion;
    if (pendingCompletion) {
      try {
        await pendingCompletion;
        return;
      } catch {
        // A failed completion still owns live rider/bike reservations and must
        // fall through to an authenticated cancellation.
      }
    }
    let credential: ClubOwnerTrainingCredential | null = null;
    try {
      credential = await (runtime.activation ?? runtime.credential);
    } catch {
      credential = runtime.latestCredential;
      if (!credential) {
        // A transport failure can occur after the server committed create but
        // before its response arrived. Replay the same request, then recover
        // the rotated credential so the reserved seats cannot be orphaned.
        const replay = await runtime.api.create(entry.request);
        credential = replay.replayed
          ? await runtime.api.recover(replay.authorization.id, entry.request)
          : replay;
        runtime.latestCredential = credential;
        runtime.credential = Promise.resolve(credential);
      }
    }
    await runtime.api.cancel(credential, options);
    runtime.cancelled = true;
  })();
  runtime.cancellation = cancellation.catch((error) => {
    runtime.cancellation = null;
    throw error;
  });
  return runtime.cancellation;
}

export function clubOwnerTrainingGroupPlayerIds(entry: ClubOwnerTrainingCoordinatorEntry) {
  return entry.riders.map((rider) => rider.playerId);
}

export function clubOwnerTrainingGroupMatches(
  entry: ClubOwnerTrainingCoordinatorEntry,
  input: Pick<ClubOwnerTrainingAuthorizationRequest, 'clubId' | 'sessionId' | 'activityType' | 'assignments'>,
) {
  if (
    entry.request.clubId !== input.clubId
    || entry.request.sessionId !== input.sessionId
    || entry.request.activityType !== input.activityType
    || entry.riders.length !== input.assignments.length
  ) return false;
  const expected = new Map(input.assignments.map((assignment) => [assignment.playerId, assignment]));
  return entry.riders.every((rider) => {
    const match = expected.get(rider.playerId);
    return match?.studioRiderId === rider.studioRiderId
      && String(match.bikeDeviceId) === String(rider.bikeDeviceId);
  });
}

export function buildClubOwnerRaceTrainingSession(input: Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  capture: RaceCapture;
  title: string;
  lapCount: number;
  routeVariantId: string | undefined;
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
}>): TrainingSessionInput {
  const { entry, capture } = input;
  if (capture.sessionId !== entry.request.sessionId || capture.status !== 'finished') {
    throw new Error('The finished race capture does not match its club preparation.');
  }
  const startedAt = capture.startedAt;
  const endedAt = capture.endedAt;
  if (startedAt == null || endedAt == null || endedAt < startedAt || capture.summary.length === 0) {
    throw new Error('The club race needs a complete gate-to-finish capture.');
  }
  return {
    id: entry.request.sessionId,
    activityType: entry.request.activityType,
    title: input.title,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    distanceMeters: Math.max(0, ...capture.summary.map((summary) => summary.distanceMeters)),
    trackId: capture.track.id,
    trackName: capture.track.name,
    source: 'live',
    details: {
      summaries: capture.summary,
      zoneResults: capture.zoneResults ?? [],
      reactionTimesByPlayer: capture.reactionTimesByPlayer,
      selectedMetrics: capture.selectedMetrics,
      lapCount: input.lapCount,
      ...(input.routeVariantId ? { routeVariantId: input.routeVariantId } : {}),
      ...(input.sprintDistanceFeet != null && input.sprintAirSetting != null ? {
        sprintDistanceFeet: input.sprintDistanceFeet,
        sprintAirSetting: input.sprintAirSetting,
      } : {}),
    },
  };
}

/** Builds and commits one finished Race/Sprint capture using exact finish/DNF clocks. */
export async function completeClubOwnerRaceCapture(input: Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  capture: RaceCapture;
  title: string;
  lapCount: number;
  routeVariantId: string | undefined;
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
}>) {
  const { entry, capture } = input;
  if (capture.startedAt == null) throw new Error('The club race has no authoritative gate-drop time.');
  await activateClubOwnerTrainingGroup(entry, capture.startedAt);
  const session = buildClubOwnerRaceTrainingSession(input);
  const dnfEndedAtByPlayerId = Object.fromEntries(entry.riders.flatMap((rider) => {
    const summary = capture.summary.find((candidate) => candidate.playerId === rider.playerId);
    return summary?.finishTimeMs == null && capture.endedAt != null
      ? [[rider.playerId, { endedAt: capture.endedAt }]]
      : [];
  }));
  return completeClubOwnerTraining(entry, session, { dnfEndedAtByPlayerId });
}

export async function clubOwnerExploreAuthorizationReferences(
  entry: ClubOwnerTrainingCoordinatorEntry,
): Promise<ExploreRideAuthorizationReferences> {
  const checkpoint = await checkpointClubOwnerTrainingGroup(entry);
  return Object.freeze({
    authorizationGroupId: checkpoint.authorization.id,
    riders: Object.freeze(checkpoint.authorization.assignments.map((assignment) => Object.freeze({
      playerId: assignment.playerId,
      authorizationId: assignment.id,
    }))),
    authorizationCheckpoint: checkpoint,
  });
}

export async function recoverClubOwnerExploreBinding(
  binding: ExploreRideStudioBinding,
  api: ClubOwnerTrainingCoordinatorApi = defaultApi,
) {
  const checkpoint = binding.authorizationCheckpoint;
  if (!checkpoint || binding.authorizationGroupId !== checkpoint.authorization.id) {
    throw new Error('This Explore checkpoint has no recoverable club authorization.');
  }
  const entry = recoverClubOwnerTrainingGroup(checkpoint, api);
  const authorization = await waitForClubOwnerTrainingGroup(entry);
  const references = new Map(binding.riders.flatMap((rider) => (
    rider.authorizationId ? [[rider.playerId, rider.authorizationId] as const] : []
  )));
  if (authorization.assignments.some((assignment) => references.get(assignment.playerId) !== assignment.id)) {
    throw new Error('Recovered Explore assignments do not match the saved rider references.');
  }
  return entry;
}

export async function completeClubOwnerGetPulledResult(
  entry: ClubOwnerTrainingCoordinatorEntry,
  result: GetPulledResult,
) {
  if (entry.request.activityType !== 'get-pulled' || result.id !== entry.request.sessionId) {
    throw new Error('The Get Pulled result does not match its club preparation.');
  }
  const rider = entry.riders[0];
  if (!rider || entry.riders.length !== 1 || result.playerId !== rider.playerId) {
    throw new Error('The Get Pulled athlete does not match the reserved rider and bike.');
  }
  await activateClubOwnerTrainingGroup(entry, result.startedAt);
  const session: TrainingSessionInput = {
    id: result.id,
    activityType: 'get-pulled',
    title: `${result.durationSeconds}s Get Pulled · Air ${result.airSetting}`,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.endedAt - result.startedAt,
    distanceMeters: result.distanceMeters,
    trackId: 'preski-ranch-pull-lane',
    trackName: 'Preski Ranch Pull Lane',
    source: 'live',
    details: {
      durationSeconds: result.durationSeconds,
      airSetting: result.airSetting,
      riders: [{
        playerId: result.playerId,
        distanceMeters: result.distanceMeters,
        averageWatts: result.averageWatts,
        peakWatts: result.peakWatts,
        averageCadence: result.averageCadence,
        peakCadence: result.peakCadence,
        averageSpeedKph: result.averageSpeedKph,
        peakSpeedKph: result.peakSpeedKph,
      }],
    },
  };
  return completeClubOwnerTraining(entry, session);
}

function exploreSegmentsThrough(
  segments: ExploreRideCompleteEvent['activeClockSegments'],
  stoppedAt: number,
  fallbackEndedAt: number,
) {
  return segments.flatMap((segment) => {
    if (segment.startedAt >= stoppedAt) return [];
    const endedAt = Math.min(segment.endedAt ?? fallbackEndedAt, stoppedAt);
    return endedAt > segment.startedAt ? [{ ...segment, endedAt }] : [];
  });
}

export async function completeClubOwnerExploreRide(
  entry: ClubOwnerTrainingCoordinatorEntry,
  result: ExploreRideCompleteEvent,
) {
  if (entry.request.activityType !== 'explore' || result.sessionId !== entry.request.sessionId) {
    throw new Error('The Explore result does not match its club preparation.');
  }
  const riders = entry.riders.map((reserved) => {
    const rider = result.riders.find((candidate) => candidate.playerId === reserved.playerId);
    if (!rider || rider.riderId !== reserved.studioRiderId) {
      throw new Error(`Player ${reserved.playerId} no longer matches the reserved Explore athlete.`);
    }
    return rider;
  });
  await activateClubOwnerTrainingGroup(entry, result.startedAt);
  const segmentsByPlayerId = Object.fromEntries(riders.map((rider) => [
    rider.playerId,
    exploreSegmentsThrough(result.activeClockSegments, rider.finishedAt ?? result.endedAt, result.endedAt),
  ]));
  const session: TrainingSessionInput = {
    id: result.sessionId,
    activityType: 'explore',
    title: result.route.name || `${result.route.originLabel} to ${result.route.destinationLabel}`,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    distanceMeters: Math.max(0, ...riders.map((rider) => rider.distanceMeters)),
    trackId: result.route.id,
    trackName: result.route.name || result.route.destinationLabel,
    source: 'live',
    details: {
      originLabel: result.route.originLabel,
      destinationLabel: result.route.destinationLabel,
      travelMode: result.route.travelMode,
      elevationGainMeters: result.route.elevationGainMeters ?? 0,
      elevationLossMeters: result.route.elevationLossMeters ?? 0,
      riders: riders.map((rider) => {
        const activeDurationMs = (segmentsByPlayerId[rider.playerId] ?? [])
          .reduce((total, segment) => total + Math.max(0, segment.endedAt - segment.startedAt), 0);
        return {
          playerId: rider.playerId,
          distanceMeters: rider.distanceMeters,
          averageSpeedMph: (rider.distanceMeters / 1609.344) / (Math.max(1, activeDurationMs) / 3_600_000),
        };
      }),
    },
  };
  const exploreActiveClockSegmentsByPlayerId = segmentsByPlayerId;
  const dnfEndedAtByPlayerId = Object.fromEntries(riders.flatMap((rider) => (
    rider.finishedAt == null
      ? [[rider.playerId, {
        endedAt: segmentsByPlayerId[rider.playerId]?.at(-1)?.endedAt ?? result.endedAt,
      }]]
      : []
  )));
  return completeClubOwnerTraining(entry, session, {
    exploreActiveClockSegmentsByPlayerId,
    dnfEndedAtByPlayerId,
  });
}

export async function saveClubOwnerRaceGroupFlow(input: Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  capture: RaceCapture;
  title: string;
  lapCount: number;
  routeVariantId: string | undefined;
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
  checkpointScope: string | null;
  isCurrent: () => boolean;
  onStatus: (status: Readonly<{
    phase: 'saving' | 'saved' | 'error';
    detail: string;
    failureStage?: 'complete';
  }>) => void;
  onCheckpointCleared: () => void;
  onHistoryChanged: () => void;
}>) {
  input.onStatus({
    phase: 'saving',
    detail: 'Atomically saving each athlete’s exact finish clock and every recorded pedal zone.',
  });
  try {
    const saved = await completeClubOwnerRaceCapture(input);
    if (!input.isCurrent()) return saved;
    if (input.checkpointScope) clearClubOwnerTrainingCheckpoint(input.checkpointScope);
    input.onCheckpointCleared();
    input.onHistoryChanged();
    input.onStatus({
      phase: 'saved',
      detail: `${saved.sessions.length} athlete ${saved.sessions.length === 1 ? 'result' : 'results'} saved${saved.replayed ? ' (confirmed replay)' : ''}.`,
    });
    return saved;
  } catch (error) {
    if (input.isCurrent()) {
      input.onStatus({
        phase: 'error',
        failureStage: 'complete',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
