import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';
import type { HeartRateMeasurement } from '../types';
import { normalizeHeartRateMeasurement } from './heartRate';

export const nativeHeartRatePluginName = 'TrackLabHeartRate';
export const nativeHeartRateSampleEvent = 'heartRateSample';
export const nativeHeartRateStatusEvent = 'heartRateStatus';
export const nativeHeartRateRelayStatusEvent = 'heartRateRelayStatus';
export const nativeHeartRateContractVersion = 1 as const;
export const watchConnectMaximumDurationMs = 4 * 60 * 60 * 1_000;
/**
 * A server-created connection is exactly four hours long. Apple devices with
 * automatic time disabled can still trail the server slightly, so allow a
 * small, explicit offset while the server credential remains authoritative.
 */
export const watchConnectMaximumClockSkewMs = 5 * 1_000;
export const watchConnectLatestBuildReason = 'Install the latest TrackLab build to use Watch Connect.';

export type NativeHeartRatePlatform = 'iphone' | 'ipad' | 'other';
export type NativeHeartRateRelayScope = 'personal-session' | 'studio-block' | 'account-block';

export type NativeHeartRateWorkoutRelayResult = Readonly<{
  handled: boolean;
  configured: boolean;
  sessionId?: string;
  scope?: NativeHeartRateRelayScope;
  queued?: boolean;
  reason?: string;
}>;

export type NativeHeartRateAvailability = Readonly<{
  version: 1;
  supported: boolean;
  reason?: string;
  platform: NativeHeartRatePlatform;
  paired: boolean;
  watchAppInstalled: boolean;
  healthDataAvailable: boolean;
  minimumIOS: '17.0';
  minimumWatchOS: '10.0';
}>;

export type NativeHeartRateWorkoutState =
  | 'idle'
  | 'launching'
  | 'connecting'
  | 'active'
  | 'paused'
  | 'ending'
  | 'ended'
  | 'unavailable'
  | 'error';

export type NativeWatchConnectPhase =
  | 'inactive'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'reconnect'
  | 'disconnecting'
  | 'error';

export type NativeWatchConnectState = Readonly<{
  version: 1;
  state: NativeWatchConnectPhase;
  scope: 'personal' | 'studio' | null;
  connectionId: string | null;
  sessionId: string | null;
  connectedUntil: number | null;
  remainingMs: number;
  requiresUserStart: boolean;
  workoutReady: boolean;
  relayConfigured: boolean;
  reason?: string;
}>;

export type NativeWatchConnectIdentity = Readonly<{
  version: 1;
  installId: string;
}>;

export type NativeWatchConnectStart = Readonly<{
  scope: 'personal' | 'studio';
  connectionId: string;
  pairingId: string;
  relaySessionId: string;
  baseUrl: string;
  ingestToken: string;
  expiresAt: number;
}>;

export type NativeHeartRateStatus = Readonly<{
  version: 1;
  state: NativeHeartRateWorkoutState;
  sessionId: string | null;
  message?: string;
  at: number;
  relay?: NativeHeartRateWorkoutRelayResult;
  watchConnect?: NativeWatchConnectState;
}>;

export type NativeHeartRateRelayConfiguration = Readonly<{
  baseUrl: string;
  ingestToken: string;
  sessionId: string;
  startedAt: number;
  activeElapsedAtStartMs?: number;
  scope?: NativeHeartRateRelayScope;
}>;

export type NativeHeartRateRelayZone = Readonly<{
  zoneId: string;
  zoneName?: string;
  startElapsedMs: number;
  endElapsedMs: number;
}>;

export type NativeHeartRateRelayFinalization = Readonly<{
  sessionId: string;
  endedAt: number;
  activeDurationMs: number;
  zones?: readonly NativeHeartRateRelayZone[];
}>;

export type NativeHeartRateRelayClockUpdate = Readonly<{
  sessionId: string;
  at: number;
  activeElapsedMs: number;
}>;

export type NativeHeartRateRelaySessionTarget = Readonly<{
  sessionId: string;
}>;

export type NativeHeartRateRelayState = Readonly<{
  configured: boolean;
  sessionId?: string;
  scope?: NativeHeartRateRelayScope;
  reason?: string;
  queued?: boolean;
}>;

export type NativeHeartRateRelaySessionState = Readonly<{
  sessionId: string;
  scope: NativeHeartRateRelayScope;
  state: 'active' | 'queued' | 'syncing' | 'retrying' | 'pending';
  finalized: boolean;
  pendingSampleCount: number;
  droppedSampleCount: number;
  streamCreated: boolean;
}>;

