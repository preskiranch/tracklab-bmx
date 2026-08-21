import type { PlayerSlot, TrainingSession } from '../types';
import type { TrainingSessionInput } from './trainingHistory';
import {
  assertClubOwnerTrainingHasNoPrivateFields,
  buildClubOwnerTrainingCompletion,
  type ClubOwnerActiveClockSegment,
  type ClubOwnerTrainingActivityType,
} from './clubOwnerTrainingResults';

export type ClubOwnerTrainingAssignmentRequest = Readonly<{
  studioRiderId: string;
  bikeDeviceId: number | string;
  playerId: PlayerSlot['id'];
}>;

export type ClubOwnerTrainingAuthorizationRequest = Readonly<{
  /** Stable client nonce used to make a reservation retry idempotent. */
  requestId: string;
  clubId: string;
  sessionId: string;
  activityType: ClubOwnerTrainingActivityType;
  /** Reservation time only; each rider starts independently at first watt. */
  armedAt: number;
  assignments: readonly ClubOwnerTrainingAssignmentRequest[];
}>;

export type ClubOwnerTrainingGroupState =
  | 'armed'
  | 'partially-active'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type ClubOwnerTrainingAssignmentState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type ClubOwnerTrainingAssignment = Readonly<{
  id: string;
  studioRiderId: string;
  bikeDeviceId: string;
  playerId: PlayerSlot['id'];
  startedAt: number | null;
  activatedAt: number | null;
  endedAt: number | null;
  state: ClubOwnerTrainingAssignmentState;
}>;

export type ClubOwnerTrainingAuthorization = Readonly<{
  id: string;
  clubId: string;
  requestId: string;
  sessionId: string;
  activityType: ClubOwnerTrainingActivityType;
  armedAt: number;
  expiresAt: number;
  state: ClubOwnerTrainingGroupState;
  completedAt: number | null;
  cancelledAt: number | null;
  createdAt: number;
  updatedAt: number;
  assignments: readonly ClubOwnerTrainingAssignment[];
}>;

export type ClubOwnerTrainingCredential = Readonly<{
  authorization: ClubOwnerTrainingAuthorization;
  /**
   * One-use credential. It is non-enumerable so JSON serialization and object
   * spread cannot accidentally place it in state, logs, or request bodies.
   */
  completionToken: string;
  replayed: false;
  recovered: boolean;
}>;

export type ClubOwnerTrainingCreateReplay = Readonly<{
  authorization: ClubOwnerTrainingAuthorization;
  replayed: true;
  recovered: false;
  requiresTokenRecovery: true;
}>;

export type ClubOwnerTrainingCreateResult = ClubOwnerTrainingCredential | ClubOwnerTrainingCreateReplay;

export type ClubOwnerTrainingRiderWindow = Readonly<{
  assignmentId: string;
  status: 'finished' | 'dnf';
  endedAt: number;
  activeClockSegments?: readonly ClubOwnerActiveClockSegment[];
}>;

export type ClubOwnerTrainingCompletionResult = Readonly<{
  authorization: ClubOwnerTrainingAuthorization;
  sessions: readonly TrainingSession[];
  replayed: boolean;
  persistence: boolean;
}>;

export type ClubOwnerTrainingCancellationResult = Readonly<{
  authorization: ClubOwnerTrainingAuthorization;
  cancelled: true;
  replayed: boolean;
}>;

const activities = new Set<ClubOwnerTrainingActivityType>([
  'bmx-race',
  'straight-sprint',
  'get-pulled',
  'explore',
]);
const groupStates = new Set<ClubOwnerTrainingGroupState>([
  'armed',
  'partially-active',
  'active',
  'completed',
  'cancelled',
  'expired',
]);
const assignmentStates = new Set<ClubOwnerTrainingAssignmentState>([
  'waiting',
  'active',
  'completed',
  'cancelled',
  'expired',
]);

function identifier(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/u.test(value.trim())
    ? value.trim()
    : '';
}

function timestamp(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nullableTimestamp(value: unknown) {
  return value == null ? null : timestamp(value);
}

function normalizeActivity(value: unknown): ClubOwnerTrainingActivityType | null {
  return typeof value === 'string' && activities.has(value as ClubOwnerTrainingActivityType)
    ? value as ClubOwnerTrainingActivityType
    : null;
}

function normalizePlayer(value: unknown): PlayerSlot['id'] | null {
  const number = Number(value) as PlayerSlot['id'];
  return [1, 2, 3, 4].includes(number) ? number : null;
}

function normalizeBike(value: unknown) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  return /^\d{1,16}$/u.test(text) ? text : '';
}

