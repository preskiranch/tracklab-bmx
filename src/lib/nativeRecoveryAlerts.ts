import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

export const nativeRecoveryAlertsPluginName = 'TrackLabRecoveryAlerts';
export const nativeRecoveryAlertStatusEvent = 'recoveryAlertStatus';
export const nativeRecoveryAlertReadyEvent = 'recoveryAlertReady';
export const nativeRecoveryAlertsContractVersion = 1 as const;
export const nativeRecoveryAlertsLatestBuildReason =
  'Install the latest TrackLab app build to use Recovery Alerts.';

let nativeRecoveryAccountBoundaryGeneration = 0;
let nativeRecoveryActiveAccountId: string | null = null;

/** A synchronous JS-side fence for async work that started before sign-out.
 * Native clear advances it before awaiting the bridge. */
export function getNativeRecoveryAccountBoundaryGeneration() {
  return nativeRecoveryAccountBoundaryGeneration;
}

export function openNativeRecoveryAccountBoundary(accountId: string) {
  nativeRecoveryAccountBoundaryGeneration += 1;
  nativeRecoveryActiveAccountId = normalizedRecoveryAccountId(accountId) || null;
  return nativeRecoveryAccountBoundaryGeneration;
}

export type NativeRecoveryMode = 'timer' | 'heart-rate' | 'smart';
export type NativeRecoveryActivityType = 'bmx-race' | 'straight-sprint' | 'get-pulled';
export type NativeRecoveryConfidence = 'fixed' | 'provisional' | 'personalized';
export type NativeRecoveryPermissionStatus =
  | 'not-determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'unavailable';

export type NativeRecoveryPermission = Readonly<{
  version: 1;
  supported: boolean;
  status: NativeRecoveryPermissionStatus;
  alertsEnabled: boolean;
  soundsEnabled: boolean;
  timeSensitiveEnabled: boolean;
  reason?: string;
}>;

/** The native bridge accepts the server episode without replacing absolute
 * timestamps with device-relative timers. `fallbackAt` is the hard deadline;
 * heart-rate readiness may occur sooner, but never before `notBeforeAt`. */
export type NativeRecoveryEpisode = Readonly<{
  id: string;
  activityType: NativeRecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  mode: NativeRecoveryMode;
  state: string;
  startedAt: number;
  notBeforeAt: number;
  plannedReadyAt: number | null;
  fallbackAt: number;
  readyAt: number | null;
  alertTrigger: NativeRecoveryAlertTrigger | null;
  targetBpm: number | null;
  reason: string | null;
  explanation?: string | null;
  confidence: NativeRecoveryConfidence;
  learningEpisodeCount: number;
  /** Server-authoritative revision clock. Native code uses this to reject a
   * delayed pre-extension directive after Add time has re-armed the episode. */
  updatedAt: number;
}>;

export type NativeRecoveryAlertPhase =
  | 'idle'
  | 'scheduled'
  | 'monitoring'
  | 'ready'
  | 'cancelled'
  | 'unavailable'
  | 'error';

export type NativeRecoveryAlertTrigger =
  | 'target'
  | 'planned'
  | 'fallback'
  | 'manual';

export type NativeRecoveryAlertState = Readonly<{
  version: 1;
  supported: boolean;
  state: NativeRecoveryAlertPhase;
  accountId: string | null;
  recoveryId: string | null;
  repetitionId: string | null;
  sessionId: string | null;
  mode: NativeRecoveryMode | null;
  notBeforeAt: number | null;
  plannedReadyAt: number | null;
  fallbackAt: number | null;
  readyAt: number | null;
  targetBpm: number | null;
  trigger?: NativeRecoveryAlertTrigger;
  message?: string;
  notificationPermission?: NativeRecoveryPermissionStatus;
}>;

export type NativeRecoveryAlertEvent = Readonly<{
  version: 1;
  accountId: string;
  recoveryId: string;
  repetitionId: string;
  sessionId: string;
  state: Exclude<NativeRecoveryAlertPhase, 'idle' | 'unavailable'>;
  trigger?: NativeRecoveryAlertTrigger;
  readyAt: number | null;
  triggeredAt: number;
  message: string;
}>;

export type NativeRecoveryAlertTarget = Readonly<{
  accountId: string;
  recoveryId: string;
  repetitionId: string;
}>;

export type NativeRecoveryAccountBinding = Readonly<{
  version: 1;
  supported: boolean;
  accountId: string;
  clearedCount: number;
}>;

