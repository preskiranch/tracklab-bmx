/**
 * Tracks whether this physical personal device can receive the server-owned
 * Recovery Alert push for the currently signed-in TrackLab account.
 *
 * This deliberately contains no recovery or athlete data.  It is a small
 * account-bound delivery fence shared by the native-push and recovery
 * coordinators so one device never presents both a local and a remote alert
 * for the same recovery episode.
 */
export type NativeRecoveryPushDeliveryStatus = 'checking' | 'ready' | 'unavailable';

export type NativeRecoveryPushDeliveryState = Readonly<{
  accountId: string | null;
  status: NativeRecoveryPushDeliveryStatus;
}>;

const initialState: NativeRecoveryPushDeliveryState = Object.freeze({
  accountId: null,
  status: 'checking',
});

let currentState: NativeRecoveryPushDeliveryState = initialState;
const listeners = new Set<() => void>();

export function getNativeRecoveryPushDeliveryState() {
  return currentState;
}

export function subscribeNativeRecoveryPushDelivery(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Native Push owns updates to this state only after it has resolved the
 * exact signed-in account. `ready` is set solely after installation binding
 * succeeds, which is the server-side boundary that authorizes APNs delivery. */
export function setNativeRecoveryPushDeliveryState(
  accountId: string | null,
  status: NativeRecoveryPushDeliveryStatus,
) {
  const next: NativeRecoveryPushDeliveryState = { accountId, status };
  if (currentState.accountId === next.accountId && currentState.status === next.status) return;
  currentState = next;
  listeners.forEach((listener) => listener());
}

export type RecoveryNotificationDelivery = 'checking' | 'remote' | 'local';

/**
 * Select exactly one OS-notification owner for a personal device. APNs is
 * preferred once both the server and this installation are ready. The local
 * native timer remains a fallback for an unavailable APNs channel; while
 * registration is still being verified, it is intentionally paused so it
 * cannot race a successful remote registration and double-alert the athlete.
 */
export function resolveRecoveryNotificationDelivery({
  accountId,
  serverPushDeliveryAvailable,
  nativePush,
}: Readonly<{
  accountId: string;
  serverPushDeliveryAvailable: boolean | null;
  nativePush: NativeRecoveryPushDeliveryState;
}>): RecoveryNotificationDelivery {
  if (serverPushDeliveryAvailable === false) return 'local';
  if (serverPushDeliveryAvailable == null || nativePush.accountId !== accountId) return 'checking';
  if (nativePush.status === 'ready') return 'remote';
  return nativePush.status === 'unavailable' ? 'local' : 'checking';
}
