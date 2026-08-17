import { Capacitor } from '@capacitor/core';

export const NATIVE_BLUETOOTH_ERROR_KEY = 'tracklab.native.bluetooth.error';
export const NATIVE_BLUETOOTH_ERROR_EVENT = 'tracklab:native-bluetooth-error';
export const NATIVE_BLUETOOTH_STATUS_EVENT = 'tracklab:native-bluetooth-status';

export type NativeBluetoothBootstrapStatus = Readonly<{
  state: 'idle' | 'skipped' | 'ready' | 'failed';
  message?: string;
}>;

type CompatibilityCapacitor = {
  isNativePlatform?: () => boolean;
};

type NativeBluetoothBootstrapOptions = {
  installBridge?: () => Promise<boolean>;
  native?: boolean;
  eventTarget?: Pick<Window, 'dispatchEvent'>;
  logger?: Pick<Console, 'error'>;
  storage?: Pick<Storage, 'removeItem' | 'setItem'>;
};

let bootstrapStatus: NativeBluetoothBootstrapStatus = { state: 'idle' };

function currentWindow() {
  return typeof window === 'undefined' ? undefined : window;
}

function currentUserAgent() {
  if (typeof navigator !== 'undefined') {
    return navigator.userAgent;
  }
  return currentWindow()?.navigator.userAgent ?? '';
}

function currentSessionStorage() {
  try {
    return currentWindow()?.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Capacitor's imported runtime is the authoritative native-shell signal. The
 * user-agent and legacy window global remain as compatibility fallbacks for
 * already-installed TrackLab shells.
 */
export function isNativeTrackLabShell() {
  try {
    if (Capacitor.isNativePlatform()) {
      return true;
    }
  } catch {
    // Compatibility checks below keep the web dashboard load nonfatal.
  }

  if (currentUserAgent().includes('TrackLabBMX-iOS')) {
    return true;
  }

  const compatibilityCapacitor = (currentWindow() as (Window & {
    Capacitor?: CompatibilityCapacitor;
  }) | undefined)?.Capacitor;

  try {
    return compatibilityCapacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function getNativeBluetoothBootstrapStatus() {
  return bootstrapStatus;
}

function updateStatus(
  status: NativeBluetoothBootstrapStatus,
  eventTarget: Pick<Window, 'dispatchEvent'> | undefined,
) {
  bootstrapStatus = status;
  eventTarget?.dispatchEvent(new CustomEvent(NATIVE_BLUETOOTH_STATUS_EVENT, {
    detail: status,
  }));
}

function reportFailure(
  error: unknown,
  {
    eventTarget,
    logger,
    storage,
  }: Required<Pick<NativeBluetoothBootstrapOptions, 'logger'>> &
    Pick<NativeBluetoothBootstrapOptions, 'eventTarget' | 'storage'>,
) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('TrackLab native Bluetooth failed to initialize.', error);

  try {
    storage?.setItem(NATIVE_BLUETOOTH_ERROR_KEY, message);
  } catch {
    // Diagnostics must never prevent the dashboard from loading.
  }

  const status: NativeBluetoothBootstrapStatus = { state: 'failed', message };
  updateStatus(status, eventTarget);
  eventTarget?.dispatchEvent(new CustomEvent(NATIVE_BLUETOOTH_ERROR_EVENT, {
    detail: { message },
  }));
  return status;
}

async function defaultBridgeInstaller() {
  const { installCapacitorBluetoothBridge } = await import('./capacitorBluetoothBridge');
  return installCapacitorBluetoothBridge();
}

/**
 * Prepares native Bluetooth before React mounts. Failures are reported for the
 * dashboard to read, but deliberately resolve instead of blocking app startup.
 */
export async function bootstrapNativeBluetooth(
  options: NativeBluetoothBootstrapOptions = {},
): Promise<NativeBluetoothBootstrapStatus> {
  const native = options.native ?? isNativeTrackLabShell();
  const scope = currentWindow();
  const eventTarget = options.eventTarget ?? scope;
  const storage = options.storage ?? currentSessionStorage();
  const logger = options.logger ?? console;

  if (!native) {
    const status: NativeBluetoothBootstrapStatus = { state: 'skipped' };
    updateStatus(status, eventTarget);
    return status;
  }

  try {
    const installed = await (options.installBridge ?? defaultBridgeInstaller)();
    if (!installed) {
      throw new Error('The native Bluetooth bridge is not available in this app shell.');
    }

    try {
      storage?.removeItem(NATIVE_BLUETOOTH_ERROR_KEY);
    } catch {
      // Storage diagnostics are optional in restricted WebViews.
    }

    const status: NativeBluetoothBootstrapStatus = { state: 'ready' };
    updateStatus(status, eventTarget);
    return status;
  } catch (error) {
    return reportFailure(error, { eventTarget, logger, storage });
  }
}