export type NativeHeartRateRelayReason =
  | 'observing'
  | 'recovered'
  | 'configured'
  | 'queued'
  | 'cleared'
  | 'clearedAll'
  | 'syncing'
  | 'synced'
  | 'progress'
  | 'retryScheduled'
  | 'capacityLimited'
  | 'credentialMissing'
  | 'credentialRejected'
  | 'requestRejected'
  | 'invalidState';

export type NativeHeartRateRelaySnapshot = Readonly<{
  version: number;
  configured: boolean;
  syncing: boolean;
  clearing: boolean;
  queuedSessionIds: readonly string[];
  queuedCount: number;
  pendingSampleCount: number;
  droppedSampleCount: number;
  sessionId?: string;
  scope?: NativeHeartRateRelayScope;
  syncingSessionId?: string;
  sessions: readonly NativeHeartRateRelaySessionState[];
  reason?: NativeHeartRateRelayReason;
}>;

type NativeHeartRateSampleEvent = Readonly<{
  version: 1;
  sessionId: string | null;
  sequence: number;
  bpm: number;
  measuredAt: number;
  receivedAt: number;
  source: 'apple-watch';
}>;

export type NativeHeartRatePlugin = {
  getAvailability: () => Promise<NativeHeartRateAvailability>;
  getState: () => Promise<NativeHeartRateStatus>;
  startWorkout: (options: { sessionId: string }) => Promise<NativeHeartRateStatus>;
  pauseWorkout: () => Promise<NativeHeartRateStatus>;
  resumeWorkout: () => Promise<NativeHeartRateStatus>;
  endWorkout: () => Promise<NativeHeartRateStatus>;
  configureRelay?: (options: NativeHeartRateRelayConfiguration) => Promise<NativeHeartRateRelayState>;
  pauseRelay?: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  resumeRelay?: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  finalizeRelay?: (options: NativeHeartRateRelayFinalization) => Promise<NativeHeartRateRelayState>;
  clearRelay?: (options: NativeHeartRateRelaySessionTarget) => Promise<NativeHeartRateRelayState>;
  clearAllRelays?: () => Promise<NativeHeartRateRelayState>;
  getRelayState?: () => Promise<NativeHeartRateRelaySnapshot>;
  getWatchConnectIdentity?: () => Promise<NativeWatchConnectIdentity>;
  getWatchConnectState?: () => Promise<NativeWatchConnectState>;
  startWatchConnect?: (options: NativeWatchConnectStart) => Promise<NativeWatchConnectState>;
  stopWatchConnect?: () => Promise<NativeWatchConnectState>;
  addListener: {
    (
      eventName: typeof nativeHeartRateSampleEvent,
      listener: (event: NativeHeartRateSampleEvent) => void,
    ): Promise<PluginListenerHandle>;
    (
      eventName: typeof nativeHeartRateStatusEvent,
      listener: (event: NativeHeartRateStatus) => void,
    ): Promise<PluginListenerHandle>;
    (
      eventName: typeof nativeHeartRateRelayStatusEvent,
      listener: (event: NativeHeartRateRelaySnapshot) => void,
    ): Promise<PluginListenerHandle>;
  };
};

type CapacitorFeatureDetector = Pick<typeof Capacitor, 'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'>;

export type NativeHeartRateClient = Readonly<{
  isPluginAvailable: () => boolean;
  getAvailability: () => Promise<NativeHeartRateAvailability>;
  getState: () => Promise<NativeHeartRateStatus>;
  startWorkout: (sessionId: string) => Promise<NativeHeartRateStatus>;
  pauseWorkout: () => Promise<NativeHeartRateStatus>;
  resumeWorkout: () => Promise<NativeHeartRateStatus>;
  endWorkout: () => Promise<NativeHeartRateStatus>;
  configureRelay: (options: NativeHeartRateRelayConfiguration) => Promise<NativeHeartRateRelayState>;
  pauseRelay: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  resumeRelay: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  finalizeRelay: (options: NativeHeartRateRelayFinalization) => Promise<NativeHeartRateRelayState>;
  clearRelay: (options: NativeHeartRateRelaySessionTarget) => Promise<NativeHeartRateRelayState>;
  clearAllRelays: () => Promise<NativeHeartRateRelayState>;
  getRelayState: () => Promise<NativeHeartRateRelaySnapshot>;
  getWatchConnectIdentity: () => Promise<NativeWatchConnectIdentity | null>;
  getWatchConnectState: () => Promise<NativeWatchConnectState>;
  startWatchConnect: (options: NativeWatchConnectStart) => Promise<NativeWatchConnectState>;
  stopWatchConnect: () => Promise<NativeWatchConnectState>;
  addSampleListener: (
    listener: (sample: HeartRateMeasurement) => void,
  ) => Promise<PluginListenerHandle>;
  addStatusListener: (
    listener: (status: NativeHeartRateStatus) => void,
  ) => Promise<PluginListenerHandle>;
  addRelayStatusListener: (
    listener: (status: NativeHeartRateRelaySnapshot) => void,
  ) => Promise<PluginListenerHandle>;
}>;

