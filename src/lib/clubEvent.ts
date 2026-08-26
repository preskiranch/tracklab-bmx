import {
  clubTabletSessionHeaders,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  type ClubTabletDeviceCredential,
  type ClubTabletSessionCredential,
} from './clubTabletStorage';
export { clubEventMultiplayerRoomReady } from './clubEventRuntime';

export type ClubEventActivityType = 'bmx-race' | 'straight-sprint' | 'explore';
export type ClubEventProgram = 'race' | 'straight-sprint' | 'explore';
export type ClubEventStatus = 'lobby' | 'active';
export type ClubEventSlotStatus = 'available' | 'ready' | 'active' | 'stale';
export type ClubEventRaceViewMode = 'satellite' | '3d' | 'game';

export type ClubEventRaceViewCamera = Readonly<{
  angle: number;
  heading: number;
  center?: Readonly<{ lat: number; lng: number }>;
  zoom?: number;
}>;

/** Immutable display snapshot selected by the owner when the lobby opens. */
export type ClubEventRaceView = Readonly<{
  mode: ClubEventRaceViewMode;
  camera?: ClubEventRaceViewCamera;
}>;

export type ClubEventAthlete = Readonly<{
  studioRiderId: string;
  riderName: string;
  athleteName: string | null;
}>;

export type ClubEventSlot = Readonly<{
  seatNumber: number;
  deviceId: string | null;
  deviceName: string | null;
  deviceLastSeenAt: number | null;
  status: ClubEventSlotStatus;
  ready: boolean;
  athlete: ClubEventAthlete | null;
  /** Wattbike monitor identifier. It is opaque to the server. */
  bikeDeviceId: string | null;
  joinedAt: number | null;
}>;

export type ClubEventConfiguration = Readonly<{
  [key: string]: unknown;
  raceView?: ClubEventRaceView;
}>;

export type ClubEventSnapshot = Readonly<{
  id: string;
  clubId: string;
  clubName: string;
  activityType: ClubEventActivityType;
  configuration: ClubEventConfiguration;
  status: ClubEventStatus;
  startAt: number | null;
  createdAt: number;
  updatedAt: number;
  slots: readonly ClubEventSlot[];
}>;

export type ClubEventEnvelope = Readonly<{
  event: ClubEventSnapshot | null;
  pollAfterMs: number;
}>;

export type ClubEventSelection = Readonly<{
  deviceId: string;
  studioRiderId: string;
  bikeDeviceId: number;
}>;

export type ClubEventLaunchPayload = Readonly<{
  eventId: string;
  clubId: string;
  activityType: ClubEventActivityType;
  program: ClubEventProgram;
  configuration: ClubEventConfiguration;
  startAt: number;
  seatNumber: number;
  studioRiderId: string;
  bikeDeviceId: number;
}>;

export type ClubEventTabletState = Readonly<{
  phase: 'selecting' | 'conflict' | 'ready' | 'active' | 'stale';
  slot: ClubEventSlot | null;
  conflict: string | null;
}>;

export type ClubEventCredentials = Readonly<{
  device?: ClubTabletDeviceCredential | null;
  session?: ClubTabletSessionCredential | null;
}>;

const defaultPollAfterMs = 2_000;
const minPollAfterMs = 1_000;
const maxPollAfterMs = 15_000;
const launchStorageKey = 'tracklab.club-event-launch.v1';
const maxClubEventConfigurationArrayLength = 10_000;

function text(value: unknown, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function positiveTimestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function normalizePollAfterMs(value: unknown) {
  const number = positiveInteger(value) ?? defaultPollAfterMs;
  return Math.max(minPollAfterMs, Math.min(maxPollAfterMs, number));
}

function normalizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value
      .slice(0, maxClubEventConfigurationArrayLength)
      .map((entry) => normalizeJsonValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
    .slice(0, 160)
    .map(([key, nested]) => [key.slice(0, 120), normalizeJsonValue(nested, depth + 1)]));
}