function canonicalizeAuthorizationRequest(
  request: ClubOwnerTrainingAuthorizationRequest,
): ClubOwnerTrainingAuthorizationRequest & { assignments: readonly ClubOwnerTrainingAssignmentRequest[] } {
  const requestId = identifier(request.requestId);
  const clubId = identifier(request.clubId);
  const sessionId = identifier(request.sessionId);
  const activityType = normalizeActivity(request.activityType);
  const armedAt = timestamp(request.armedAt);
  if (!requestId || !clubId || !sessionId || !activityType || armedAt == null) {
    throw new Error('Club training authorization has an invalid session binding.');
  }
  if (!Array.isArray(request.assignments)
    || request.assignments.length < 1
    || request.assignments.length > 4) {
    throw new Error('Choose between one and four club riders before training.');
  }
  const riders = new Set<string>();
  const bikes = new Set<string>();
  const players = new Set<number>();
  const assignments = request.assignments.map((assignment, index) => {
    const studioRiderId = identifier(assignment.studioRiderId);
    const bikeDeviceId = normalizeBike(assignment.bikeDeviceId);
    const playerId = normalizePlayer(assignment.playerId);
    if (!studioRiderId || !bikeDeviceId || playerId == null) {
      throw new Error(`Club training assignment ${index + 1} is invalid.`);
    }
    if (riders.has(studioRiderId) || bikes.has(bikeDeviceId) || players.has(playerId)) {
      throw new Error('Each club rider, Wattbike, and player can be assigned only once.');
    }
    riders.add(studioRiderId);
    bikes.add(bikeDeviceId);
    players.add(playerId);
    return { studioRiderId, bikeDeviceId, playerId };
  });
  return { requestId, clubId, sessionId, activityType, armedAt, assignments };
}

function normalizeAssignment(value: unknown): ClubOwnerTrainingAssignment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = identifier(raw.id);
  const studioRiderId = identifier(raw.studioRiderId);
  const bikeDeviceId = normalizeBike(raw.bikeDeviceId);
  const playerId = normalizePlayer(raw.playerId);
  const startedAt = nullableTimestamp(raw.startedAt);
  const activatedAt = nullableTimestamp(raw.activatedAt);
  const endedAt = nullableTimestamp(raw.endedAt);
  const state = typeof raw.state === 'string' && assignmentStates.has(raw.state as ClubOwnerTrainingAssignmentState)
    ? raw.state as ClubOwnerTrainingAssignmentState
    : null;
  if (
    !id
    || !studioRiderId
    || !bikeDeviceId
    || playerId == null
    || !state
    || (raw.startedAt != null && startedAt == null)
    || (raw.activatedAt != null && activatedAt == null)
    || (raw.endedAt != null && endedAt == null)
    || ((startedAt == null) !== (activatedAt == null))
    || (endedAt != null && (startedAt == null || endedAt < startedAt))
    || (state === 'waiting' && (startedAt != null || endedAt != null))
    || (state === 'active' && (startedAt == null || endedAt != null))
    || (state === 'completed' && (startedAt == null || endedAt == null))
  ) return null;
  return {
    id,
    studioRiderId,
    bikeDeviceId,
    playerId,
    startedAt,
    activatedAt,
    endedAt,
    state,
  };
}

