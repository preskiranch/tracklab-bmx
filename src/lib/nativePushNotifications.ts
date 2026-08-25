import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';
import {
  PushNotifications,
  type ActionPerformed,
  type PermissionStatus,
  type PushNotificationSchema,
  type PushNotificationsPlugin,
  type RegistrationError,
  type Token,
} from '@capacitor/push-notifications';

export const nativePushInstallationPluginName = 'TrackLabPushInstallation';
export const nativePushProtocolVersion = 1 as const;
export const nativePushRequestTimeoutMs = 12_000;
export const nativePushDeliveryCleanupTimeoutMs = 1_800;

export type NativePushPermission = PermissionStatus['receive'];
export type NativePushEnvironment = 'sandbox' | 'production';
export type NativePushKind =
  | 'live_audio_invite'
  | 'friend_request'
  | 'friend_connection'
  | 'track_share';

export type NativePushInstallation = Readonly<{
  version: 1;
  installationId: string;
  credential: string;
  environment: NativePushEnvironment;
  appBuild?: string;
  osVersion?: string;
}>;

export type NativePushRoute = Readonly<{
  v: 1;
  kind: NativePushKind;
  notificationId: string;
  route: 'friends';
}>;

export type NativePushPreferences = Readonly<{
  liveAudio: boolean;
  friendRequests: boolean;
  friendConnections: boolean;
  trackShares: boolean;
}>;

export type NativePushInstallationPlugin = {
  getInstallation: () => Promise<unknown>;
  openSettings: () => Promise<void>;
  clearDeliveredSocialNotifications: () => Promise<unknown>;
};

export type NativePushClient = Readonly<{
  isNativeIos: () => boolean;
  isAvailable: () => boolean;
  checkPermission: () => Promise<NativePushPermission>;
  requestPermission: () => Promise<NativePushPermission>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
  getInstallation: () => Promise<NativePushInstallation>;
  openSettings: () => Promise<void>;
  loadPreferences: () => Promise<NativePushPreferences>;
  savePreferences: (patch: Partial<NativePushPreferences>) => Promise<NativePushPreferences>;
  bindInstallation: (installation: NativePushInstallation, deviceToken: string) => Promise<void>;
  removeInstallation: (installation: NativePushInstallation) => Promise<void>;
  clearDeliveredSocialNotifications: () => Promise<void>;
  cancelRequests: () => void;
  addRegistrationListener: (listener: (token: string) => void) => Promise<PluginListenerHandle>;
  addRegistrationErrorListener: (listener: (message: string) => void) => Promise<PluginListenerHandle>;
  addReceivedListener: (listener: (route: NativePushRoute) => void) => Promise<PluginListenerHandle>;
  addActionListener: (listener: (route: NativePushRoute) => void) => Promise<PluginListenerHandle>;
}>;

type CapacitorDetector = Pick<typeof Capacitor, 'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'>;

const installationPlugin = registerPlugin<NativePushInstallationPlugin>(nativePushInstallationPluginName);
const preferenceKeys = ['liveAudio', 'friendRequests', 'friendConnections', 'trackShares'] as const;
const pushKinds = new Set<NativePushKind>([
  'live_audio_invite',
  'friend_request',
  'friend_connection',
  'track_share',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : '';
}

export function normalizeNativePushInstallation(value: unknown): NativePushInstallation | null {
  const item = record(value);
  if (!item || item.version !== nativePushProtocolVersion) return null;
  const installationId = text(item.installationId, 36).toLowerCase();
  const credential = text(item.credential, 43);
  const environment = item.environment === 'sandbox' || item.environment === 'production'
    ? item.environment
    : null;
  const appBuild = text(item.appBuild, 24);
  const osVersion = text(item.osVersion, 32);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(installationId)
    || !/^[A-Za-z0-9_-]{43}$/u.test(credential)
    || !environment
  ) return null;
  return {
    version: 1,
    installationId,
    credential,
    environment,
    ...(appBuild ? { appBuild } : {}),
    ...(osVersion ? { osVersion } : {}),
  };
}

export function normalizeNativePushDeviceToken(value: unknown) {
  const token = text(value, 512).replace(/[<>\s]/gu, '').toLowerCase();
  return token.length >= 32 && token.length <= 512 && token.length % 2 === 0 && /^[0-9a-f]+$/u.test(token)
    ? token
    : '';
}

export function normalizeNativePushRoute(value: unknown): NativePushRoute | null {
  const item = record(value);
  const kind = item?.kind;
  const notificationId = text(item?.notificationId, 160);
  if (
    item?.v !== nativePushProtocolVersion
    || typeof kind !== 'string'
    || !pushKinds.has(kind as NativePushKind)
    || !/^[a-f0-9-]{32,64}$/iu.test(notificationId)
    || item.route !== 'friends'
  ) return null;
  return { v: 1, kind: kind as NativePushKind, notificationId, route: 'friends' };
}

