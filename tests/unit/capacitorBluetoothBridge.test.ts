import { beforeEach, describe, expect, it, vi } from 'vitest';

const bleClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getDevices: vi.fn(),
  getServices: vi.fn(),
  initialize: vi.fn(),
  read: vi.fn(),
  requestDevice: vi.fn(),
  startNotifications: vi.fn(),
  stopNotifications: vi.fn(),
}));

const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: bleClient }));
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }));

const savedDeviceIdsKey = 'tracklab.native-bluetooth-device-ids.v1';

type InstalledBluetooth = {
  getDevices: () => Promise<Array<{
    id: string;
    name?: string;
    gatt: {
      connected: boolean;
      connect: () => Promise<unknown>;
    };
    addEventListener: (type: string, listener: () => void) => void;
  }>>;
  requestDevice: (options: {
    acceptAllDevices?: boolean;
    filters?: Array<{ namePrefix?: string }>;
    optionalServices: string[];
  }) => Promise<{ id: string; name?: string }>;
};

function createStorage(initialEntries: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initialEntries));
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

function installWindow(storage = createStorage()) {
  const fakeWindow = {
    localStorage: storage,
    navigator: {},
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  return { fakeWindow, storage };
}

async function loadBridge() {
  vi.resetModules();
  return import('../../src/lib/capacitorBluetoothBridge');
}

describe('Capacitor Bluetooth bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitor.isNativePlatform.mockReturnValue(true);
    bleClient.initialize.mockResolvedValue(undefined);
    bleClient.connect.mockResolvedValue(undefined);
    bleClient.disconnect.mockResolvedValue(undefined);
    bleClient.getDevices.mockResolvedValue([]);
    bleClient.getServices.mockResolvedValue([]);
    bleClient.requestDevice.mockResolvedValue({ deviceId: 'native-bike-1', name: 'WattbikePM25043950' });
    installWindow();
  });

  it('does not replace browser Bluetooth outside a native Capacitor shell', async () => {
    capacitor.isNativePlatform.mockReturnValue(false);
    const existingBluetooth = { requestDevice: vi.fn() };
    const { fakeWindow } = installWindow();
    Object.assign(fakeWindow.navigator, { bluetooth: existingBluetooth });
    const { installCapacitorBluetoothBridge } = await loadBridge();

    await expect(installCapacitorBluetoothBridge()).resolves.toBe(false);

    expect(fakeWindow.navigator.bluetooth).toBe(existingBluetooth);
    expect(bleClient.initialize).not.toHaveBeenCalled();
  });

  it('installs when the verified shell signal arrives before Capacitor reports native', async () => {
    capacitor.isNativePlatform.mockReturnValue(false);
    const { fakeWindow } = installWindow();
    const { installCapacitorBluetoothBridge } = await loadBridge();

    await expect(installCapacitorBluetoothBridge({ nativeShell: true })).resolves.toBe(true);

    expect(fakeWindow.navigator.bluetooth).toBeDefined();
  });

  it('requests a native device with normalized optional services and remembers it', async () => {
    const { fakeWindow, storage } = installWindow();
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await expect(installCapacitorBluetoothBridge()).resolves.toBe(true);
    const bluetooth = fakeWindow.navigator.bluetooth as InstalledBluetooth;

    const device = await bluetooth.requestDevice({
      filters: [{ namePrefix: 'Wattbike' }],
      optionalServices: ['180f', '00001818', 'F7461223-D7C1-11E4-9AB1-0002A5D5C51B'],
    });

    expect(bleClient.initialize).toHaveBeenCalledTimes(1);
    expect(bleClient.requestDevice).toHaveBeenCalledWith({
      displayMode: 'list',
      optionalServices: [
        '0000180f-0000-1000-8000-00805f9b34fb',
        '00001818-0000-1000-8000-00805f9b34fb',
        'f7461223-d7c1-11e4-9ab1-0002a5d5c51b',
      ],
    });
    expect(device).toMatchObject({ id: 'native-bike-1', name: 'WattbikePM25043950' });
    expect(storage.setItem).toHaveBeenCalledWith(savedDeviceIdsKey, '["native-bike-1"]');
  });

  it('restores at most four saved native bikes and reconnects after a GATT disconnect', async () => {
    const storage = createStorage({
      [savedDeviceIdsKey]: JSON.stringify([
        'native-bike-1',
        'native-bike-2',
        'native-bike-3',
        'native-bike-4',
        'native-bike-5',
      ]),
    });
    const { fakeWindow } = installWindow(storage);
    bleClient.getDevices.mockResolvedValue([
      { deviceId: 'native-bike-1', name: 'PM25043950' },
      { deviceId: 'native-bike-2', name: 'WattbikePM25043851' },
    ]);
    const disconnectCallbacks = new Map<string, () => void>();
    bleClient.connect.mockImplementation(async (deviceId: string, onDisconnect: () => void) => {
      disconnectCallbacks.set(deviceId, onDisconnect);
    });
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();
    const bluetooth = fakeWindow.navigator.bluetooth as InstalledBluetooth;

    const devices = await bluetooth.getDevices();

    expect(bleClient.getDevices).toHaveBeenCalledWith([
      'native-bike-1',
      'native-bike-2',
      'native-bike-3',
      'native-bike-4',
    ]);
    expect(devices.map(({ id }) => id)).toEqual(['native-bike-1', 'native-bike-2']);

    const disconnected = vi.fn();
    devices[0].addEventListener('gattserverdisconnected', disconnected);
    await devices[0].gatt.connect();
    await devices[0].gatt.connect();
    expect(bleClient.connect).toHaveBeenCalledTimes(1);
    expect(devices[0].gatt.connected).toBe(true);

    disconnectCallbacks.get('native-bike-1')?.();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(devices[0].gatt.connected).toBe(false);

    await devices[0].gatt.connect();
    expect(bleClient.connect).toHaveBeenCalledTimes(2);
    expect(bleClient.getServices).toHaveBeenCalledTimes(2);
    expect(devices[0].gatt.connected).toBe(true);
  });

  it('treats malformed saved-device storage as an empty remembered list', async () => {
    const { fakeWindow } = installWindow(createStorage({ [savedDeviceIdsKey]: 'not-json' }));
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();

    await expect((fakeWindow.navigator.bluetooth as InstalledBluetooth).getDevices()).resolves.toEqual([]);

    expect(bleClient.getDevices).not.toHaveBeenCalled();
  });
});