function normalizeAuthorization(value: unknown): ClubOwnerTrainingAuthorization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = identifier(raw.id);
  const clubId = identifier(raw.clubId);
  const requestId = identifier(raw.requestId);
  const sessionId = identifier(raw.sessionId);
  const activityType = normalizeActivity(raw.activityType);
  const armedAt = timestamp(raw.armedAt);
  const expiresAt = timestamp(raw.expiresAt);
  const completedAt = nullableTimestamp(raw.completedAt);
  const cancelledAt = nullableTimestamp(raw.cancelledAt);
  const createdAt = timestamp(raw.createdAt);
  const updatedAt = timestamp(raw.updatedAt);
  const state = typeof raw.state === 'string' && groupStates.has(raw.state as ClubOwnerTrainingGroupState)
    ? raw.state as ClubOwnerTrainingGroupState
    : null;
  const rawAssignments = Array.isArray(raw.assignments) ? raw.assignments : null;
  const assignments = rawAssignments
    ? rawAssignments.flatMap((assignment) => {
      const normalized = normalizeAssignment(assignment);
      return normalized ? [normalized] : [];
    })
    : [];
  if (
    !id
    || !clubId
    || !requestId
    || !sessionId
    || !activityType
    || armedAt == null
    || expiresAt == null
    || expiresAt <= armedAt
    || createdAt == null
    || updatedAt == null
    || !state
    || (raw.completedAt != null && completedAt == null)
    || (raw.cancelledAt != null && cancelledAt == null)
    || (state === 'completed' && completedAt == null)
    || (state === 'cancelled' && cancelledAt == null)
    || rawAssignments == null
    || assignments.length !== rawAssignments.length
    || assignments.length < 1
    || assignments.length > 4
  ) return null;
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  const riders = new Set(assignments.map((assignment) => assignment.studioRiderId));
  const bikes = new Set(assignments.map((assignment) => assignment.bikeDeviceId));
  const players = new Set(assignments.map((assignment) => assignment.playerId));
  if ([assignmentIds, riders, bikes, players].some((set) => set.size !== assignments.length)) return null;
  return {
    id,
    clubId,
    requestId,
    sessionId,
    activityType,
    armedAt,
    expiresAt,
    state,
    completedAt,
    cancelledAt,
    createdAt,
    updatedAt,
    assignments,
  };
}

function requestMatchesAuthorization(
  request: ClubOwnerTrainingAuthorizationRequest,
  authorization: ClubOwnerTrainingAuthorization,
) {
  if (
    authorization.requestId !== request.requestId
    || authorization.clubId !== request.clubId
    || authorization.sessionId !== request.sessionId
    || authorization.activityType !== request.activityType
    || authorization.armedAt !== request.armedAt
    || authorization.assignments.length !== request.assignments.length
  ) return false;
  const expected = new Map(request.assignments.map((assignment) => [assignment.playerId, {
    studioRiderId: assignment.studioRiderId,
    bikeDeviceId: String(assignment.bikeDeviceId),
  }]));
  return authorization.assignments.every((assignment) => {
    const binding = expected.get(assignment.playerId);
    return binding?.studioRiderId === assignment.studioRiderId
      && binding.bikeDeviceId === assignment.bikeDeviceId;
  });
}

function sameAuthorizationBinding(
  before: ClubOwnerTrainingAuthorization,
  after: ClubOwnerTrainingAuthorization,
) {
  if (
    before.id !== after.id
    || before.requestId !== after.requestId
    || before.clubId !== after.clubId
    || before.sessionId !== after.sessionId
    || before.activityType !== after.activityType
    || before.armedAt !== after.armedAt
    || before.expiresAt !== after.expiresAt
    || before.assignments.length !== after.assignments.length
  ) return false;
  const afterById = new Map(after.assignments.map((assignment) => [assignment.id, assignment]));
  return before.assignments.every((assignment) => {
    const next = afterById.get(assignment.id);
    return next?.studioRiderId === assignment.studioRiderId
      && next.bikeDeviceId === assignment.bikeDeviceId
      && next.playerId === assignment.playerId;
  });
}

function completionToken(value: unknown) {
  const token = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{40,256}$/u.test(token) ? token : '';
}

function credential(
  authorization: ClubOwnerTrainingAuthorization,
  token: string,
  recovered: boolean,
): ClubOwnerTrainingCredential {
  const result = {
    authorization,
    replayed: false as const,
    recovered,
  } as ClubOwnerTrainingCredential;
  Object.defineProperty(result, 'completionToken', {
    value: token,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

async function groupResponse<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `${label} returned ${response.status}`,
    );
  }
  return payload;
}

function jsonHeaders(token?: string) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { 'X-TrackLab-Group-Completion-Token': token } : {}),
  };
}

