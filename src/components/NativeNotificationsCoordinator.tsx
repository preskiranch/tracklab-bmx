import { Bell, BellOff, ExternalLink, RefreshCcw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createNativePushClient,
  nativePushDeliveryCleanupTimeoutMs,
  settleNativePushStep,
  unregisterAndClearDeliveredSocialNotifications,
  type NativePushClient,
  type NativePushInstallation,
  type NativePushPermission,
  type NativePushPreferences,
  type NativePushRoute,
} from '../lib/nativePushNotifications';
import './NativeNotificationsCoordinator.css';

export const nativeNotificationsSettingsSlotId = 'native-notifications-settings-slot';

export type NativeNotificationsCoordinatorProps = Readonly<{
  accountId: string | null;
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  kioskMode: boolean;
  settingsOpen: boolean;
  onFriendsActivity: (opened: boolean) => void;
  client?: NativePushClient;
}>;

const preferenceCopy: ReadonlyArray<{
  key: keyof NativePushPreferences;
  label: string;
  detail: string;
}> = [
  { key: 'liveAudio', label: 'Live audio invitations', detail: 'A friend can alert you to a short private conversation.' },
  { key: 'friendRequests', label: 'Friend requests', detail: 'Know when another rider asks to connect.' },
  { key: 'friendConnections', label: 'New friend connections', detail: 'Know when a pending request is accepted.' },
  { key: 'trackShares', label: 'Shared tracks', detail: 'Know when a friend shares a mapped track.' },
];

export function nativePushForegroundCopy(kind: NativePushRoute['kind']) {
  if (kind === 'live_audio_invite') return null;
  if (kind === 'friend_request') return {
    title: 'New friend request',
    detail: 'Open Friends to review the request.',
  };
  if (kind === 'friend_connection') return {
    title: 'New friend connection',
    detail: 'A friend request was accepted.',
  };
  return {
    title: 'A friend shared a track',
    detail: 'Open Friends to review the shared track.',
  };
}

let activeNativePushBoundary: Readonly<{
  accountId: string;
  client: NativePushClient;
  installation: NativePushInstallation;
}> | null = null;
const nativePushBindFlights = new Map<string, Set<Promise<void>>>();
export const nativePushLogoutCleanupTimeoutMs = 2_000;

export function resolveNativePushAccountBoundary(
  authStatus: NativeNotificationsCoordinatorProps['authStatus'],
  accountId: string | null,
  kioskMode: boolean,
): string | null | undefined {
  if (authStatus === 'loading') return undefined;
  return authStatus === 'signed-in' && accountId && !kioskMode ? accountId : null;
}

export async function settleNativePushCleanup(
  operation: Promise<unknown>,
  onTimeout: () => void,
  timeoutMs = nativePushLogoutCleanupTimeoutMs,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = Promise.resolve(operation).then(() => true, () => true);
  const expired = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const finished = await Promise.race([completed, expired]);
  if (timeout) clearTimeout(timeout);
  if (!finished) onTimeout();
  return finished;
}

export async function cleanupNativePushBoundary(
  client: Pick<NativePushClient,
    'cancelRequests' | 'removeInstallation' | 'unregister' | 'clearDeliveredSocialNotifications'>,
  installation: NativePushInstallation,
  flights: Iterable<Promise<void>> = [],
  timeoutMs = nativePushLogoutCleanupTimeoutMs,
) {
  client.cancelRequests();
  const cleanup = Promise.allSettled([
    ...flights,
    Promise.resolve().then(() => client.removeInstallation(installation)),
    unregisterAndClearDeliveredSocialNotifications(client, Math.max(0, timeoutMs - 200)),
  ]);
  return settleNativePushCleanup(cleanup, () => client.cancelRequests(), timeoutMs);
}

/** Removes only delivered TrackLab social remote notifications after the
 * server's logout transaction has finished. Native filtering deliberately
 * leaves Recovery alerts and notifications from other apps/features alone. */
export async function clearNativePushDeliveredSocialBoundary(
  client: Pick<NativePushClient, 'isAvailable' | 'clearDeliveredSocialNotifications'> = createNativePushClient(),
  timeoutMs = nativePushDeliveryCleanupTimeoutMs,
) {
  if (!client.isAvailable()) return true;
  return settleNativePushStep(
    Promise.resolve().then(() => client.clearDeliveredSocialNotifications()),
    timeoutMs,
  );
}