export type NativeRecoveryAlertsPlugin = {
  requestPermission: () => Promise<NativeRecoveryPermission>;
  getPermissionStatus: () => Promise<NativeRecoveryPermission>;
  scheduleEpisode: (options: {
    accountId: string;
    episode: NativeRecoveryEpisode;
  }) => Promise<NativeRecoveryAlertState>;
  bindAccount: (options: { accountId: string }) => Promise<NativeRecoveryAccountBinding>;
  getActiveEpisode: (options: { accountId: string }) => Promise<NativeRecoveryAlertState>;
  cancelEpisode: (options: NativeRecoveryAlertTarget) => Promise<NativeRecoveryAlertState>;
  clearAllEpisodes: () => Promise<{ version: 1; supported: boolean; clearedCount: number }>;
  addListener: {
    (
      eventName: typeof nativeRecoveryAlertStatusEvent,
      listener: (event: NativeRecoveryAlertEvent) => void,
    ): Promise<PluginListenerHandle>;
    (
      eventName: typeof nativeRecoveryAlertReadyEvent,
      listener: (event: NativeRecoveryAlertEvent) => void,
    ): Promise<PluginListenerHandle>;
  };
};

type CapacitorFeatureDetector = Pick<
  typeof Capacitor,
  'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'
>;

export type NativeRecoveryAlertsClient = Readonly<{
  isPluginAvailable: () => boolean;
  requestPermission: () => Promise<NativeRecoveryPermission>;
  getPermissionStatus: () => Promise<NativeRecoveryPermission>;
  scheduleEpisode: (
    accountId: string,
    episode: NativeRecoveryEpisode,
  ) => Promise<NativeRecoveryAlertState>;
  /** Atomically retains this exact account and clears every foreign native
   * timer/Watch plan before JS opens its scheduling fence. */
  bindAccount: (accountId: string) => Promise<void>;
  getActiveEpisode: (accountId: string) => Promise<NativeRecoveryAlertState>;
  cancelEpisode: (target: NativeRecoveryAlertTarget) => Promise<NativeRecoveryAlertState>;
  /** Clears device-local Recovery Alerts at an account boundary. This never
   * changes the server episode and is intentionally safe on older shells. */
  clearAllEpisodes: () => Promise<void>;
  addStatusListener: (
    listener: (event: NativeRecoveryAlertEvent) => void,
  ) => Promise<PluginListenerHandle>;
  addReadyListener: (
    listener: (event: NativeRecoveryAlertEvent) => void,
  ) => Promise<PluginListenerHandle>;
}>;

const nativePlugin = registerPlugin<NativeRecoveryAlertsPlugin>(nativeRecoveryAlertsPluginName);
const modes = new Set<NativeRecoveryMode>(['timer', 'heart-rate', 'smart']);
const activities = new Set<NativeRecoveryActivityType>([
  'bmx-race',
  'straight-sprint',
  'get-pulled',
]);
const phases = new Set<NativeRecoveryAlertPhase>([
  'idle',
  'scheduled',
  'monitoring',
  'ready',
  'cancelled',
  'unavailable',
  'error',
]);
const triggers = new Set<NativeRecoveryAlertTrigger>([
  'target',
  'planned',
  'fallback',
  'manual',
]);
const permissionStatuses = new Set<NativeRecoveryPermissionStatus>([
  'not-determined',
  'denied',
  'authorized',
  'provisional',
  'ephemeral',
  'unavailable',
]);

function emptyListenerHandle(): PluginListenerHandle {
  return { remove: async () => undefined };
}

function normalizedOpaqueId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized
    && new TextEncoder().encode(normalized).length <= 160
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    ? normalized
    : '';
}

function normalizedRecoveryAccountId(value: unknown): string {
  const normalized = normalizedOpaqueId(value);
  return /^recacct_[0-9a-f]{32}$/u.test(normalized) ? normalized : '';
}

function epoch(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(Math.round(number)) && number >= 0
    ? Math.round(number)
    : null;
}

function unavailableReason(capacitor: CapacitorFeatureDetector): string {
  try {
    return capacitor.getPlatform() === 'ios'
      ? nativeRecoveryAlertsLatestBuildReason
      : 'Recovery notifications are available in the native TrackLab app.';
  } catch {
    return nativeRecoveryAlertsLatestBuildReason;
  }
}

function unavailablePermission(reason: string): NativeRecoveryPermission {
  return {
    version: nativeRecoveryAlertsContractVersion,
    supported: false,
    status: 'unavailable',
    alertsEnabled: false,
    soundsEnabled: false,
    timeSensitiveEnabled: false,
    reason,
  };
}