export function normalizeClubEventRaceView(value: unknown): ClubEventRaceView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const mode = candidate.mode === 'satellite'
    || candidate.mode === '3d'
    || candidate.mode === 'game'
    ? candidate.mode
    : null;
  if (!mode) return null;
  if (!Object.prototype.hasOwnProperty.call(candidate, 'camera')) return { mode };
  if (!candidate.camera || typeof candidate.camera !== 'object' || Array.isArray(candidate.camera)) return null;

  const camera = candidate.camera as Record<string, unknown>;
  const angle = camera.angle;
  const heading = camera.heading;
  if (
    typeof angle !== 'number'
    || !Number.isFinite(angle)
    || angle < 0
    || angle > 67
    || typeof heading !== 'number'
    || !Number.isFinite(heading)
    || heading < 0
    || heading >= 360
  ) return null;

  let center: ClubEventRaceViewCamera['center'];
  if (Object.prototype.hasOwnProperty.call(camera, 'center')) {
    if (!camera.center || typeof camera.center !== 'object' || Array.isArray(camera.center)) return null;
    const point = camera.center as Record<string, unknown>;
    if (
      typeof point.lat !== 'number'
      || !Number.isFinite(point.lat)
      || point.lat < -90
      || point.lat > 90
      || typeof point.lng !== 'number'
      || !Number.isFinite(point.lng)
      || point.lng < -180
      || point.lng > 180
    ) return null;
    center = { lat: point.lat, lng: point.lng };
  }

  let zoom: number | undefined;
  if (Object.prototype.hasOwnProperty.call(camera, 'zoom')) {
    if (
      typeof camera.zoom !== 'number'
      || !Number.isFinite(camera.zoom)
      || camera.zoom < 0
      || camera.zoom > 30
    ) return null;
    zoom = camera.zoom;
  }

  return {
    mode,
    camera: {
      angle,
      heading,
      ...(center ? { center } : {}),
      ...(zoom != null ? { zoom } : {}),
    },
  };
}

function normalizeConfiguration(value: unknown): ClubEventConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = normalizeJsonValue(value) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(value, 'raceView')) {
    const raceView = normalizeClubEventRaceView((value as Record<string, unknown>).raceView);
    if (raceView) normalized.raceView = raceView;
    else delete normalized.raceView;
  }
  return normalized as ClubEventConfiguration;
}

function normalizeAthlete(value: unknown): ClubEventAthlete | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const studioRiderId = text(candidate.studioRiderId, 160);
  const riderName = text(candidate.riderName, 120);
  if (!studioRiderId || !riderName) return null;
  return {
    studioRiderId,
    riderName,
    athleteName: text(candidate.athleteName, 120) || null,
  };
}

function normalizeSlot(value: unknown): ClubEventSlot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const seatNumber = positiveInteger(candidate.seatNumber);
  const status = candidate.status === 'available'
    || candidate.status === 'ready'
    || candidate.status === 'active'
    || candidate.status === 'stale'
    ? candidate.status
    : null;
  if (!seatNumber || seatNumber > 4 || !status) return null;
  const athlete = normalizeAthlete(candidate.athlete);
  const deviceId = text(candidate.deviceId, 160) || null;
  const bikeDeviceId = text(candidate.bikeDeviceId, 160) || null;
  return {
    seatNumber,
    deviceId,
    deviceName: text(candidate.deviceName, 120) || null,
    deviceLastSeenAt: positiveTimestamp(candidate.deviceLastSeenAt),
    status,
    ready: candidate.ready === true || status === 'ready' || status === 'active',
    athlete,
    bikeDeviceId,
    joinedAt: positiveTimestamp(candidate.joinedAt),
  };
}

export function normalizeClubEventSnapshot(value: unknown): ClubEventSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = text(candidate.id, 160);
  const clubId = text(candidate.clubId, 160);
  const clubName = text(candidate.clubName, 120);
  const activityType = candidate.activityType === 'bmx-race'
    || candidate.activityType === 'straight-sprint'
    || candidate.activityType === 'explore'
    ? candidate.activityType
    : null;
  const status = candidate.status === 'lobby' || candidate.status === 'active'
    ? candidate.status
    : null;
  const startAt = positiveTimestamp(candidate.startAt);
  if (!id || !clubId || !clubName || !activityType || !status || (status === 'active' && !startAt)) return null;

  const seenSeats = new Set<number>();
  const slots = (Array.isArray(candidate.slots) ? candidate.slots : [])
    .flatMap((slot) => {
      const normalized = normalizeSlot(slot);
      if (!normalized || seenSeats.has(normalized.seatNumber)) return [];
      seenSeats.add(normalized.seatNumber);
      return [normalized];
    })
    .sort((left, right) => left.seatNumber - right.seatNumber)
    .slice(0, 4);
  const createdAt = positiveTimestamp(candidate.createdAt) ?? 0;
  const updatedAt = positiveTimestamp(candidate.updatedAt) ?? createdAt;
  return {
    id,
    clubId,
    clubName,
    activityType,
    configuration: normalizeConfiguration(candidate.configuration),
    status,
    startAt: status === 'active' ? startAt : null,
    createdAt,
    updatedAt,
    slots,
  };
}