const nativePlugin = registerPlugin<NativeHeartRatePlugin>(nativeHeartRatePluginName);

function browserPlatform(): NativeHeartRatePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('ipad')) return 'ipad';
  if (userAgent.includes('iphone')) return 'iphone';
  return 'other';
}

function unavailableAvailability(reason: string): NativeHeartRateAvailability {
  return {
    version: nativeHeartRateContractVersion,
    supported: false,
    reason,
    platform: browserPlatform(),
    paired: false,
    watchAppInstalled: false,
    healthDataAvailable: false,
    minimumIOS: '17.0',
    minimumWatchOS: '10.0',
  };
}

function unavailableStatus(message: string): NativeHeartRateStatus {
  return {
    version: nativeHeartRateContractVersion,
    state: 'unavailable',
    sessionId: null,
    message,
    at: Date.now(),
  };
}

const workoutStates = new Set<NativeHeartRateWorkoutState>([
  'idle',
  'launching',
  'connecting',
  'active',
  'paused',
  'ending',
  'ended',
  'unavailable',
  'error',
]);

const watchConnectPhases = new Set<NativeWatchConnectPhase>([
  'inactive',
  'connecting',
  'connected',
  'syncing',
  'reconnect',
  'disconnecting',
  'error',
]);

function nullableWatchConnectId(value: unknown) {
  if (value == null) return null;
  return relaySessionId(value) || undefined;
}

export function normalizeNativeWatchConnectState(value: unknown): NativeWatchConnectState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const state = item.state as NativeWatchConnectPhase;
  const scope = item.scope == null
    ? null
    : item.scope === 'personal' || item.scope === 'studio'
      ? item.scope
      : undefined;
  const connectionId = nullableWatchConnectId(item.connectionId);
  const sessionId = nullableWatchConnectId(item.sessionId);
  const connectedUntil = item.connectedUntil == null ? null : Number(item.connectedUntil);
  const remainingMs = Number(item.remainingMs);
  const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) : '';
  if (
    item.version !== nativeHeartRateContractVersion
    || !watchConnectPhases.has(state)
    || scope === undefined
    || connectionId === undefined
    || sessionId === undefined
    || (connectedUntil != null && (!Number.isFinite(connectedUntil) || connectedUntil < 0))
    || !Number.isFinite(remainingMs)
    || remainingMs < 0
    || typeof item.requiresUserStart !== 'boolean'
    || typeof item.workoutReady !== 'boolean'
    || typeof item.relayConfigured !== 'boolean'
    // A trusted install identifier is intentionally available only through
    // getWatchConnectIdentity during enrollment, never routine status/events.
    || Object.hasOwn(item, 'installId')
  ) return null;
  return {
    version: nativeHeartRateContractVersion,
    state,
    scope,
    connectionId,
    sessionId,
    connectedUntil: connectedUntil == null ? null : Math.round(connectedUntil),
    remainingMs: Math.round(remainingMs),
    requiresUserStart: item.requiresUserStart,
    workoutReady: item.workoutReady,
    relayConfigured: item.relayConfigured,
    ...(reason ? { reason } : {}),
  };
}

export function normalizeNativeWatchConnectIdentity(value: unknown): NativeWatchConnectIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return item.version === nativeHeartRateContractVersion
    && typeof item.installId === 'string'
    && /^wci_[0-9a-f]{64}$/u.test(item.installId)
    ? { version: nativeHeartRateContractVersion, installId: item.installId }
    : null;
}

function inactiveWatchConnect(reason?: string): NativeWatchConnectState {
  return {
    version: nativeHeartRateContractVersion,
    state: 'inactive',
    scope: null,
    connectionId: null,
    sessionId: null,
    connectedUntil: null,
    remainingMs: 0,
    requiresUserStart: true,
    workoutReady: false,
    relayConfigured: false,
    ...(reason ? { reason } : {}),
  };
}

function isUnimplementedNativeMethod(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('not implemented')
    || message.includes('unimplemented')
    || message.includes('no implementation')
    || message.includes('does not implement')
    || message.includes('not available on ios')
    || message.includes('method not found');
}

function normalizeRelayScope(value: unknown): NativeHeartRateRelayScope | null {
  return value === 'personal-session' || value === 'studio-block' || value === 'account-block'
    ? value
    : null;
}