export function normalizeNativePushPreferences(value: unknown): NativePushPreferences | null {
  const envelope = record(value);
  const item = record(envelope?.preferences);
  if (!item || preferenceKeys.some((key) => typeof item[key] !== 'boolean')) return null;
  return {
    liveAudio: item.liveAudio as boolean,
    friendRequests: item.friendRequests as boolean,
    friendConnections: item.friendConnections as boolean,
    trackShares: item.trackShares as boolean,
  };
}

function normalizePreferencePatch(value: Partial<NativePushPreferences>) {
  const entries = preferenceKeys.flatMap((key) => (
    typeof value[key] === 'boolean' ? [[key, value[key]] as const] : []
  ));
  if (entries.length === 0) throw new Error('Choose a notification preference to update.');
  return Object.fromEntries(entries) as Partial<NativePushPreferences>;
}

function safeError(value: unknown, fallback: string) {
  const item = record(value);
  return text(item?.error, 240) || fallback;
}

async function responsePayload(response: Response, label: string) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(safeError(payload, `${label} returned ${response.status}.`));
  return payload;
}

function requestOptions(options: RequestInit = {}): RequestInit {
  return {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  };
}

export async function settleNativePushStep(operation: Promise<unknown>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.resolve(operation).then(() => true, () => true);
  const expired = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const finished = await Promise.race([settled, expired]);
  if (timeout) clearTimeout(timeout);
  return finished;
}

export async function unregisterAndClearDeliveredSocialNotifications(
  client: Pick<NativePushClient, 'unregister' | 'clearDeliveredSocialNotifications'>,
  timeoutMs = nativePushDeliveryCleanupTimeoutMs,
) {
  // Capacitor unregister is invoked first and normally resolves on the main
  // queue. Do not let a missing bridge acknowledgement prevent the separate,
  // cold-safe native cleanup from removing this account's delivered items.
  const unregisterBudget = Math.min(400, Math.max(0, timeoutMs));
  const unregistered = await settleNativePushStep(
    Promise.resolve().then(() => client.unregister()),
    unregisterBudget,
  );
  const cleared = await settleNativePushStep(
    Promise.resolve().then(() => client.clearDeliveredSocialNotifications()),
    Math.max(0, timeoutMs - unregisterBudget),
  );
  return unregistered && cleared;
}