export async function createClubOwnerTrainingAuthorization(
  input: ClubOwnerTrainingAuthorizationRequest,
): Promise<ClubOwnerTrainingCreateResult> {
  const request = canonicalizeAuthorizationRequest(input);
  const response = await fetch('/api/club-live/training-authorizations', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(request),
  });
  const payload = await groupResponse<{
    authorization?: unknown;
    completionToken?: unknown;
    replayed?: unknown;
  }>(response, 'Club training authorization');
  const authorization = normalizeAuthorization(payload.authorization);
  if (!authorization || !requestMatchesAuthorization(request, authorization)) {
    throw new Error('Club training authorization did not match the selected riders and Wattbikes.');
  }
  if (payload.replayed === true) {
    if (payload.completionToken != null) {
      throw new Error('Club training authorization replay exposed an unexpected credential.');
    }
    return Object.freeze({
      authorization,
      replayed: true,
      recovered: false,
      requiresTokenRecovery: true,
    });
  }
  const token = completionToken(payload.completionToken);
  if (!token || payload.replayed !== false) {
    throw new Error('Club training authorization returned an invalid one-use credential.');
  }
  return credential(authorization, token, false);
}

export async function recoverClubOwnerTrainingCompletionToken(
  authorizationId: string,
  input: ClubOwnerTrainingAuthorizationRequest,
): Promise<ClubOwnerTrainingCredential> {
  const id = identifier(authorizationId);
  const request = canonicalizeAuthorizationRequest(input);
  if (!id) throw new Error('Choose a valid club training authorization to recover.');
  const response = await fetch(
    `/api/club-live/training-authorizations/${encodeURIComponent(id)}/recover`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(request),
    },
  );
  const payload = await groupResponse<{
    authorization?: unknown;
    completionToken?: unknown;
    recovered?: unknown;
  }>(response, 'Club training credential recovery');
  const authorization = normalizeAuthorization(payload.authorization);
  const token = completionToken(payload.completionToken);
  if (
    !authorization
    || authorization.id !== id
    || !requestMatchesAuthorization(request, authorization)
    || !token
    || payload.recovered !== true
  ) throw new Error('Club training credential recovery returned an invalid binding.');
  return credential(authorization, token, true);
}

export async function activateClubOwnerTrainingAssignment(
  authorized: ClubOwnerTrainingCredential,
  assignmentId: string,
  startedAt: number,
): Promise<ClubOwnerTrainingCredential> {
  const id = identifier(assignmentId);
  const started = timestamp(startedAt);
  const before = authorized.authorization;
  const assignment = before.assignments.find((candidate) => candidate.id === id);
  if (!assignment || started == null || started < before.armedAt) {
    throw new Error('Choose a valid club rider and first-watt start.');
  }
  const response = await fetch(
    `/api/club-live/training-authorizations/${encodeURIComponent(before.id)}/assignments/${encodeURIComponent(id)}/activate`,
    {
      method: 'POST',
      headers: jsonHeaders(authorized.completionToken),
      body: JSON.stringify({ startedAt: started }),
    },
  );
  const payload = await groupResponse<{ authorization?: unknown }>(response, 'Club rider first-watt activation');
  const authorization = normalizeAuthorization(payload.authorization);
  const activated = authorization?.assignments.find((candidate) => candidate.id === id);
  if (
    !authorization
    || !sameAuthorizationBinding(before, authorization)
    || activated?.startedAt !== started
    || activated.activatedAt == null
    || (activated.state !== 'active' && activated.state !== 'completed')
  ) throw new Error('Club rider activation did not match its reserved rider and Wattbike.');
  return credential(authorization, authorized.completionToken, authorized.recovered);
}

function normalizeTrainingSession(value: unknown): TrainingSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = identifier(raw.id);
  const activityType = normalizeActivity(raw.activityType);
  const startedAt = timestamp(raw.startedAt);
  const endedAt = timestamp(raw.endedAt);
  const durationMs = timestamp(raw.durationMs);
  const distanceMeters = Number(raw.distanceMeters);
  const createdAt = timestamp(raw.createdAt);
  const updatedAt = timestamp(raw.updatedAt);
  if (
    !id
    || !activityType
    || startedAt == null
    || endedAt == null
    || endedAt < startedAt
    || durationMs == null
    || !Number.isFinite(distanceMeters)
    || distanceMeters < 0
    || createdAt == null
    || updatedAt == null
    || !raw.details
    || typeof raw.details !== 'object'
    || Array.isArray(raw.details)
  ) return null;
  return {
    id,
    activityType,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Club training session',
    startedAt,
    endedAt,
    durationMs,
    distanceMeters,
    ...(typeof raw.trackId === 'string' && raw.trackId ? { trackId: raw.trackId } : {}),
    ...(typeof raw.trackName === 'string' && raw.trackName ? { trackName: raw.trackName } : {}),
    source: raw.source === 'imported' ? 'imported' : 'live',
    ...(raw.club && typeof raw.club === 'object' && !Array.isArray(raw.club)
      ? { club: raw.club as TrainingSession['club'] }
      : {}),
    details: raw.details as Record<string, unknown>,
    createdAt,
    updatedAt,
  };
}