export async function logoutThenClearNativePushDeliveredSocialNotifications(
  logout: () => Promise<void>,
  cleanup: () => Promise<unknown> = clearNativePushDeliveredSocialBoundary,
) {
  await logout();
  await cleanup();
}

/** Best-effort server + APNs cleanup while the current personal auth cookie is
 * still valid. App calls this before logout; effect cleanup alone must not
 * issue an account mutation after the cookie may already belong to another user. */
export async function clearNativePushAccountBoundary(accountId?: string | null) {
  const active = activeNativePushBoundary;
  if (active && accountId && active.accountId !== accountId) return;
  if (!active) {
    const client = createNativePushClient();
    if (!client.isAvailable()) return;
    let expired = false;
    const removeServerInstallation = (async () => {
      const installation = await client.getInstallation().catch(() => null);
      if (expired) return;
      if (installation) await client.removeInstallation(installation).catch(() => undefined);
    })();
    // Native unregister + selective Notification Center cleanup must not wait
    // for Keychain identity or an authenticated server request. This also
    // handles a cold kiosk launch where the official push plugin has not yet
    // observed an APNs registration callback.
    const nativeCleanup = unregisterAndClearDeliveredSocialNotifications(client);
    const cleanup = Promise.allSettled([removeServerInstallation, nativeCleanup]);
    await settleNativePushCleanup(cleanup, () => {
      expired = true;
      client.cancelRequests();
    });
    return;
  }
  activeNativePushBoundary = null;
  const flights = nativePushBindFlights.get(active.accountId) ?? [];
  nativePushBindFlights.delete(active.accountId);
  await cleanupNativePushBoundary(active.client, active.installation, flights);
}

export async function startNativePushAccountSetup(
  client: Pick<NativePushClient, 'getInstallation' | 'loadPreferences'>,
) {
  const installation = await client.getInstallation();
  const preferences = client.loadPreferences().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return { installation, preferences };
}

export function pushRequestIsCurrent(
  requestedAccountId: string,
  currentAccountId: string | null,
  requestedGeneration: number,
  currentGeneration: number,
) {
  return Boolean(requestedAccountId)
    && requestedAccountId === currentAccountId
    && requestedGeneration === currentGeneration;
}

export function rememberNativePushNotification(seen: Set<string>, id: string, maximum = 128) {
  if (seen.has(id)) return false;
  seen.add(id);
  while (seen.size > maximum) {
    const oldest = seen.values().next().value;
    if (typeof oldest !== 'string') break;
    seen.delete(oldest);
  }
  return true;
}

function permissionLabel(permission: NativePushPermission | null, registered: boolean) {
  if (permission === 'granted') {
    return registered
      ? 'Notifications are ready for this TrackLab account.'
      : 'iOS allows notifications. TrackLab is connecting this account.';
  }
  if (permission === 'denied') return 'Notifications are off in iOS Settings.';
  if (permission === 'prompt' || permission === 'prompt-with-rationale') {
    return 'Notifications stay off until you choose Enable notifications.';
  }
  return 'Checking notification access…';
}

