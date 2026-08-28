import { beforeEach, describe, expect, it, vi } from 'vitest';

const bleClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getDevices: vi.fn(),
  getServices: vi.fn(),
  initialize: vi.fn(),
  isEnabled: vi.fn(),
  read: vi.fn(),
  requestDevice: vi.fn(),
  startNotifications: vi.fn(),
  stopNotifications: vi.fn(),
}));

const capacitor = vi.hoisted(() => ({
  isPluginAvailable: vi.fn(),
  isNativePlatform: vi.fn(),
}));

const nativeSessionPlugin = vi.hoisted(() => ({
  loadSavedBluetoothDevices: vi.fn(),
  saveBluetoothDevice: vi.fn(),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: bleClient }));
vi.mock('@capacitor/core', () => ({
  Capacitor: capacitor,
  registerPlugin: () => nativeSessionPlugin,
}));

const savedDeviceIdsKey = 'tracklab.native-bluetooth-device-ids.v1';
const nativeBikeIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;
const nativeBike701Id = '70170170-1701-4701-8701-701701701701';

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
    filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
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
    capacitor.isPluginAvailable.mockReturnValue(true);
    nativeSessionPlugin.loadSavedBluetoothDevices.mockResolvedValue({ version: 1, deviceIds: [] });
    nativeSessionPlugin.saveBluetoothDevice.mockResolvedValue({ saved: true });
    bleClient.initialize.mockResolvedValue(undefined);
    bleClient.isEnabled.mockResolvedValue(true);
    bleClient.connect.mockResolvedValue(undefined);
    bleClient.disconnect.mockResolvedValue(undefined);
    bleClient.getDevices.mockResolvedValue([]);
    bleClient.getServices.mockResolvedValue([]);
    bleClient.requestDevice.mockResolvedValue({ deviceId: nativeBikeIds[0], name: 'WattbikePM25043950' });
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

  it('preserves the Wattbike name filter, normalizes services, and remembers the device', async () => {
    const { fakeWindow, storage } = installWindow();
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await expect(installCapacitorBluetoothBridge()).resolves.toBe(true);
    const bluetooth = fakeWindow.navigator.bluetooth as InstalledBluetooth;

    const device = await bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Wattbike' },
        { namePrefix: 'WattbikePM' },
        { services: ['1818'] },
      ],
      optionalServices: ['180f', '00001818', 'F7461223-D7C1-11E4-9AB1-0002A5D5C51B'],
    });

    expect(bleClient.initialize).toHaveBeenCalledTimes(1);
    expect(bleClient.requestDevice).toHaveBeenCalledWith({
      displayMode: 'list',
      namePrefix: 'Wattbike',
      optionalServices: [
        '0000180f-0000-1000-8000-00805f9b34fb',
        '00001818-0000-1000-8000-00805f9b34fb',
        'f7461223-d7c1-11e4-9ab1-0002a5d5c51b',
      ],
    });
    expect(device).toMatchObject({ id: nativeBikeIds[0], name: 'WattbikePM25043950' });
    expect(storage.setItem).toHaveBeenCalledWith(savedDeviceIdsKey, JSON.stringify([nativeBikeIds[0]]));
    expect(nativeSessionPlugin.saveBluetoothDevice).toHaveBeenCalledWith({ deviceId: nativeBikeIds[0] });
  });

  it('reports when native Bluetooth is disabled before opening the device list', async () => {
    const { fakeWindow } = installWindow();
    bleClient.isEnabled.mockResolvedValue(false);
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();
    const bluetooth = fakeWindow.navigator.bluetooth as InstalledBluetooth;

    await expect(bluetooth.requestDevice({
      filters: [{ namePrefix: 'Wattbike' }],
      optionalServices: ['1818'],
    })).rejects.toThrow('Bluetooth is turned off');

    expect(bleClient.requestDevice).not.toHaveBeenCalled();
  });

  it('restores at most four saved native bikes and reconnects after a GATT disconnect', async () => {
    const storage = createStorage({
      [savedDeviceIdsKey]: JSON.stringify([
        ...nativeBikeIds,
      ]),
    });
    const { fakeWindow } = installWindow(storage);
    bleClient.getDevices.mockResolvedValue([
      { deviceId: nativeBikeIds[1], name: 'PM25043950' },
      { deviceId: nativeBikeIds[2], name: 'WattbikePM25043851' },
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
      nativeBikeIds[1],
      nativeBikeIds[2],
      nativeBikeIds[3],
      nativeBikeIds[4],
    ]);
    expect(devices.map(({ id }) => id)).toEqual([nativeBikeIds[1], nativeBikeIds[2]]);

    const disconnected = vi.fn();
    devices[0].addEventListener('gattserverdisconnected', disconnected);
    await devices[0].gatt.connect();
    await devices[0].gatt.connect();
    expect(bleClient.connect).toHaveBeenCalledTimes(1);
    expect(devices[0].gatt.connected).toBe(true);

    disconnectCallbacks.get(nativeBikeIds[1])?.();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(devices[0].gatt.connected).toBe(false);

    await devices[0].gatt.connect();
    expect(bleClient.connect).toHaveBeenCalledTimes(2);
    expect(bleClient.getServices).toHaveBeenCalledTimes(2);
    expect(devices[0].gatt.connected).toBe(true);
  });

  it('restores Wattbike peripheral IDs from the device-only native store after WebView data is replaced', async () => {
    const { fakeWindow, storage } = installWindow();
    nativeSessionPlugin.loadSavedBluetoothDevices.mockResolvedValue({
      version: 1,
      deviceIds: [nativeBike701Id],
    });
    bleClient.getDevices.mockResolvedValue([
      { deviceId: nativeBike701Id, name: 'WattbikePM25058701' },
    ]);
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();

    const devices = await (fakeWindow.navigator.bluetooth as InstalledBluetooth).getDevices();

    expect(bleClient.getDevices).toHaveBeenCalledWith([nativeBike701Id]);
    expect(devices).toHaveLength(1);
    expect(storage.setItem).toHaveBeenCalledWith(savedDeviceIdsKey, JSON.stringify([nativeBike701Id]));
  });

  it('migrates an existing local Wattbike pairing into the device-only native store', async () => {
    const storage = createStorage({
      [savedDeviceIdsKey]: JSON.stringify([nativeBike701Id]),
    });
    const { fakeWindow } = installWindow(storage);
    bleClient.getDevices.mockResolvedValue([
      { deviceId: nativeBike701Id, name: 'WattbikePM25058701' },
    ]);
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();

    await (fakeWindow.navigator.bluetooth as InstalledBluetooth).getDevices();

    expect(nativeSessionPlugin.saveBluetoothDevice).toHaveBeenCalledWith({ deviceId: nativeBike701Id });
  });

  it('keeps a newly migrated local pairing in the immediate most-recent-four restore set', async () => {
    const storage = createStorage({
      [savedDeviceIdsKey]: JSON.stringify([nativeBikeIds[4]]),
    });
    const { fakeWindow } = installWindow(storage);
    nativeSessionPlugin.loadSavedBluetoothDevices.mockResolvedValue({
      version: 1,
      deviceIds: nativeBikeIds.slice(0, 4),
    });
    bleClient.getDevices.mockResolvedValue(nativeBikeIds.slice(1).map((deviceId, index) => ({
      deviceId,
      name: `WattbikePM2505870${index + 1}`,
    })));
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();

    const devices = await (fakeWindow.navigator.bluetooth as InstalledBluetooth).getDevices();

    expect(nativeSessionPlugin.saveBluetoothDevice).toHaveBeenCalledWith({ deviceId: nativeBikeIds[4] });
    expect(bleClient.getDevices).toHaveBeenCalledWith(nativeBikeIds.slice(1));
    expect(devices.map(({ id }) => id)).toEqual(nativeBikeIds.slice(1));
    expect(storage.setItem).toHaveBeenCalledWith(
      savedDeviceIdsKey,
      JSON.stringify(nativeBikeIds.slice(1)),
    );
  });

  it('disconnects a partial native link when service discovery fails', async () => {
    const storage = createStorage({
      [savedDeviceIdsKey]: JSON.stringify([nativeBikeIds[0]]),
    });
    const { fakeWindow } = installWindow(storage);
    bleClient.getDevices.mockResolvedValue([
      { deviceId: nativeBikeIds[0], name: 'WattbikePM25043950' },
    ]);
    bleClient.getServices.mockRejectedValue(new Error('Service discovery timed out.'));
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();
    const bluetooth = fakeWindow.navigator.bluetooth as InstalledBluetooth;
    const [device] = await bluetooth.getDevices();

    await expect(device.gatt.connect()).rejects.toThrow(
      'The Wattbike was found, but its live data connection failed. Service discovery timed out.',
    );

    expect(bleClient.connect).toHaveBeenCalledWith(nativeBikeIds[0], expect.any(Function));
    expect(bleClient.disconnect).toHaveBeenCalledWith(nativeBikeIds[0]);
    expect(device.gatt.connected).toBe(false);
  });

  it('treats malformed saved-device storage as an empty remembered list', async () => {
    const { fakeWindow } = installWindow(createStorage({ [savedDeviceIdsKey]: 'not-json' }));
    const { installCapacitorBluetoothBridge } = await loadBridge();
    await installCapacitorBluetoothBridge();

    await expect((fakeWindow.navigator.bluetooth as InstalledBluetooth).getDevices()).resolves.toEqual([]);

    expect(bleClient.getDevices).not.toHaveBeenCalled();
  });
});