export function normalizeClubEventEnvelope(value: unknown): ClubEventEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if ('event' in candidate) {
    const event = candidate.event == null ? null : normalizeClubEventSnapshot(candidate.event);
    if (candidate.event != null && !event) return null;
    return { event, pollAfterMs: normalizePollAfterMs(candidate.pollAfterMs) };
  }
  // Tolerate a direct event snapshot during rolling backend deployments.
  const event = normalizeClubEventSnapshot(candidate);
  return event ? { event, pollAfterMs: defaultPollAfterMs } : null;
}

export function clubEventProgram(activityType: ClubEventActivityType): ClubEventProgram {
  return activityType === 'bmx-race' ? 'race' : activityType;
}

export function clubEventActivityTitle(activityType: ClubEventActivityType) {
  return activityType === 'bmx-race'
    ? 'BMX Race Intervals'
    : activityType === 'straight-sprint' ? 'Straight Sprint' : 'Explore the World';
}

export function clubEventSlotForDevice(event: ClubEventSnapshot | null | undefined, deviceId: string) {
  const safeDeviceId = text(deviceId, 160);
  return safeDeviceId
    ? event?.slots.find((slot) => slot.deviceId === safeDeviceId) ?? null
    : null;
}

export function clubEventLaunchAcknowledged(
  event: ClubEventSnapshot | null | undefined,
  slot: ClubEventSlot | null | undefined,
) {
  // The server promotes a slot to active only after the authenticated tablet
  // socket joins this exact event's private room. General Club Live telemetry
  // has no event ID and therefore must not be used as a launch receipt.
  return Boolean(
    event?.status === 'active'
    && slot?.status === 'active'
    && slot.ready
    && slot.deviceId
    && slot.athlete,
  );
}

function slotAthleteName(slot: ClubEventSlot) {
  return slot.athlete?.athleteName || slot.athlete?.riderName || 'That athlete';
}

function slotDeviceName(slot: ClubEventSlot) {
  return slot.deviceName || `club tablet ${slot.seatNumber}`;
}

export function clubEventSelectionConflict(
  event: ClubEventSnapshot | null | undefined,
  selection: ClubEventSelection | null | undefined,
) {
  if (!event || !selection?.deviceId || !selection.studioRiderId || !selection.bikeDeviceId) return null;
  const bikeDeviceId = String(Math.round(selection.bikeDeviceId));
  const athleteSlot = event.slots.find((slot) => (
    slot.deviceId !== selection.deviceId
    && slot.athlete?.studioRiderId === selection.studioRiderId
    && slot.status !== 'available'
  ));
  if (athleteSlot) {
    return `${slotAthleteName(athleteSlot)} is already ready on ${slotDeviceName(athleteSlot)}. Choose a different athlete.`;
  }
  const bikeSlot = event.slots.find((slot) => (
    slot.deviceId !== selection.deviceId
    && slot.bikeDeviceId === bikeDeviceId
    && slot.status !== 'available'
  ));
  return bikeSlot
    ? `That Wattbike is already assigned to ${slotDeviceName(bikeSlot)} for this coach event.`
    : null;
}

export function clubEventTabletState(
  event: ClubEventSnapshot,
  deviceId: string,
  selection?: ClubEventSelection | null,
): ClubEventTabletState {
  const slot = clubEventSlotForDevice(event, deviceId);
  if (slot?.status === 'stale') return { phase: 'stale', slot, conflict: null };
  if (slot && event.status === 'active') return { phase: 'active', slot, conflict: null };
  if (slot?.ready) return { phase: 'ready', slot, conflict: null };
  const conflict = clubEventSelectionConflict(event, selection);
  return { phase: conflict ? 'conflict' : 'selecting', slot, conflict };
}

export function clubEventLaunchForDevice(
  event: ClubEventSnapshot | null | undefined,
  deviceId: string,
): ClubEventLaunchPayload | null {
  if (!event || event.status !== 'active' || !event.startAt) return null;
  const slot = clubEventSlotForDevice(event, deviceId);
  if (!slot?.athlete || !slot.bikeDeviceId || (!slot.ready && slot.status !== 'active')) return null;
  const bikeDeviceId = Number(slot.bikeDeviceId);
  if (!Number.isFinite(bikeDeviceId) || bikeDeviceId <= 0) return null;
  return {
    eventId: event.id,
    clubId: event.clubId,
    activityType: event.activityType,
    program: clubEventProgram(event.activityType),
    configuration: event.configuration,
    startAt: event.startAt,
    seatNumber: slot.seatNumber,
    studioRiderId: slot.athlete.studioRiderId,
    bikeDeviceId: Math.round(bikeDeviceId),
  };
}