function normalizeWorkoutRelayResult(value: unknown): NativeHeartRateWorkoutRelayResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.handled !== 'boolean' || typeof item.configured !== 'boolean') return null;
  const sessionId = item.sessionId == null ? '' : relaySessionId(item.sessionId);
  const scope = item.scope == null ? null : normalizeRelayScope(item.scope);
  const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) : '';
  if ((item.sessionId != null && !sessionId) || (item.scope != null && !scope)) return null;
  return {
    handled: item.handled,
    configured: item.configured,
    ...(sessionId ? { sessionId } : {}),
    ...(scope ? { scope } : {}),
    ...(item.queued === true ? { queued: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function normalizeNativeHeartRateStatus(value: unknown): NativeHeartRateStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<NativeHeartRateStatus>;
  const sessionId = candidate.sessionId == null
    ? null
    : typeof candidate.sessionId === 'string' && candidate.sessionId.trim()
      ? candidate.sessionId.trim()
      : undefined;
  const at = Number(candidate.at);
  if (
    candidate.version !== nativeHeartRateContractVersion
    || !candidate.state
    || !workoutStates.has(candidate.state)
    || sessionId === undefined
    || !Number.isFinite(at)
  ) {
    return null;
  }
  const message = typeof candidate.message === 'string' ? candidate.message.trim().slice(0, 500) : '';
  const relay = candidate.relay == null ? null : normalizeWorkoutRelayResult(candidate.relay);
  const watchConnect = candidate.watchConnect == null
    ? null
    : normalizeNativeWatchConnectState(candidate.watchConnect);
  if (candidate.relay != null && !relay) return null;
  if (candidate.watchConnect != null && !watchConnect) return null;
  return {
    version: nativeHeartRateContractVersion,
    state: candidate.state,
    sessionId,
    ...(message ? { message } : {}),
    at: Math.round(at),
    ...(relay ? { relay } : {}),
    ...(watchConnect ? { watchConnect } : {}),
  };
}

function normalizeAvailability(value: unknown): NativeHeartRateAvailability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<NativeHeartRateAvailability>;
  if (
    candidate.version !== nativeHeartRateContractVersion
    || typeof candidate.supported !== 'boolean'
    || !['iphone', 'ipad', 'other'].includes(candidate.platform ?? '')
    || typeof candidate.paired !== 'boolean'
    || typeof candidate.watchAppInstalled !== 'boolean'
    || typeof candidate.healthDataAvailable !== 'boolean'
  ) {
    return null;
  }
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 500) : '';
  return {
    version: nativeHeartRateContractVersion,
    supported: candidate.supported,
    ...(reason ? { reason } : {}),
    platform: candidate.platform!,
    paired: candidate.paired,
    watchAppInstalled: candidate.watchAppInstalled,
    healthDataAvailable: candidate.healthDataAvailable,
    minimumIOS: '17.0',
    minimumWatchOS: '10.0',
  };
}

function emptyListenerHandle(): PluginListenerHandle {
  return { remove: async () => undefined };
}

function normalizedRelayState(value: unknown, fallbackReason: string): NativeHeartRateRelayState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { configured: false, reason: fallbackReason };
  }
  const candidate = value as Partial<NativeHeartRateRelayState>;
  if (typeof candidate.configured !== 'boolean') {
    return { configured: false, reason: fallbackReason };
  }
  const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId.trim().slice(0, 160) : '';
  const scope = candidate.scope == null ? null : normalizeRelayScope(candidate.scope);
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 500) : '';
  const queued = candidate.queued === true;
  if ((candidate.configured && !sessionId) || (candidate.scope != null && !scope)) {
    return { configured: false, reason: fallbackReason };
  }
  return {
    configured: candidate.configured,
    ...(sessionId ? { sessionId } : {}),
    ...(scope ? { scope } : {}),
    ...(reason ? { reason } : {}),
    ...(queued ? { queued: true } : {}),
  };
}

function relayUnavailable(reason: string): NativeHeartRateRelayState {
  return { configured: false, reason };
}

const relaySessionStates = new Set<NativeHeartRateRelaySessionState['state']>([
  'active',
  'queued',
  'syncing',
  'retrying',
  'pending',
]);
const relayReasons = new Set<NativeHeartRateRelayReason>([
  'observing',
  'recovered',
  'configured',
  'queued',
  'cleared',
  'clearedAll',
  'syncing',
  'synced',
  'progress',
  'retryScheduled',
  'capacityLimited',
  'credentialMissing',
  'credentialRejected',
  'requestRejected',
  'invalidState',
]);

function relaySessionId(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized
    && normalized.length <= 160
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    ? normalized
    : '';
}