function idleState(
  supported: boolean,
  state: NativeRecoveryAlertPhase = supported ? 'idle' : 'unavailable',
  message?: string,
): NativeRecoveryAlertState {
  return {
    version: nativeRecoveryAlertsContractVersion,
    supported,
    state,
    accountId: null,
    recoveryId: null,
    repetitionId: null,
    sessionId: null,
    mode: null,
    notBeforeAt: null,
    plannedReadyAt: null,
    fallbackAt: null,
    readyAt: null,
    targetBpm: null,
    ...(message ? { message } : {}),
  };
}

export function normalizeNativeRecoveryPermission(value: unknown): NativeRecoveryPermission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const status = item.status as NativeRecoveryPermissionStatus;
  if (
    item.version !== nativeRecoveryAlertsContractVersion
    || typeof item.supported !== 'boolean'
    || !permissionStatuses.has(status)
    || typeof item.alertsEnabled !== 'boolean'
    || typeof item.soundsEnabled !== 'boolean'
    || typeof item.timeSensitiveEnabled !== 'boolean'
  ) return null;
  const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) : '';
  return {
    version: nativeRecoveryAlertsContractVersion,
    supported: item.supported,
    status,
    alertsEnabled: item.alertsEnabled,
    soundsEnabled: item.soundsEnabled,
    timeSensitiveEnabled: item.timeSensitiveEnabled,
    ...(reason ? { reason } : {}),
  };
}

export function normalizeNativeRecoveryAlertState(value: unknown): NativeRecoveryAlertState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const state = item.state as NativeRecoveryAlertPhase;
  const mode = item.mode == null ? null : item.mode as NativeRecoveryMode;
  const accountId = item.accountId == null ? null : normalizedRecoveryAccountId(item.accountId);
  const recoveryId = item.recoveryId == null ? null : normalizedOpaqueId(item.recoveryId);
  const repetitionId = item.repetitionId == null ? null : normalizedOpaqueId(item.repetitionId);
  const sessionId = item.sessionId == null ? null : normalizedOpaqueId(item.sessionId);
  const notBeforeAt = epoch(item.notBeforeAt);
  const plannedReadyAt = epoch(item.plannedReadyAt);
  const fallbackAt = epoch(item.fallbackAt);
  const readyAt = epoch(item.readyAt);
  const targetBpm = item.targetBpm == null ? null : Number(item.targetBpm);
  const trigger = item.trigger == null ? undefined : item.trigger as NativeRecoveryAlertTrigger;
  const notificationPermission = item.notificationPermission == null
    ? undefined
    : item.notificationPermission as NativeRecoveryPermissionStatus;
  if (
    item.version !== nativeRecoveryAlertsContractVersion
    || typeof item.supported !== 'boolean'
    || !phases.has(state)
    || (mode != null && !modes.has(mode))
    || (item.accountId != null && !accountId)
    || (item.recoveryId != null && !recoveryId)
    || (item.repetitionId != null && !repetitionId)
    || (item.sessionId != null && !sessionId)
    || (item.notBeforeAt != null && notBeforeAt == null)
    || (item.plannedReadyAt != null && plannedReadyAt == null)
    || (item.fallbackAt != null && fallbackAt == null)
    || (item.readyAt != null && readyAt == null)
    || (targetBpm != null && (!Number.isFinite(targetBpm) || targetBpm < 30 || targetBpm > 240))
    || (trigger != null && !triggers.has(trigger))
    || (notificationPermission != null && !permissionStatuses.has(notificationPermission))
  ) return null;
  const message = typeof item.message === 'string' ? item.message.trim().slice(0, 500) : '';
  return {
    version: nativeRecoveryAlertsContractVersion,
    supported: item.supported,
    state,
    accountId,
    recoveryId,
    repetitionId,
    sessionId,
    mode,
    notBeforeAt,
    plannedReadyAt,
    fallbackAt,
    readyAt,
    targetBpm,
    ...(trigger ? { trigger } : {}),
    ...(message ? { message } : {}),
    ...(notificationPermission ? { notificationPermission } : {}),
  };
}

