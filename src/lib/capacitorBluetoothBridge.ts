import { BleClient, type BleDevice, type BleService } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import type { BluetoothRequestDeviceOptions } from './bluetoothDiscovery';

const savedNativeDeviceIdsKey = 'tracklab.native-bluetooth-device-ids.v1';
const bluetoothServiceBase = '-0000-1000-8000-00805f9b34fb';

let initialized = false;

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
  await BleClient.initialize();
  initialized = true;
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
      await BleClient.connect(this.deviceId, () => {
        this.connected = false;
        this.onDisconnect();
      });
      this.connected = true;
      this.services = await BleClient.getServices(this.deviceId);
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
  return {
    displayMode: 'list' as const,
    optionalServices,
  };
}

export async function installCapacitorBluetoothBridge() {
  if (!Capacitor.isNativePlatform()) {
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
      const device = await BleClient.requestDevice(nativeRequestOptions(options));
      saveNativeDeviceId(device.deviceId);
      return new NativeBluetoothDevice(device);
    },
  };

  Object.defineProperty(window.navigator, 'bluetooth', {
    configurable: true,
    enumerable: true,
    value: bluetooth,
  });
  return true;
}