export async function completeClubOwnerTrainingGroup(
  authorized: ClubOwnerTrainingCredential,
  session: TrainingSessionInput,
  riderWindows: readonly ClubOwnerTrainingRiderWindow[],
): Promise<ClubOwnerTrainingCompletionResult> {
  const before = authorized.authorization;
  if (session.id !== before.sessionId) throw new Error('The completed session does not match its club authorization.');
  const build = buildClubOwnerTrainingCompletion(before, session, riderWindows);
  const response = await fetch('/api/club-live/assigned-training-sessions', {
    method: 'POST',
    headers: jsonHeaders(authorized.completionToken),
    body: JSON.stringify({
      authorizationId: before.id,
      session: build.session,
      riderWindows: build.riderWindows,
    }),
  });
  const payload = await groupResponse<{
    authorization?: unknown;
    sessions?: unknown;
    replayed?: unknown;
    persistence?: unknown;
  }>(response, 'Club group training completion');
  const authorization = normalizeAuthorization(payload.authorization);
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions.flatMap((raw) => {
      const normalized = normalizeTrainingSession(raw);
      return normalized ? [normalized] : [];
    })
    : [];
  sessions.forEach((saved) => assertClubOwnerTrainingHasNoPrivateFields(saved));
  const savedRiders = new Set(sessions.map((saved) => saved.club?.studioRiderId).filter(Boolean));
  const expectedRiders = new Set(before.assignments.map((assignment) => assignment.studioRiderId));
  const completedAssignments = new Map(authorization?.assignments.map((assignment) => [assignment.id, assignment]));
  const completionClocksMatch = build.riderWindows.every((window) => {
    const assignment = completedAssignments.get(window.assignmentId);
    return assignment?.state === 'completed' && assignment.endedAt === window.endedAt;
  });
  if (
    !authorization
    || !sameAuthorizationBinding(before, authorization)
    || authorization.state !== 'completed'
    || authorization.completedAt == null
    || !completionClocksMatch
    || sessions.length !== before.assignments.length
    || savedRiders.size !== expectedRiders.size
    || [...expectedRiders].some((riderId) => !savedRiders.has(riderId))
    || typeof payload.replayed !== 'boolean'
    || typeof payload.persistence !== 'boolean'
  ) throw new Error('Club group training completion returned an invalid atomic result.');
  return {
    authorization,
    sessions,
    replayed: payload.replayed,
    persistence: payload.persistence,
  };
}

export async function cancelClubOwnerTrainingAuthorization(
  authorized: ClubOwnerTrainingCredential,
  options: { keepalive?: boolean } = {},
): Promise<ClubOwnerTrainingCancellationResult> {
  const before = authorized.authorization;
  const response = await fetch(
    `/api/club-live/training-authorizations/${encodeURIComponent(before.id)}`,
    {
      method: 'DELETE',
      keepalive: options.keepalive,
      headers: jsonHeaders(authorized.completionToken),
      body: '{}',
    },
  );
  const payload = await groupResponse<{
    authorization?: unknown;
    cancelled?: unknown;
    replayed?: unknown;
  }>(response, 'Club training authorization cancellation');
  const authorization = normalizeAuthorization(payload.authorization);
  if (
    !authorization
    || !sameAuthorizationBinding(before, authorization)
    || authorization.state !== 'cancelled'
    || authorization.cancelledAt == null
    || payload.cancelled !== true
    || typeof payload.replayed !== 'boolean'
  ) throw new Error('Club training cancellation returned an invalid result.');
  return {
    authorization,
    cancelled: true,
    replayed: payload.replayed,
  };
}