export function NativeNotificationsCoordinator({
  accountId,
  authStatus,
  kioskMode,
  settingsOpen,
  onFriendsActivity,
  client: suppliedClient,
}: NativeNotificationsCoordinatorProps) {
  const clientRef = useRef<NativePushClient | null>(null);
  clientRef.current ??= suppliedClient ?? createNativePushClient();
  const client = clientRef.current;
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [nativeIos, setNativeIos] = useState(false);
  const [available, setAvailable] = useState(false);
  const [permission, setPermission] = useState<NativePushPermission | null>(null);
  const [preferences, setPreferences] = useState<NativePushPreferences | null>(null);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const [foregroundNotice, setForegroundNotice] = useState<Readonly<{
    accountId: string;
    notificationId: string;
    title: string;
    detail: string;
  }> | null>(null);
  const generationRef = useRef(0);
  const currentAccountIdRef = useRef<string | null>(null);
  const installationRef = useRef<NativePushInstallation | null>(null);
  const receivedIdsRef = useRef(new Set<string>());
  const actionIdsRef = useRef(new Set<string>());

  useEffect(() => {
    setPortalTarget(settingsOpen && typeof document !== 'undefined'
      ? document.getElementById(nativeNotificationsSettingsSlotId)
      : null);
  }, [settingsOpen]);

  useEffect(() => {
    const requestedAccountId = resolveNativePushAccountBoundary(authStatus, accountId, kioskMode);
    // Capacitor retains a cold-launch notification action only until the first
    // listener subscribes. During cookie hydration, leave the native plugin
    // entirely untouched so the exact signed-in account can consume it later.
    if (requestedAccountId === undefined) return undefined;
    const generation = ++generationRef.current;
    currentAccountIdRef.current = requestedAccountId;
    receivedIdsRef.current.clear();
    actionIdsRef.current.clear();
    setPermission(null);
    setPreferences(null);
    setRegistered(false);
    setBusy(false);
    setMessage('');
    setHasError(false);
    setPreferenceError('');
    setForegroundNotice(null);

    const supported = client.isAvailable();
    setNativeIos(client.isNativeIos());
    setAvailable(supported);
    if (!supported) return undefined;

    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const isCurrent = () => !disposed && Boolean(requestedAccountId) && pushRequestIsCurrent(
      requestedAccountId ?? '',
      currentAccountIdRef.current,
      generation,
      generationRef.current,
    );
    const handleRoute = (route: NativePushRoute, opened: boolean) => {
      if (!isCurrent()) return;
      const seen = opened ? actionIdsRef.current : receivedIdsRef.current;
      if (!rememberNativePushNotification(seen, route.notificationId)) return;
      if (opened) {
        setForegroundNotice((current) => current?.notificationId === route.notificationId ? null : current);
      } else {
        const copy = nativePushForegroundCopy(route.kind);
        if (copy && requestedAccountId) {
          setForegroundNotice({
            accountId: requestedAccountId,
            notificationId: route.notificationId,
            ...copy,
          });
        }
      }
      // Push data is only a wake-up hint. Both paths ask the authenticated
      // account to refetch authoritative Friends/invite state; neither accepts
      // an invite, opens a room, or enables the microphone.
      onFriendsActivity(opened);
    };
    const addHandle = async (pending: Promise<{ remove: () => Promise<void> }>) => {
      const handle = await pending;
      if (disposed) await handle.remove();
      else handles.push(handle);
    };

    const configure = async () => {
      try {
        await Promise.all([
          addHandle(client.addRegistrationListener((token) => {
            if (!isCurrent()) return;
            const activeInstallation = installationRef.current;
            if (!activeInstallation || !requestedAccountId) return;
            const flight = client.bindInstallation(activeInstallation, token);
            const flights = nativePushBindFlights.get(requestedAccountId) ?? new Set<Promise<void>>();
            flights.add(flight);
            nativePushBindFlights.set(requestedAccountId, flights);
            void flight.then(() => {
              if (!isCurrent()) return;
              setRegistered(true);
              setHasError(false);
              setMessage('This device is ready for TrackLab notifications.');
            }).catch((error) => {
              if (!isCurrent()) return;
              setRegistered(false);
              setHasError(true);
              setMessage(error instanceof Error ? error.message : 'Notification registration failed.');
            }).finally(() => {
              flights.delete(flight);
              if (flights.size === 0 && nativePushBindFlights.get(requestedAccountId) === flights) {
                nativePushBindFlights.delete(requestedAccountId);
              }
            });
          })),
          addHandle(client.addRegistrationErrorListener((error) => {
            if (!isCurrent()) return;
            setRegistered(false);
            setHasError(true);
            setMessage(error);
          })),
          addHandle(client.addReceivedListener((route) => handleRoute(route, false))),
          addHandle(client.addActionListener((route) => handleRoute(route, true))),
        ]);
        if (!requestedAccountId) {
          await unregisterAndClearDeliveredSocialNotifications(client);
          return;
        }
        const setup = await startNativePushAccountSetup(client);
        if (!isCurrent()) return;
        installationRef.current = setup.installation;
        activeNativePushBoundary = { accountId: requestedAccountId, client, installation: setup.installation };
        const preferencesFlight = setup.preferences.then((result) => {
          if (!isCurrent()) return;
          if (result.ok) {
            setPreferences(result.value);
            setPreferenceError('');
          } else {
            setPreferenceError(result.error instanceof Error
              ? result.error.message
              : 'Notification choices could not be loaded.');
          }
        });

        if (!isCurrent()) return;
        const checked = await client.checkPermission();
        if (!isCurrent()) return;
        setPermission(checked);
        if (checked === 'granted') {
          setMessage('Connecting this account to Apple Push Notification service…');
          await client.register();
        } else {
          await client.removeInstallation(setup.installation).catch(() => undefined);
        }
        await preferencesFlight;
      } catch (error) {
        if (isCurrent()) {
          setHasError(true);
          setMessage(error instanceof Error ? error.message : 'Notifications could not be loaded.');
        }
      }
    };
    void configure();

    return () => {
      disposed = true;
      generationRef.current += 1;
      if (currentAccountIdRef.current === requestedAccountId) currentAccountIdRef.current = null;
      void Promise.allSettled(handles.map((handle) => handle.remove()));
      installationRef.current = null;
    };
  }, [accountId, authStatus, client, kioskMode, onFriendsActivity, suppliedClient]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !accountId || kioskMode || !available || typeof document === 'undefined') {
      return undefined;
    }
    const requestedAccountId = accountId;
    const generation = generationRef.current;
    let checking = false;
    const refreshAfterSettings = () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      void client.checkPermission().then(async (checked) => {
        if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
        setPermission(checked);
        if (checked === 'granted') {
          await client.register();
        } else {
          setRegistered(false);
          const installation = installationRef.current;
          if (installation) await client.removeInstallation(installation).catch(() => undefined);
        }
      }).catch((error) => {
        if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
          setHasError(true);
          setMessage(error instanceof Error ? error.message : 'Notification access could not be refreshed.');
        }
      }).finally(() => { checking = false; });
    };
    document.addEventListener('visibilitychange', refreshAfterSettings);
    return () => { document.removeEventListener('visibilitychange', refreshAfterSettings); };
  }, [accountId, authStatus, available, client, kioskMode]);

  const enable = useCallback(async () => {
    const requestedAccountId = currentAccountIdRef.current;
    const generation = generationRef.current;
    if (!requestedAccountId || !available) return;
    setBusy(true);
    setHasError(false);
    setMessage('Waiting for your iOS notification choice…');
    try {
      const result = await client.requestPermission();
      if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
      setPermission(result);
      if (result === 'granted') {
        setMessage('Connecting this account to Apple Push Notification service…');
        await client.register();
      } else {
        setMessage('Notifications remain off. You can change this later in iOS Settings.');
      }
    } catch (error) {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setHasError(true);
        setMessage(error instanceof Error ? error.message : 'Notifications could not be enabled.');
      }
    } finally {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setBusy(false);
      }
    }
  }, [available, client]);

  const savePreference = useCallback(async (key: keyof NativePushPreferences, checked: boolean) => {
    const requestedAccountId = currentAccountIdRef.current;
    const generation = generationRef.current;
    if (!requestedAccountId || !preferences) return;
    setBusy(true);
    setHasError(false);
    setPreferenceError('');
    setMessage('Saving notification choices…');
    try {
      const saved = await client.savePreferences({ [key]: checked });
      if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
      setPreferences(saved);
      setMessage('Notification choices saved.');
    } catch (error) {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setPreferenceError(error instanceof Error ? error.message : 'Notification choices could not be saved.');
      }
    } finally {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setBusy(false);
      }
    }
  }, [client, preferences]);

  const retryRegistration = useCallback(async () => {
    const requestedAccountId = currentAccountIdRef.current;
    const generation = generationRef.current;
    if (!requestedAccountId) return;
    setBusy(true);
    setHasError(false);
    setMessage('Retrying Apple Push Notification service…');
    try {
      let installation = installationRef.current;
      if (!installation) {
        installation = await client.getInstallation();
        if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
        installationRef.current = installation;
        activeNativePushBoundary = { accountId: requestedAccountId, client, installation };
      }
      const checked = await client.checkPermission();
      if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
      setPermission(checked);
      if (checked === 'granted') await client.register();
      else setMessage('Notifications remain off. You can change this later in iOS Settings.');
    } catch (error) {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setHasError(true);
        setMessage(error instanceof Error ? error.message : 'Notification registration could not be retried.');
      }
    } finally {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setBusy(false);
      }
    }
  }, [client]);

  const retryPreferences = useCallback(async () => {
    const requestedAccountId = currentAccountIdRef.current;
    const generation = generationRef.current;
    if (!requestedAccountId) return;
    setBusy(true);
    setPreferenceError('');
    try {
      const loaded = await client.loadPreferences();
      if (!pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) return;
      setPreferences(loaded);
    } catch (error) {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setPreferenceError(error instanceof Error ? error.message : 'Notification choices could not be loaded.');
      }
    } finally {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setBusy(false);
      }
    }
  }, [client]);

  const openIosSettings = useCallback(async () => {
    const requestedAccountId = currentAccountIdRef.current;
    const generation = generationRef.current;
    if (!requestedAccountId) return;
    setHasError(false);
    try {
      await client.openSettings();
    } catch (error) {
      if (pushRequestIsCurrent(requestedAccountId, currentAccountIdRef.current, generation, generationRef.current)) {
        setHasError(true);
        setMessage(error instanceof Error ? error.message : 'iOS Settings could not be opened.');
      }
    }
  }, [client]);

  if (!nativeIos || authStatus !== 'signed-in' || !accountId || kioskMode) return null;
  const foregroundPortal = foregroundNotice
    && foregroundNotice.accountId === accountId
    && typeof document !== 'undefined'
    ? createPortal(
      <aside className="native-push-foreground" role="alert" aria-labelledby="native-push-foreground-title">
        <small>TRACKLAB FRIENDS</small>
        <strong id="native-push-foreground-title">{foregroundNotice.title}</strong>
        <span>{foregroundNotice.detail}</span>
        <div className="native-push-foreground-actions">
          <button type="button" onClick={() => {
            setForegroundNotice(null);
            onFriendsActivity(true);
          }}>View Friends</button>
          <button type="button" onClick={() => setForegroundNotice(null)}>Dismiss</button>
        </div>
      </aside>,
      document.body,
    )
    : null;
  if (!portalTarget) return foregroundPortal;
  const statusHasError = hasError || Boolean(preferenceError);
  const stateClass = statusHasError
    ? 'error'
    : message && permission !== 'granted'
      ? permission ?? 'error'
      : permission === 'granted' && !registered
        ? 'registering'
        : permission ?? 'loading';
  const statusText = preferenceError || message || (available
    ? permissionLabel(permission, registered)
    : 'Install TrackLab app build 12 or later to use notifications.');

  const settingsPortal = createPortal(
    <section className="app-settings-card native-notifications-card" aria-labelledby="native-notifications-heading">
      <header>
        <div className="native-notifications-title">
          {permission === 'granted' ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
          <span>
            <small>iPhone &amp; iPad</small>
            <h2 id="native-notifications-heading">Notifications</h2>
          </span>
        </div>
        <ShieldCheck aria-hidden="true" />
      </header>
      <p>Choose which friend activity can alert this personal TrackLab account.</p>
      <div
        className={`app-settings-sync ${stateClass === 'error' || stateClass === 'denied' ? 'offline' : stateClass}`}
        role={statusHasError ? 'alert' : 'status'}
        aria-live="polite"
      >
        {permission === 'granted' ? <Bell aria-hidden="true" size={19} /> : <BellOff aria-hidden="true" size={19} />}
        <span>{statusText}</span>
      </div>
      {preferences && <div aria-label="Notification choices">
        {preferenceCopy.map((item) => <label className="app-settings-choice native-notifications-choice" key={item.key}>
          <span className="app-settings-choice-copy">
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </span>
          <input
            type="checkbox"
            checked={preferences[item.key]}
            disabled={busy}
            onChange={(event) => { void savePreference(item.key, event.currentTarget.checked); }}
          />
        </label>)}
      </div>}
      <div className="app-settings-region native-notifications-actions">
        {permission !== 'granted' && permission !== 'denied' && <button type="button" disabled={busy || !available} onClick={() => { void enable(); }}>
          <Bell aria-hidden="true" size={17} /> Enable notifications
        </button>}
        {(permission === 'denied' || permission === 'granted') && <button className="secondary" type="button" disabled={busy} onClick={() => { void openIosSettings(); }}>
          <ExternalLink aria-hidden="true" size={17} /> Open iOS Settings
        </button>}
        {((permission === 'granted' && !registered) || (hasError && permission !== 'denied')) && <button type="button" disabled={busy} onClick={() => { void retryRegistration(); }}>
          <RefreshCcw aria-hidden="true" size={17} /> Retry connection
        </button>}
        {preferenceError && <button className="secondary" type="button" disabled={busy} onClick={() => { void retryPreferences(); }}>
          <RefreshCcw aria-hidden="true" size={17} /> Retry notification choices
        </button>}
      </div>
      <p className="app-settings-sync loading native-notifications-privacy">
        TrackLab sends Apple an opaque device token and stores a random app-installation credential in this device’s Keychain.
        Push alerts contain only a notification type and opaque ID. Opening one securely refetches your current Friends data;
        it never joins live audio or turns on your microphone.
      </p>
    </section>,
    portalTarget,
  );
  return <>{foregroundPortal}{settingsPortal}</>;
}

export default NativeNotificationsCoordinator;