export function normalizeNativeRecoveryAlertEvent(value: unknown): NativeRecoveryAlertEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const accountId = normalizedRecoveryAccountId(item.accountId);
  const recoveryId = normalizedOpaqueId(item.recoveryId);
  const repetitionId = normalizedOpaqueId(item.repetitionId);
  const sessionId = normalizedOpaqueId(item.sessionId);
  const state = item.state as NativeRecoveryAlertEvent['state'];
  const trigger = item.trigger == null ? undefined : item.trigger as NativeRecoveryAlertTrigger;
  const readyAt = epoch(item.readyAt);
  const triggeredAt = epoch(item.triggeredAt);
  if (
    item.version !== nativeRecoveryAlertsContractVersion
    || !accountId
    || !recoveryId
    || !repetitionId
    || !sessionId
    || !['scheduled', 'monitoring', 'ready', 'cancelled', 'error'].includes(state)
    || (trigger != null && !triggers.has(trigger))
    || (item.readyAt != null && readyAt == null)
    || triggeredAt == null
    || typeof item.message !== 'string'
  ) return null;
  return {
    version: nativeRecoveryAlertsContractVersion,
    accountId,
    recoveryId,
    repetitionId,
    sessionId,
    state,
    ...(trigger ? { trigger } : {}),
    readyAt,
    triggeredAt,
    message: item.message.trim().slice(0, 500),
  };
}

function normalizeEpisode(episode: NativeRecoveryEpisode): NativeRecoveryEpisode | null {
  const id = normalizedOpaqueId(episode.id);
  const sessionId = normalizedOpaqueId(episode.sessionId);
  const repetitionId = normalizedOpaqueId(episode.repetitionId);
  const startedAt = epoch(episode.startedAt);
  const notBeforeAt = epoch(episode.notBeforeAt);
  const plannedReadyAt = epoch(episode.plannedReadyAt);
  const fallbackAt = epoch(episode.fallbackAt);
  const readyAt = epoch(episode.readyAt);
  const alertTrigger = episode.alertTrigger;
  const targetBpm = episode.targetBpm == null ? null : Number(episode.targetBpm);
  const learningEpisodeCount = Number(episode.learningEpisodeCount);
  const updatedAt = epoch(episode.updatedAt);
  const confidence = episode.confidence;
  if (
    !id
    || !sessionId
    || !repetitionId
    || !activities.has(episode.activityType)
    || !modes.has(episode.mode)
    || startedAt == null
    || notBeforeAt == null
    || fallbackAt == null
    || notBeforeAt < startedAt
    || fallbackAt < notBeforeAt
    || (plannedReadyAt != null && (plannedReadyAt < notBeforeAt || plannedReadyAt > fallbackAt))
    || (readyAt != null && (readyAt < startedAt || readyAt > fallbackAt + 60_000))
    || (alertTrigger != null && !triggers.has(alertTrigger))
    || (episode.mode === 'heart-rate' && (targetBpm == null || targetBpm < 30 || targetBpm > 240))
    || (targetBpm != null && (!Number.isFinite(targetBpm) || targetBpm < 30 || targetBpm > 240))
    || !Number.isSafeInteger(learningEpisodeCount)
    || learningEpisodeCount < 0
    || updatedAt == null
    || !['fixed', 'provisional', 'personalized'].includes(confidence)
  ) return null;
  return {
    ...episode,
    id,
    sessionId,
    repetitionId,
    startedAt,
    notBeforeAt,
    plannedReadyAt,
    fallbackAt,
    readyAt,
    targetBpm,
    confidence,
    learningEpisodeCount,
    updatedAt,
    state: String(episode.state ?? '').trim().slice(0, 80),
    reason: episode.reason == null ? null : String(episode.reason).trim().slice(0, 500),
    explanation: episode.explanation == null
      ? null
      : String(episode.explanation).trim().slice(0, 500),
  };
}