async function nativePushFetch(
  fetcher: typeof fetch,
  controllers: Set<AbortController>,
  input: RequestInfo | URL,
  options: RequestInit = {},
) {
  const controller = new AbortController();
  controllers.add(controller);
  let rejectAborted: ((reason: Error) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const abort = () => rejectAborted?.(new Error('The notification request timed out. Please try again.'));
  controller.signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), nativePushRequestTimeoutMs);
  try {
    return await Promise.race([
      fetcher(input, { ...requestOptions(options), signal: controller.signal }),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', abort);
    controllers.delete(controller);
  }
}

export function createNativePushClient({
  capacitor = Capacitor,
  push = PushNotifications,
  native = installationPlugin,
  fetcher = fetch,
}: {
  capacitor?: CapacitorDetector;
  push?: PushNotificationsPlugin;
  native?: NativePushInstallationPlugin;
  fetcher?: typeof fetch;
} = {}): NativePushClient {
  const requestControllers = new Set<AbortController>();
  const isNativeIos = () => capacitor.getPlatform() === 'ios' && capacitor.isNativePlatform();
  const isAvailable = () => isNativeIos()
    && capacitor.isPluginAvailable('PushNotifications')
    && capacitor.isPluginAvailable(nativePushInstallationPluginName);

  const requireAvailable = () => {
    if (!isAvailable()) throw new Error('Install TrackLab app build 12 or later to use notifications.');
  };

  const permission = async (operation: () => Promise<PermissionStatus>) => {
    requireAvailable();
    const result = await operation();
    if (!['prompt', 'prompt-with-rationale', 'granted', 'denied'].includes(result.receive)) {
      throw new Error('iOS returned an invalid notification permission status.');
    }
    return result.receive;
  };

  const getInstallation = async () => {
    requireAvailable();
    const value = normalizeNativePushInstallation(await native.getInstallation());
    if (!value) throw new Error('TrackLab could not verify this app installation.');
    return value;
  };

  return {
    isNativeIos,
    isAvailable,
    checkPermission: () => permission(() => push.checkPermissions()),
    requestPermission: () => permission(() => push.requestPermissions()),
    async register() {
      requireAvailable();
      await push.register();
    },
    async unregister() {
      if (!isAvailable()) return;
      await push.unregister();
    },
    getInstallation,
    async openSettings() {
      requireAvailable();
      await native.openSettings();
    },
    async loadPreferences() {
      const response = await nativePushFetch(fetcher, requestControllers, '/api/push/preferences');
      const preferences = normalizeNativePushPreferences(await responsePayload(response, 'Notification settings'));
      if (!preferences) throw new Error('Notification settings returned an invalid response.');
      return preferences;
    },
    async savePreferences(value) {
      const response = await nativePushFetch(fetcher, requestControllers, '/api/push/preferences', {
        method: 'PATCH',
        body: JSON.stringify(normalizePreferencePatch(value)),
      });
      const preferences = normalizeNativePushPreferences(await responsePayload(response, 'Notification settings'));
      if (!preferences) throw new Error('Notification settings returned an invalid response.');
      return preferences;
    },
    async bindInstallation(value, rawToken) {
      const verified = normalizeNativePushInstallation(value);
      const deviceToken = normalizeNativePushDeviceToken(rawToken);
      if (!verified || !deviceToken) throw new Error('TrackLab could not verify this device for notifications.');
      const response = await nativePushFetch(
        fetcher,
        requestControllers,
        `/api/push/installations/${encodeURIComponent(verified.installationId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            credential: verified.credential,
            deviceToken,
            environment: verified.environment,
            permissionStatus: 'granted',
            protocolVersion: nativePushProtocolVersion,
            ...(verified.appBuild ? { appBuild: verified.appBuild } : {}),
            ...(verified.osVersion ? { osVersion: verified.osVersion } : {}),
          }),
        },
      );
      const payload = record(await responsePayload(response, 'Notification registration'));
      const saved = record(payload?.installation);
      if (
        !saved
        || text(saved.id, 160) !== verified.installationId
        || saved.environment !== verified.environment
        || saved.permissionStatus !== 'granted'
        || !text(saved.registeredAt, 40)
        || !text(saved.lastSeenAt, 40)
      ) throw new Error('Notification registration returned an invalid response.');
    },
    async removeInstallation(value) {
      const verified = normalizeNativePushInstallation(value);
      if (!verified) throw new Error('TrackLab could not verify this device for notifications.');
      const response = await nativePushFetch(
        fetcher,
        requestControllers,
        `/api/push/installations/${encodeURIComponent(verified.installationId)}`,
        { method: 'DELETE', body: JSON.stringify({ credential: verified.credential }) },
      );
      const payload = record(await responsePayload(response, 'Notification removal'));
      if (payload?.removed !== true) throw new Error('Notification removal returned an invalid response.');
    },
    async clearDeliveredSocialNotifications() {
      requireAvailable();
      const payload = record(await native.clearDeliveredSocialNotifications());
      if (!Number.isSafeInteger(payload?.removed) || Number(payload?.removed) < 0) {
        throw new Error('Notification Center cleanup returned an invalid response.');
      }
    },
    cancelRequests() {
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
    },
    addRegistrationListener(listener) {
      requireAvailable();
      return push.addListener('registration', (token: Token) => {
        const normalized = normalizeNativePushDeviceToken(token.value);
        if (normalized) listener(normalized);
      });
    },
    addRegistrationErrorListener(listener) {
      requireAvailable();
      return push.addListener('registrationError', (error: RegistrationError) => {
        listener(text(error.error, 240) || 'iOS could not register this device for notifications.');
      });
    },
    addReceivedListener(listener) {
      requireAvailable();
      return push.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
        const route = normalizeNativePushRoute(notification.data);
        if (route) listener(route);
      });
    },
    addActionListener(listener) {
      requireAvailable();
      return push.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
        const route = normalizeNativePushRoute(action.notification.data);
        if (route) listener(route);
      });
    },
  };
}

/** Stops OS delivery and consumes retained social actions when this shell is a
 * Club Tablet rather than a personal account. Server cleanup remains owned by
 * the authenticated pre-logout boundary. */
export async function disableNativePushDelivery(client = createNativePushClient()) {
  if (!client.isAvailable()) return;
  const handles: PluginListenerHandle[] = [];
  let acceptingHandles = true;
  const addHandle = async (pending: Promise<PluginListenerHandle>) => {
    try {
      const handle = await pending;
      if (acceptingHandles) handles.push(handle);
      else await handle.remove();
    } catch {
      // Cleanup below is independent of retained-action listener availability.
    }
  };
  const listenerSetup = Promise.allSettled([
    addHandle(client.addReceivedListener(() => undefined)),
    addHandle(client.addActionListener(() => undefined)),
  ]);
  // Give the official plugin a brief chance to drain a retained cold action,
  // without allowing a stalled listener bridge to block kiosk privacy cleanup.
  await settleNativePushStep(listenerSetup, 150);
  acceptingHandles = false;
  await unregisterAndClearDeliveredSocialNotifications(client);
  await Promise.allSettled(handles.map((handle) => handle.remove()));
}