export function clubEventLaunchKey(payload: ClubEventLaunchPayload) {
  return `${payload.eventId}:${payload.startAt}:${payload.seatNumber}:${payload.studioRiderId}`;
}

export function clubEventLaunchWasHandled(payload: ClubEventLaunchPayload) {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(launchStorageKey) === clubEventLaunchKey(payload);
  } catch {
    return false;
  }
}

export function markClubEventLaunchHandled(payload: ClubEventLaunchPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(launchStorageKey, clubEventLaunchKey(payload));
  } catch {
    // The in-memory component guard still prevents a duplicate launch while mounted.
  }
}

export class ClubEventRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClubEventRequestError';
    this.status = status;
  }
}

function eventAuthHeaders(credentials: ClubEventCredentials, requireSession = false) {
  const device = credentials.device ?? readStoredClubTabletDevice();
  const session = credentials.session ?? readStoredClubTabletSession();
  if (session && (!device || (
    session.deviceId === device.device.id
    && session.session.clubId === device.device.clubId
  ))) {
    return clubTabletSessionHeaders(session.sessionToken);
  }
  if (requireSession) throw new Error('Choose an athlete before joining the coach event.');
  if (!device) throw new Error('This tablet has not been authorized by the club owner.');
  return { Authorization: `Bearer ${device.deviceToken}` };
}

async function eventFetch(path: string, init: RequestInit, credentials: ClubEventCredentials, requireSession = false) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...eventAuthHeaders(credentials, requireSession),
      ...init.headers,
    },
  });
  return normalizeEventResponse(response);
}

async function normalizeEventResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ClubEventRequestError(
      text(payload.error, 300) || `Coach event returned ${response.status}`,
      response.status,
    );
  }
  const envelope = normalizeClubEventEnvelope(payload);
  if (!envelope) throw new Error('TrackLab returned an invalid coach event.');
  return envelope;
}

async function ownerEventFetch(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return normalizeEventResponse(response);
}

export function loadCurrentClubEvent(
  credentials: ClubEventCredentials = {},
  signal?: AbortSignal,
) {
  return eventFetch('/api/club-events/current', { method: 'GET', signal }, credentials);
}

/** Loads the current event with the signed-in club-owner cookie. */
export function loadCurrentClubEventForOwner(signal?: AbortSignal) {
  return ownerEventFetch('/api/club-events/current', { method: 'GET', signal });
}

export function joinCurrentClubEvent(
  eventId: string,
  session: ClubTabletSessionCredential,
  signal?: AbortSignal,
) {
  const safeEventId = text(eventId, 160);
  if (!safeEventId) return Promise.reject(new Error('The coach event is missing its ID.'));
  return eventFetch('/api/club-events/current/join', {
    method: 'POST',
    signal,
    body: JSON.stringify({ eventId: safeEventId }),
  }, { session }, true);
}

export function leaveCurrentClubEvent(
  eventId: string,
  session: ClubTabletSessionCredential,
  signal?: AbortSignal,
) {
  const safeEventId = text(eventId, 160);
  if (!safeEventId) return Promise.reject(new Error('The coach event is missing its ID.'));
  return eventFetch('/api/club-events/current/join', {
    method: 'DELETE',
    signal,
    body: JSON.stringify({ eventId: safeEventId }),
  }, { session }, true);
}

/** Creates the club owner's single current event using the signed-in cookie. */
export function createClubEvent(
  activityType: ClubEventActivityType,
  configuration: ClubEventConfiguration = {},
  signal?: AbortSignal,
) {
  return ownerEventFetch('/api/club-events', {
    method: 'POST',
    signal,
    body: JSON.stringify({ activityType, configuration: normalizeConfiguration(configuration) }),
  });
}

/** Starts every ready event lane against the server-issued common startAt. */
export function startCurrentClubEvent(eventId: string, signal?: AbortSignal) {
  const safeEventId = text(eventId, 160);
  if (!safeEventId) return Promise.reject(new Error('The coach event is missing its ID.'));
  return ownerEventFetch('/api/club-events/current/start', {
    method: 'POST',
    signal,
    body: JSON.stringify({ eventId: safeEventId }),
  });
}

/** Cancels the lobby/current event using the signed-in club-owner cookie. */
export function cancelCurrentClubEvent(eventId: string, signal?: AbortSignal) {
  const safeEventId = text(eventId, 160);
  if (!safeEventId) return Promise.reject(new Error('The coach event is missing its ID.'));
  return ownerEventFetch('/api/club-events/current/cancel', {
    method: 'POST',
    signal,
    body: JSON.stringify({ eventId: safeEventId }),
  });
}