function relayCount(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function unavailableRelaySnapshot(reason?: NativeHeartRateRelayReason): NativeHeartRateRelaySnapshot {
  return {
    version: nativeHeartRateContractVersion,
    configured: false,
    syncing: false,
    clearing: false,
    queuedSessionIds: [],
    queuedCount: 0,
    pendingSampleCount: 0,
    droppedSampleCount: 0,
    sessions: [],
    ...(reason ? { reason } : {}),
  };
}

export function normalizeNativeHeartRateRelaySnapshot(value: unknown): NativeHeartRateRelaySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const version = relayCount(item.version);
  const queuedCount = relayCount(item.queuedCount);
  const pendingSampleCount = relayCount(item.pendingSampleCount);
  const droppedSampleCount = relayCount(item.droppedSampleCount);
  if (
    version == null
    || version < 1
    || typeof item.configured !== 'boolean'
    || typeof item.syncing !== 'boolean'
    || typeof item.clearing !== 'boolean'
    || queuedCount == null
    || pendingSampleCount == null
    || droppedSampleCount == null
    || !Array.isArray(item.queuedSessionIds)
    || !Array.isArray(item.sessions)
  ) return null;

  const sessionId = item.sessionId == null ? '' : relaySessionId(item.sessionId);
  const scope = item.scope == null ? null : normalizeRelayScope(item.scope);
  const syncingSessionId = item.syncingSessionId == null ? '' : relaySessionId(item.syncingSessionId);
  if (
    (item.sessionId != null && !sessionId)
    || (item.scope != null && !scope)
    || (item.syncingSessionId != null && !syncingSessionId)
  ) return null;
  const queuedSessionIds = item.queuedSessionIds.map(relaySessionId);
  if (queuedSessionIds.some((candidate) => !candidate) || new Set(queuedSessionIds).size !== queuedSessionIds.length) {
    return null;
  }
  const sessions: NativeHeartRateRelaySessionState[] = [];
  const seenSessionIds = new Set<string>();
  for (const candidate of item.sessions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const session = candidate as Record<string, unknown>;
    const normalizedSessionId = relaySessionId(session.sessionId);
    const sessionScope = session.scope == null
      ? 'personal-session'
      : normalizeRelayScope(session.scope);
    const state = session.state as NativeHeartRateRelaySessionState['state'];
    const sessionPendingCount = relayCount(session.pendingSampleCount);
    const sessionDroppedCount = relayCount(session.droppedSampleCount);
    if (
      !normalizedSessionId
      || !sessionScope
      || seenSessionIds.has(normalizedSessionId)
      || !relaySessionStates.has(state)
      || typeof session.finalized !== 'boolean'
      || typeof session.streamCreated !== 'boolean'
      || sessionPendingCount == null
      || sessionDroppedCount == null
    ) return null;
    seenSessionIds.add(normalizedSessionId);
    sessions.push({
      sessionId: normalizedSessionId,
      scope: sessionScope,
      state,
      finalized: session.finalized,
      pendingSampleCount: sessionPendingCount,
      droppedSampleCount: sessionDroppedCount,
      streamCreated: session.streamCreated,
    });
  }
  if (queuedCount !== queuedSessionIds.length || queuedSessionIds.some((id) => !seenSessionIds.has(id))) return null;
  const reason = relayReasons.has(item.reason as NativeHeartRateRelayReason)
    ? item.reason as NativeHeartRateRelayReason
    : undefined;
  return {
    version,
    configured: item.configured,
    syncing: item.syncing,
    clearing: item.clearing,
    queuedSessionIds,
    queuedCount,
    pendingSampleCount,
    droppedSampleCount,
    ...(sessionId ? { sessionId } : {}),
    ...(scope ? { scope } : {}),
    ...(syncingSessionId ? { syncingSessionId } : {}),
    sessions,
    ...(reason ? { reason } : {}),
  };
}

const maximumRelayActiveDurationMs = 7 * 24 * 60 * 60 * 1_000;
const maximumRelayZones = 500;

function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}

