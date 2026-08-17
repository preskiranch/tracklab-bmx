import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }));

function installBrowser({
  userAgent = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  compatibilityCapacitor,
}: {
  userAgent?: string;
  compatibilityCapacitor?: { isNativePlatform: () => boolean };
} = {}) {
  const eventTarget = new EventTarget();
  const sessionStorage = {
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };
  const fakeWindow = Object.assign(eventTarget, {
    navigator: { userAgent },
    sessionStorage,
  });
  if (compatibilityCapacitor) {
    Object.assign(fakeWindow, { Capacitor: compatibilityCapacitor });
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: fakeWindow.navigator,
  });
  return { eventTarget, sessionStorage };
}

async function loadBootstrap() {
  vi.resetModules();
  return import('../../src/lib/nativeBluetoothBootstrap');
}

describe('native Bluetooth bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitor.isNativePlatform.mockReturnValue(false);
    installBrowser();
  });

  it('recognizes Capacitor native on an ordinary iPad user agent without window.Capacitor', async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    installBrowser();
    const { isNativeTrackLabShell } = await loadBootstrap();

    expect(isNativeTrackLabShell()).toBe(true);
    expect(capacitor.isNativePlatform).toHaveBeenCalledTimes(1);
    expect(window).not.toHaveProperty('Capacitor');
  });

  it('skips bridge installation on a non-native web browser', async () => {
    const installBridge = vi.fn();
    const { bootstrapNativeBluetooth } = await loadBootstrap();

    await expect(bootstrapNativeBluetooth({ installBridge })).resolves.toEqual({ state: 'skipped' });

    expect(installBridge).not.toHaveBeenCalled();
  });

  it('waits for bridge installation and exposes ready status before the caller renders', async () => {
    const order: string[] = [];
    const { bootstrapNativeBluetooth, getNativeBluetoothBootstrapStatus } = await loadBootstrap();

    const status = await bootstrapNativeBluetooth({
      native: true,
      installBridge: async () => {
        order.push('bridge');
        return true;
      },
    });
    order.push('render');

    expect(order).toEqual(['bridge', 'render']);
    expect(status).toEqual({ state: 'ready' });
    expect(getNativeBluetoothBootstrapStatus()).toEqual({ state: 'ready' });
  });

  it('persists and emits a nonfatal diagnostic when bridge installation fails', async () => {
    const { eventTarget, sessionStorage } = installBrowser();
    const logger = { error: vi.fn() };
    const {
      bootstrapNativeBluetooth,
      getNativeBluetoothBootstrapStatus,
      NATIVE_BLUETOOTH_ERROR_EVENT,
      NATIVE_BLUETOOTH_ERROR_KEY,
      NATIVE_BLUETOOTH_STATUS_EVENT,
    } = await loadBootstrap();
    const errors: Array<{ message: string }> = [];
    const statuses: Array<{ state: string; message?: string }> = [];
    eventTarget.addEventListener(NATIVE_BLUETOOTH_ERROR_EVENT, (event) => {
      errors.push((event as CustomEvent<{ message: string }>).detail);
    });
    eventTarget.addEventListener(NATIVE_BLUETOOTH_STATUS_EVENT, (event) => {
      statuses.push((event as CustomEvent<{ state: string; message?: string }>).detail);
    });

    const status = await bootstrapNativeBluetooth({
      native: true,
      installBridge: async () => {
        throw new Error('Bluetooth plugin unavailable');
      },
      logger,
    });

    expect(status).toEqual({ state: 'failed', message: 'Bluetooth plugin unavailable' });
    expect(getNativeBluetoothBootstrapStatus()).toEqual(status);
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      NATIVE_BLUETOOTH_ERROR_KEY,
      'Bluetooth plugin unavailable',
    );
    expect(errors).toEqual([{ message: 'Bluetooth plugin unavailable' }]);
    expect(statuses).toContainEqual(status);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
