import { BleClient, type BleDevice, type BleService } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import type { BluetoothRequestDeviceOptions } from './bluetoothDiscovery';

const savedNativeDeviceIdsKey = 'tracklab.native-bluetooth-device-ids.v1';
const bluetoothServiceBase = '-0000-1000-8000-00805f9b34fb';

let initialized = false;
let initializationPromise: Promise<void> | null = null;

function normalizeUuid(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(normalized)) {
    return `0000${normalized}${bluetoothServiceBase}`;
  }
  if (/^[0-9a-f]{8}$/.test(normalized)) {
    return `${normalized}${bluetoothServiceBase}`;
  }
  return normalized;
}

function readSavedNativeDeviceIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(savedNativeDeviceIdsKey) ?? '[]');
    return Array.isArray(value)
      ? value.filter((deviceId): deviceId is string => typeof deviceId === 'string' && deviceId.length > 0).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

function saveNativeDeviceId(deviceId: string) {
  try {
    const current = readSavedNativeDeviceIds().filter((savedId) => savedId !== deviceId);
    window.localStorage.setItem(savedNativeDeviceIdsKey, JSON.stringify([...current, deviceId].slice(-4)));
  } catch {
    // Pairing remains usable if storage is unavailable.
  }
}

async function initializeNativeBluetooth() {
  if (initialized) {
    return;
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        await BleClient.initialize();
        if (!await BleClient.isEnabled()) {
          throw new Error('Bluetooth is turned off. Turn it on in iPad Settings, then try again.');
        }
        initialized = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Native Bluetooth could not initialize. ${message}`);
      }
    })();
  }
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

class NativeBluetoothCharacteristic extends EventTarget {
  value?: DataView;

  constructor(
    private readonly deviceId: string,
    private readonly serviceUuid: string,
    private readonly characteristicUuid: string,
  ) {
    super();
  }

  readValue = async () => {
    this.value = await BleClient.read(this.deviceId, this.serviceUuid, this.characteristicUuid);
    return this.value;
  };

  startNotifications = async () => {
    await BleClient.startNotifications(
      this.deviceId,
      this.serviceUuid,
      this.characteristicUuid,
      (value) => {
        this.value = value;
        this.dispatchEvent(new Event('characteristicvaluechanged'));
      },
    );
    return this;
  };

  stopNotifications = async () => {
    await BleClient.stopNotifications(this.deviceId, this.serviceUuid, this.characteristicUuid);
    return this;
  };
}

class NativeBluetoothService {
  constructor(
    private readonly deviceId: string,
    private readonly service: BleService,
  ) {}

  getCharacteristic = async (characteristicUuid: string) => {
    const requestedUuid = normalizeUuid(characteristicUuid);
    const characteristic = this.service.characteristics.find((candidate) => (
      normalizeUuid(candidate.uuid) === requestedUuid
    ));
    if (!characteristic) {
      throw new Error(`Bluetooth characteristic ${requestedUuid} is unavailable.`);
    }
    return new NativeBluetoothCharacteristic(this.deviceId, normalizeUuid(this.service.uuid), requestedUuid);
  };
}

class NativeBluetoothServer {
  connected = false;
  private services: BleService[] = [];

  constructor(
    private readonly deviceId: string,
    private readonly onDisconnect: () => void,
  ) {}

  connect = async () => {
    if (!this.connected) {
      await initializeNativeBluetooth();
      try {
        await BleClient.connect(this.deviceId, () => {
          this.connected = false;
          this.onDisconnect();
        });
        this.connected = true;
        this.services = await BleClient.getServices(this.deviceId);
      } catch (error) {
        this.connected = false;
        // A service-discovery failure happens after CoreBluetooth has already
        // connected. Always tear that partial link down so a retry is not
        // blocked by an orphaned native connection.
        await BleClient.disconnect(this.deviceId).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`The Wattbike was found, but its live data connection failed. ${message}`);
      }
    }
    return this;
  };

  disconnect = () => {
    this.connected = false;
    void BleClient.disconnect(this.deviceId).catch(() => undefined);
  };

  getPrimaryService = async (serviceUuid: string) => {
    const requestedUuid = normalizeUuid(serviceUuid);
    const service = this.services.find((candidate) => normalizeUuid(candidate.uuid) === requestedUuid);
    if (!service) {
      throw new Error(`Bluetooth service ${requestedUuid} is unavailable.`);
    }
    return new NativeBluetoothService(this.deviceId, service);
  };
}

class NativeBluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt: NativeBluetoothServer;

  constructor(device: BleDevice) {
    super();
    this.id = device.deviceId;
    this.name = device.name;
    this.gatt = new NativeBluetoothServer(device.deviceId, () => {
      this.dispatchEvent(new Event('gattserverdisconnected'));
    });
  }
}

function nativeRequestOptions(options: BluetoothRequestDeviceOptions) {
  const optionalServices = options.optionalServices.map(normalizeUuid);
  const filters = options.filters ?? [];
  const namePrefixes = filters
    .flatMap((filter) => filter.namePrefix?.trim() ? [filter.namePrefix.trim()] : [])
    .sort((left, right) => left.length - right.length);
  // Web Bluetooth filters are OR conditions, while the Capacitor plugin can
  // express only one native name prefix. The shortest Wattbike prefix covers
  // WattbikePM model names too. Do not filter by service UUID on iOS: Model B
  // monitors advertise their WattbikePM name but may omit service UUIDs until
  // after connection.
  const namePrefix = namePrefixes.find((candidate) => (
    namePrefixes.every((other) => other.toLowerCase().startsWith(candidate.toLowerCase()))
  ));
  const exactNames = filters
    .flatMap((filter) => filter.name?.trim() ? [filter.name.trim()] : []);
  return {
    displayMode: 'list' as const,
    optionalServices,
    ...(namePrefix
      ? { namePrefix }
      : exactNames.length === 1
        ? { name: exactNames[0] }
        : {}),
  };
}

function installNavigatorBluetooth(bluetooth: object) {
  try {
    Object.defineProperty(window.navigator, 'bluetooth', {
      configurable: true,
      enumerable: true,
      value: bluetooth,
    });
  } catch {
    const navigatorPrototype = Object.getPrototypeOf(window.navigator) as object | null;
    if (!navigatorPrototype) {
      throw new Error('The native app could not expose its Bluetooth bridge to TrackLab.');
    }
    Object.defineProperty(navigatorPrototype, 'bluetooth', {
      configurable: true,
      enumerable: true,
      value: bluetooth,
    });
  }
}

export async function installCapacitorBluetoothBridge({ nativeShell = false }: { nativeShell?: boolean } = {}) {
  if (!nativeShell && !Capacitor.isNativePlatform()) {
    return false;
  }

  const bluetooth = {
    getDevices: async () => {
      const deviceIds = readSavedNativeDeviceIds();
      if (deviceIds.length === 0) {
        return [];
      }
      await initializeNativeBluetooth();
      const devices = await BleClient.getDevices(deviceIds);
      return devices.map((device) => new NativeBluetoothDevice(device));
    },
    requestDevice: async (options: BluetoothRequestDeviceOptions) => {
      await initializeNativeBluetooth();
      let device: BleDevice;
      try {
        device = await BleClient.requestDevice(nativeRequestOptions(options));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Native Wattbike scan did not complete. ${message}`);
      }
      saveNativeDeviceId(device.deviceId);
      return new NativeBluetoothDevice(device);
    },
  };

  installNavigatorBluetooth(bluetooth);
  return true;
}