export function createNativeRecoveryAlertsClient({
  capacitor = Capacitor,
  plugin = nativePlugin,
}: {
  capacitor?: CapacitorFeatureDetector;
  plugin?: NativeRecoveryAlertsPlugin;
} = {}): NativeRecoveryAlertsClient {
  const isPluginAvailable = () => {
    try {
      return capacitor.isNativePlatform()
        && capacitor.isPluginAvailable(nativeRecoveryAlertsPluginName);
    } catch {
      return false;
    }
  };
  const reason = () => unavailableReason(capacitor);

  const permissionAction = async (
    action: () => Promise<NativeRecoveryPermission>,
  ): Promise<NativeRecoveryPermission> => {
    if (!isPluginAvailable()) return unavailablePermission(reason());
    try {
      return normalizeNativeRecoveryPermission(await action())
        ?? unavailablePermission('Recovery notification settings returned an invalid response.');
    } catch (error) {
      return unavailablePermission(
        `Recovery notification settings could not be checked. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return {
    isPluginAvailable,
    requestPermission: () => permissionAction(() => plugin.requestPermission()),
    getPermissionStatus: () => permissionAction(() => plugin.getPermissionStatus()),
    async bindAccount(accountId) {
      const normalizedAccountId = normalizedRecoveryAccountId(accountId);
      if (!normalizedAccountId) throw new Error('Recovery Alert received an invalid account binding.');
      if (!isPluginAvailable()) return;
      const result = await plugin.bindAccount({ accountId: normalizedAccountId });
      if (
        result?.version !== nativeRecoveryAlertsContractVersion
        || result.supported !== true
        || normalizedRecoveryAccountId(result.accountId) !== normalizedAccountId
        || !Number.isSafeInteger(result.clearedCount)
        || result.clearedCount < 0
      ) throw new Error('Recovery Alert could not bind the authenticated account.');
    },
    async scheduleEpisode(accountId, episode) {
      const normalizedAccountId = normalizedRecoveryAccountId(accountId);
      const normalizedEpisode = normalizeEpisode(episode);
      if (!normalizedAccountId || !normalizedEpisode) {
        return idleState(true, 'error', 'Recovery Alert received an invalid recovery plan.');
      }
      if (nativeRecoveryActiveAccountId !== normalizedAccountId) {
        return idleState(true, 'error', 'Recovery Alert paused while the account changes.');
      }
      if (!isPluginAvailable()) return idleState(false, 'unavailable', reason());
      try {
        return normalizeNativeRecoveryAlertState(await plugin.scheduleEpisode({
          accountId: normalizedAccountId,
          episode: normalizedEpisode,
        })) ?? idleState(true, 'error', 'Recovery Alert returned an invalid status.');
      } catch (error) {
        return idleState(true, 'error', error instanceof Error ? error.message : String(error));
      }
    },
    async getActiveEpisode(accountId) {
      if (!isPluginAvailable()) return idleState(false, 'unavailable', reason());
      const normalizedAccountId = normalizedRecoveryAccountId(accountId);
      if (!normalizedAccountId) return idleState(true, 'error', 'Choose an athlete first.');
      try {
        return normalizeNativeRecoveryAlertState(await plugin.getActiveEpisode({
          accountId: normalizedAccountId,
        })) ?? idleState(true, 'error', 'Recovery Alert returned an invalid status.');
      } catch (error) {
        return idleState(true, 'error', error instanceof Error ? error.message : String(error));
      }
    },
    async cancelEpisode(target) {
      if (!isPluginAvailable()) return idleState(false, 'unavailable', reason());
      const accountId = normalizedRecoveryAccountId(target.accountId);
      const recoveryId = normalizedOpaqueId(target.recoveryId);
      const repetitionId = normalizedOpaqueId(target.repetitionId);
      if (!accountId || !recoveryId || !repetitionId) {
        return idleState(true, 'error', 'Recovery Alert could not cancel an invalid repetition.');
      }
      try {
        return normalizeNativeRecoveryAlertState(await plugin.cancelEpisode({
          accountId,
          recoveryId,
          repetitionId,
        })) ?? idleState(true, 'error', 'Recovery Alert returned an invalid status.');
      } catch (error) {
        return idleState(true, 'error', error instanceof Error ? error.message : String(error));
      }
    },
    async clearAllEpisodes() {
      nativeRecoveryAccountBoundaryGeneration += 1;
      nativeRecoveryActiveAccountId = null;
      if (!isPluginAvailable()) return;
      try {
        await plugin.clearAllEpisodes();
      } catch {
        // Build 6 and older do not expose this method. Account navigation must
        // still complete; those shells also cannot persist Recovery Alerts.
      }
    },
    async addStatusListener(listener) {
      if (!isPluginAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeRecoveryAlertStatusEvent, (event) => {
        const normalized = normalizeNativeRecoveryAlertEvent(event);
        if (normalized) listener(normalized);
      });
    },
    async addReadyListener(listener) {
      if (!isPluginAvailable()) return emptyListenerHandle();
      return plugin.addListener(nativeRecoveryAlertReadyEvent, (event) => {
        const normalized = normalizeNativeRecoveryAlertEvent(event);
        if (normalized) listener(normalized);
      });
    },
  };
}

export const nativeRecoveryAlerts = createNativeRecoveryAlertsClient();