function containsControlCharacter(value: string) {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function normalizedRelayZones(
  zones: readonly NativeHeartRateRelayZone[] | undefined,
  activeDurationMs: number,
): NativeHeartRateRelayZone[] | undefined | null {
  if (zones === undefined) return undefined;
  if (!Array.isArray(zones) || zones.length > maximumRelayZones) return null;
  const normalized: NativeHeartRateRelayZone[] = [];
  const zoneIds = new Set<string>();
  let previousEndElapsedMs = 0;
  for (const zone of zones) {
    if (!zone || typeof zone !== 'object' || Array.isArray(zone)) return null;
    const zoneId = typeof zone.zoneId === 'string' ? zone.zoneId.trim() : '';
    const zoneName = typeof zone.zoneName === 'string' ? zone.zoneName.trim() : '';
    const startElapsedMs = Number(zone.startElapsedMs);
    const endElapsedMs = Number(zone.endElapsedMs);
    if (
      !zoneId
      || zoneId.length > 80
      || utf8Length(zoneId) > 80
      || !/^[a-zA-Z0-9:._-]+$/u.test(zoneId)
      || zoneIds.has(zoneId)
      || containsControlCharacter(zoneId)
      || (zoneName && (
        zoneName.length > 80
        || utf8Length(zoneName) > 80
        || containsControlCharacter(zoneName)
      ))
      || !Number.isFinite(startElapsedMs)
      || !Number.isFinite(endElapsedMs)
    ) return null;
    const roundedStartElapsedMs = Math.round(startElapsedMs);
    const roundedEndElapsedMs = Math.round(endElapsedMs);
    if (
      roundedStartElapsedMs < 0
      || roundedStartElapsedMs < previousEndElapsedMs
      || roundedEndElapsedMs <= roundedStartElapsedMs
      || roundedEndElapsedMs > activeDurationMs
    ) return null;
    zoneIds.add(zoneId);
    previousEndElapsedMs = roundedEndElapsedMs;
    normalized.push({
      zoneId,
      ...(zoneName ? { zoneName } : {}),
      startElapsedMs: roundedStartElapsedMs,
      endElapsedMs: roundedEndElapsedMs,
    });
  }
  return normalized;
}

function validRelayBaseUrl(value: string) {
  try {
    const url = new URL(value);
    const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.origin === value.replace(/\/$/, '') && (url.protocol === 'https:' || localDevelopment);
  } catch {
    return false;
  }
}

export function createNativeHeartRateClient({
  capacitor = Capacitor,
  plugin = nativePlugin,
}: {
  capacitor?: CapacitorFeatureDetector;
  plugin?: NativeHeartRatePlugin;
} = {}): NativeHeartRateClient {
  const isPluginAvailable = () => {
    try {
      return capacitor.isNativePlatform() && capacitor.isPluginAvailable(nativeHeartRatePluginName);
    } catch {
      return false;
    }
  };

  const unsupportedReason = () => {
    try {
      return capacitor.getPlatform() === 'ios'
        ? 'Apple Watch heart rate requires a newer TrackLab app build with the native heart-rate bridge.'
        : 'Apple Watch heart rate is available only in the native TrackLab app on a compatible iPhone.';
    } catch {
      return 'Apple Watch heart rate is unavailable in this TrackLab app build.';
    }
  };

  const getAvailability = async () => {
    if (!isPluginAvailable()) return unavailableAvailability(unsupportedReason());
    try {
      const availability = normalizeAvailability(await plugin.getAvailability());
      return availability ?? unavailableAvailability('The native heart-rate bridge returned an invalid availability response.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return unavailableAvailability(`Apple Watch availability could not be checked. ${message}`);
    }
  };

  const getState = async () => {
    if (!isPluginAvailable()) return unavailableStatus(unsupportedReason());
    try {
      return normalizeNativeHeartRateStatus(await plugin.getState())
        ?? unavailableStatus('The native heart-rate bridge returned an invalid workout state.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return unavailableStatus(`Apple Watch workout state could not be checked. ${message}`);
    }
  };

  const getRelayState = async () => {
    if (!isPluginAvailable() || !plugin.getRelayState) return unavailableRelaySnapshot();
    try {
      return normalizeNativeHeartRateRelaySnapshot(await plugin.getRelayState())
        ?? unavailableRelaySnapshot('invalidState');
    } catch {
      return unavailableRelaySnapshot('invalidState');
    }
  };

  const getWatchConnectIdentity = async () => {
    if (!isPluginAvailable() || !plugin.getWatchConnectIdentity) return null;
    try {
      return normalizeNativeWatchConnectIdentity(await plugin.getWatchConnectIdentity());
    } catch {
      return null;
    }
  };

  const getWatchConnectState = async () => {
    if (!isPluginAvailable() || !plugin.getWatchConnectState) {
      return inactiveWatchConnect(watchConnectLatestBuildReason);
    }
    try {
      return normalizeNativeWatchConnectState(await plugin.getWatchConnectState())
        ?? inactiveWatchConnect('Watch Connect returned an invalid status.');
    } catch (error) {
      if (isUnimplementedNativeMethod(error)) {
        return inactiveWatchConnect(watchConnectLatestBuildReason);
      }
      const message = error instanceof Error ? error.message : String(error);
      return inactiveWatchConnect(`Watch Connect status could not be checked. ${message}`);
    }
  };

  const runWorkoutAction = async (
    action: () => Promise<NativeHeartRateStatus>,
  ) => {
    if (!isPluginAvailable()) return unavailableStatus(unsupportedReason());
    try {
      return normalizeNativeHeartRateStatus(await action())
        ?? unavailableStatus('The native heart-rate bridge returned an invalid workout state.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        version: nativeHeartRateContractVersion,
        state: 'error' as const,
        sessionId: null,
        message,
        at: Date.now(),
      };
    }
  };

  return {
    isPluginAvailable,
    getAvailability,
    getState,
    getRelayState,
    getWatchConnectIdentity,
    getWatchConnectState,
    async startWatchConnect(options) {
      if (!isPluginAvailable()) return inactiveWatchConnect(unsupportedReason());
      if (!plugin.startWatchConnect) {
        return inactiveWatchConnect(watchConnectLatestBuildReason);
      }
      const connectionId = relaySessionId(options.connectionId);
      const pairingId = relaySessionId(options.pairingId);
      const relayId = relaySessionId(options.relaySessionId);
      const ingestToken = options.ingestToken.trim();
      const expiresAt = Math.round(Number(options.expiresAt));
      const now = Date.now();
      if (
        !['personal', 'studio'].includes(options.scope)
        || !connectionId
        || !pairingId
        || !relayId
        || !validRelayBaseUrl(options.baseUrl)
        || !ingestToken
        || ingestToken.length > 8_192
        || /\s/u.test(ingestToken)
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= now
        || expiresAt - now > watchConnectMaximumDurationMs + watchConnectMaximumClockSkewMs
      ) {
        return {
          ...inactiveWatchConnect('Watch Connect received an invalid four-hour connection.'),
          state: 'error',
        };
      }
      try {
        return normalizeNativeWatchConnectState(await plugin.startWatchConnect({
          scope: options.scope,
          connectionId,
          pairingId,
          relaySessionId: relayId,
          baseUrl: options.baseUrl.replace(/\/$/, ''),
          ingestToken,
          expiresAt,
        })) ?? {
          ...inactiveWatchConnect('Watch Connect returned an invalid status.'),
          state: 'error',
        };
      } catch (error) {
        if (isUnimplementedNativeMethod(error)) {
          return inactiveWatchConnect(watchConnectLatestBuildReason);
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ...inactiveWatchConnect(message), state: 'error' };
      }
    },
    async stopWatchConnect() {
      if (!isPluginAvailable()) return inactiveWatchConnect(unsupportedReason());
      if (!plugin.stopWatchConnect) {
        return inactiveWatchConnect(watchConnectLatestBuildReason);
      }
      try {
        return normalizeNativeWatchConnectState(await plugin.stopWatchConnect())
          ?? { ...inactiveWatchConnect('Watch Connect returned an invalid status.'), state: 'error' };
      } catch (error) {
        if (isUnimplementedNativeMethod(error)) {
          return inactiveWatchConnect(watchConnectLatestBuildReason);
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ...inactiveWatchConnect(message), state: 'error' };
      }
    },
    async startWorkout(sessionId) {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId || normalizedSessionId.length > 160) {
        return {
          version: nativeHeartRateContractVersion,
          state: 'error',
          sessionId: null,
          message: 'A valid TrackLab training session is required before starting Apple Watch heart rate.',
          at: Date.now(),
        };
      }
      return runWorkoutAction(() => plugin.startWorkout({ sessionId: normalizedSessionId }));
    },
    pauseWorkout: () => runWorkoutAction(() => plugin.pauseWorkout()),
    resumeWorkout: () => runWorkoutAction(() => plugin.resumeWorkout()),
    endWorkout: () => runWorkoutAction(() => plugin.endWorkout()),
    async configureRelay(options) {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.configureRelay) {
        return relayUnavailable('This TrackLab app build does not support background heart-rate relay.');
      }
      const sessionId = options.sessionId.trim();
      const ingestToken = options.ingestToken.trim();
      const scope = options.scope ?? 'personal-session';
      const activeElapsedAtStartMs = options.activeElapsedAtStartMs == null
        ? undefined
        : Number(options.activeElapsedAtStartMs);
      if (
        !sessionId
        || sessionId.length > 160
        || !ingestToken
        || ingestToken.length > 8_192
        || !validRelayBaseUrl(options.baseUrl)
        || !normalizeRelayScope(scope)
        || !Number.isFinite(options.startedAt)
        || options.startedAt < 0
        || (activeElapsedAtStartMs !== undefined && (
          !Number.isFinite(activeElapsedAtStartMs)
          || activeElapsedAtStartMs < 0
          || activeElapsedAtStartMs > maximumRelayActiveDurationMs
        ))
      ) {
        return relayUnavailable('TrackLab could not configure a valid private heart-rate relay.');
      }
      try {
        return normalizedRelayState(await plugin.configureRelay({
          baseUrl: options.baseUrl.replace(/\/$/, ''),
          ingestToken,
          sessionId,
          scope,
          startedAt: Math.round(options.startedAt),
          ...(activeElapsedAtStartMs !== undefined
            ? { activeElapsedAtStartMs: Math.round(activeElapsedAtStartMs) }
            : {}),
        }), 'The native heart-rate bridge returned an invalid relay response.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay could not be configured. ${message}`);
      }
    },
    async pauseRelay(options) {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.pauseRelay) {
        return relayUnavailable('This TrackLab app build does not support pausing its heart-rate relay clock.');
      }
      const sessionId = options.sessionId.trim();
      if (
        !sessionId
        || sessionId.length > 160
        || !Number.isFinite(options.at)
        || options.at < 0
        || !Number.isFinite(options.activeElapsedMs)
        || options.activeElapsedMs < 0
        || options.activeElapsedMs > maximumRelayActiveDurationMs
      ) return relayUnavailable('TrackLab could not pause an invalid heart-rate relay clock.');
      try {
        return normalizedRelayState(await plugin.pauseRelay({
          sessionId,
          at: Math.round(options.at),
          activeElapsedMs: Math.round(options.activeElapsedMs),
        }), 'The native heart-rate bridge returned an invalid relay response.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay clock could not be paused. ${message}`);
      }
    },
    async resumeRelay(options) {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.resumeRelay) {
        return relayUnavailable('This TrackLab app build does not support resuming its heart-rate relay clock.');
      }
      const sessionId = options.sessionId.trim();
      if (
        !sessionId
        || sessionId.length > 160
        || !Number.isFinite(options.at)
        || options.at < 0
        || !Number.isFinite(options.activeElapsedMs)
        || options.activeElapsedMs < 0
        || options.activeElapsedMs > maximumRelayActiveDurationMs
      ) return relayUnavailable('TrackLab could not resume an invalid heart-rate relay clock.');
      try {
        return normalizedRelayState(await plugin.resumeRelay({
          sessionId,
          at: Math.round(options.at),
          activeElapsedMs: Math.round(options.activeElapsedMs),
        }), 'The native heart-rate bridge returned an invalid relay response.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay clock could not be resumed. ${message}`);
      }
    },
    async finalizeRelay(options) {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.finalizeRelay) {
        return relayUnavailable('This TrackLab app build does not support background heart-rate relay.');
      }
      const activeDurationMs = Math.round(options.activeDurationMs);
      const zones = normalizedRelayZones(options.zones, activeDurationMs);
      const sessionId = options.sessionId.trim();
      if (
        !sessionId
        || sessionId.length > 160
        || !Number.isFinite(options.endedAt)
        || options.endedAt < 0
        || !Number.isFinite(options.activeDurationMs)
        || options.activeDurationMs < 0
        || activeDurationMs > maximumRelayActiveDurationMs
        || zones === null
      ) {
        return relayUnavailable('TrackLab could not finalize an invalid heart-rate relay.');
      }
      try {
        return normalizedRelayState(await plugin.finalizeRelay({
          sessionId,
          endedAt: Math.round(options.endedAt),
          activeDurationMs,
          ...(zones !== undefined ? { zones } : {}),
        }), 'The native heart-rate bridge returned an invalid relay response.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay could not be finalized. ${message}`);
      }
    },
    async clearRelay(options) {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.clearRelay) return relayUnavailable('This TrackLab app build does not support background heart-rate relay.');
      const sessionId = options.sessionId.trim();
      if (!sessionId || sessionId.length > 160) {
        return relayUnavailable('TrackLab could not clear an invalid heart-rate relay session.');
      }
      try {
        return normalizedRelayState(
          await plugin.clearRelay({ sessionId }),
          'The native heart-rate bridge returned an invalid relay response.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay could not be cleared. ${message}`);
      }
    },
    async clearAllRelays() {
      if (!isPluginAvailable()) return relayUnavailable(unsupportedReason());
      if (!plugin.clearAllRelays) {
        return relayUnavailable('This TrackLab app build cannot clear all private heart-rate relay data.');
      }
      try {
        return normalizedRelayState(
          await plugin.clearAllRelays(),
          'The native heart-rate bridge returned an invalid relay response.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return relayUnavailable(`Private heart-rate relay data could not be cleared. ${message}`);
      }
    },
    async addSampleListener(listener) {
      if (!isPluginAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeHeartRateSampleEvent, (event) => {
        if (event.version !== nativeHeartRateContractVersion) return;
        const sample = normalizeHeartRateMeasurement({
          source: event.source,
          sessionId: event.sessionId,
          sequence: event.sequence,
          bpm: event.bpm,
          recordedAt: event.measuredAt,
          receivedAt: event.receivedAt,
        });
        if (sample) listener(sample);
      });
    },
    async addStatusListener(listener) {
      if (!isPluginAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeHeartRateStatusEvent, (event) => {
        const status = normalizeNativeHeartRateStatus(event);
        if (status) listener(status);
      });
    },
    async addRelayStatusListener(listener) {
      if (!isPluginAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeHeartRateRelayStatusEvent, (event) => {
        const status = normalizeNativeHeartRateRelaySnapshot(event);
        if (status) listener(status);
      });
    },
  };
}

export const nativeHeartRate = createNativeHeartRateClient();
