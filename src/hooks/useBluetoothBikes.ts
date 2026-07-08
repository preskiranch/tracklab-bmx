import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BikeSample, ConnectedBikeDevice } from '../types';

type BluetoothConnectionState = 'unsupported' | 'idle' | 'connecting' | 'open' | 'error';

type BluetoothBikeDevice = ConnectedBikeDevice;

type BluetoothBikeSnapshot = {
  connectBike: () => Promise<void>;
  connection: BluetoothConnectionState;
  connectedCount: number;
  devices: BluetoothBikeDevice[];
  error: string | null;
  samplesByDevice: Map<number, BikeSample>;
  status: string;
  supported: boolean;
};

type BluetoothValueEvent = Event & {
  target: {
    value?: DataView;
  };
};

type BluetoothCharacteristic = EventTarget & {
  readValue?: () => Promise<DataView>;
  startNotifications: () => Promise<BluetoothCharacteristic>;
};

type BluetoothService = {
  getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristic>;
};

type BluetoothServer = {
  connected: boolean;
  getPrimaryService: (uuid: string) => Promise<BluetoothService>;
};

type BluetoothDeviceFilter = {
  name?: string;
  namePrefix?: string;
  services?: string[];
};

type BluetoothDeviceLike = EventTarget & {
  gatt?: {
    connect: () => Promise<BluetoothServer>;
  };
  id: string;
  name?: string;
};

type BluetoothApi = {
  requestDevice: (options: {
    acceptAllDevices?: boolean;
    filters?: BluetoothDeviceFilter[];
    optionalServices: string[];
  }) => Promise<BluetoothDeviceLike>;
};

type BluetoothNavigator = Navigator & {
  bluetooth?: BluetoothApi;
};

type PartialBikeSample = Partial<Pick<BikeSample, 'battery' | 'cadence' | 'speedKph' | 'watts'>>;

const bluetoothBaseDeviceId = 71000;
const unsupportedTabletBluetoothMessage = 'Direct Bluetooth is not available in this tablet browser. iPad and iPhone Chrome/Safari cannot pair with Wattbikes from a website; use Advanced Connector on the Mac/PC near the bikes, or use Android Chrome if Web Bluetooth is available.';
const bluetoothServices = {
  battery: '0000180f-0000-1000-8000-00805f9b34fb',
  cyclingPower: '00001818-0000-1000-8000-00805f9b34fb',
  cyclingSpeedCadence: '00001816-0000-1000-8000-00805f9b34fb',
  fitnessMachine: '00001826-0000-1000-8000-00805f9b34fb',
  wattbike: 'f7461223-d7c1-11e4-9ab1-0002a5d5c51b',
};

const bluetoothFilters: BluetoothDeviceFilter[] = [
  { namePrefix: 'Wattbike' },
  { namePrefix: 'WattbikePM' },
  { services: [bluetoothServices.cyclingPower] },
  { services: [bluetoothServices.cyclingSpeedCadence] },
  { services: [bluetoothServices.fitnessMachine] },
];

const bluetoothCharacteristics = {
  batteryLevel: '00002a19-0000-1000-8000-00805f9b34fb',
  cscMeasurement: '00002a5b-0000-1000-8000-00805f9b34fb',
  cyclingPowerMeasurement: '00002a63-0000-1000-8000-00805f9b34fb',
  indoorBikeData: '00002ad2-0000-1000-8000-00805f9b34fb',
};

function hasBytes(view: DataView, offset: number, byteCount: number) {
  return offset + byteCount <= view.byteLength;
}

function readUint24(view: DataView, offset: number) {
  return view.getUint8(offset) + (view.getUint8(offset + 1) << 8) + (view.getUint8(offset + 2) << 16);
}

function positiveDelta(current: number, previous: number, max: number) {
  return current >= previous ? current - previous : current + max - previous;
}

function isAppleMobileBrowser() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(userAgent)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function unsupportedBluetoothMessage() {
  return isAppleMobileBrowser()
    ? unsupportedTabletBluetoothMessage
    : 'This browser does not support direct Bluetooth bike pairing. Use a desktop Chrome/Edge browser, Android Chrome with Web Bluetooth, or Advanced Connector on the Mac/PC near the bikes.';
}

function wattbikeMonitorIdFromName(name: string | undefined) {
  const digits = name?.match(/(\d{4,})/g)?.at(-1);
  if (!digits) {
    return null;
  }

  const monitorDigits = digits.length > 5 ? digits.slice(-5) : digits;
  const deviceId = Number(monitorDigits);
  return Number.isFinite(deviceId) && deviceId > 0 ? Math.round(deviceId) : null;
}

function parseIndoorBikeData(view: DataView): PartialBikeSample {
  if (!hasBytes(view, 0, 2)) {
    return {};
  }

  const flags = view.getUint16(0, true);
  let offset = 2;
  const sample: PartialBikeSample = {};

  if ((flags & 0x01) === 0 && hasBytes(view, offset, 2)) {
    sample.speedKph = Number((view.getUint16(offset, true) / 100).toFixed(2));
    offset += 2;
  }

  if ((flags & 0x02) !== 0) {
    offset += 2;
  }

  if ((flags & 0x04) !== 0 && hasBytes(view, offset, 2)) {
    sample.cadence = Math.round(view.getUint16(offset, true) / 2);
    offset += 2;
  }

  if ((flags & 0x08) !== 0) {
    offset += 2;
  }

  if ((flags & 0x10) !== 0 && hasBytes(view, offset, 3)) {
    readUint24(view, offset);
    offset += 3;
  }

  if ((flags & 0x20) !== 0) {
    offset += 2;
  }

  if ((flags & 0x40) !== 0 && hasBytes(view, offset, 2)) {
    sample.watts = Math.max(0, view.getInt16(offset, true));
    offset += 2;
  }

  if ((flags & 0x80) !== 0) {
    offset += 2;
  }

  if ((flags & 0x100) !== 0) {
    offset += 5;
  }

  if ((flags & 0x200) !== 0) {
    offset += 1;
  }

  if ((flags & 0x400) !== 0) {
    offset += 1;
  }

  if ((flags & 0x800) !== 0) {
    offset += 2;
  }

  if ((flags & 0x1000) !== 0) {
    offset += 2;
  }

  return sample;
}

function cadenceFromCrankDeltas(
  cache: Map<number, { eventTime: number; revolutions: number }>,
  deviceId: number,
  revolutions: number,
  eventTime: number,
) {
  const previous = cache.get(deviceId);
  cache.set(deviceId, { eventTime, revolutions });

  if (!previous) {
    return null;
  }

  const revolutionDelta = positiveDelta(revolutions, previous.revolutions, 65536);
  const timeDeltaTicks = positiveDelta(eventTime, previous.eventTime, 65536);
  if (revolutionDelta <= 0 || timeDeltaTicks <= 0) {
    return null;
  }

  return Math.round((revolutionDelta / (timeDeltaTicks / 1024)) * 60);
}

function parseCyclingPowerMeasurement(
  view: DataView,
  deviceId: number,
  crankCache: Map<number, { eventTime: number; revolutions: number }>,
): PartialBikeSample {
  if (!hasBytes(view, 0, 4)) {
    return {};
  }

  const flags = view.getUint16(0, true);
  let offset = 2;
  const sample: PartialBikeSample = {
    watts: Math.max(0, view.getInt16(offset, true)),
  };
  offset += 2;

  if ((flags & 0x01) !== 0) {
    offset += 1;
  }

  if ((flags & 0x04) !== 0) {
    offset += 2;
  }

  if ((flags & 0x10) !== 0) {
    offset += 6;
  }

  if ((flags & 0x20) !== 0 && hasBytes(view, offset, 4)) {
    const cadence = cadenceFromCrankDeltas(
      crankCache,
      deviceId,
      view.getUint16(offset, true),
      view.getUint16(offset + 2, true),
    );
    if (cadence != null) {
      sample.cadence = cadence;
    }
    offset += 4;
  }

  if ((flags & 0x40) !== 0) {
    offset += 4;
  }

  if ((flags & 0x80) !== 0) {
    offset += 4;
  }

  if ((flags & 0x100) !== 0) {
    offset += 3;
  }

  if ((flags & 0x200) !== 0) {
    offset += 2;
  }

  if ((flags & 0x400) !== 0) {
    offset += 2;
  }

  if ((flags & 0x800) !== 0) {
    offset += 2;
  }

  return sample;
}

function parseCscMeasurement(
  view: DataView,
  deviceId: number,
  crankCache: Map<number, { eventTime: number; revolutions: number }>,
): PartialBikeSample {
  if (!hasBytes(view, 0, 1)) {
    return {};
  }

  const flags = view.getUint8(0);
  let offset = 1;

  if ((flags & 0x01) !== 0) {
    offset += 6;
  }

  if ((flags & 0x02) === 0 || !hasBytes(view, offset, 4)) {
    return {};
  }

  const cadence = cadenceFromCrankDeltas(
    crankCache,
    deviceId,
    view.getUint16(offset, true),
    view.getUint16(offset + 2, true),
  );

  return cadence == null ? {} : { cadence };
}

export function useBluetoothBikes(): BluetoothBikeSnapshot {
  const [connection, setConnection] = useState<BluetoothConnectionState>(() => (
    (navigator as BluetoothNavigator).bluetooth ? 'idle' : 'unsupported'
  ));
  const [devices, setDevices] = useState<BluetoothBikeDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [samplesByDevice, setSamplesByDevice] = useState<Map<number, BikeSample>>(new Map());
  const deviceIdsRef = useRef<Map<string, number>>(new Map());
  const crankCacheRef = useRef<Map<number, { eventTime: number; revolutions: number }>>(new Map());
  const listenerCleanupRef = useRef<(() => void)[]>([]);
  const supported = Boolean((navigator as BluetoothNavigator).bluetooth);

  useEffect(() => () => {
    listenerCleanupRef.current.forEach((cleanup) => cleanup());
    listenerCleanupRef.current = [];
  }, []);

  const setDeviceConnected = useCallback((deviceId: number, label: string, connected: boolean) => {
    setDevices((current) => {
      const existing = current.find((device) => device.deviceId === deviceId);
      const nextDevice: BluetoothBikeDevice = {
        at: connected ? Date.now() : existing?.at,
        connected,
        connectionOrigin: 'direct-bluetooth',
        deviceId,
        label,
        signal: connected ? 1 : 0,
        source: 'bluetooth',
      };
      if (existing) {
        return current.map((device) => (
          device.deviceId === deviceId ? nextDevice : device
        ));
      }

      return [...current, nextDevice].slice(-4);
    });
  }, []);

  const commitSample = useCallback((deviceId: number, label: string, partial: PartialBikeSample) => {
    setSamplesByDevice((current) => {
      const previous = current.get(deviceId);
      const receivedAt = Date.now();
      const hasCadence = partial.cadence !== undefined;
      const hasSpeed = partial.speedKph !== undefined;
      const hasWatts = partial.watts !== undefined;
      const hasMotionValue = hasCadence || hasSpeed || hasWatts;
      const next = new Map(current);
      next.set(deviceId, {
        at: hasMotionValue ? receivedAt : previous?.at ?? receivedAt,
        battery: partial.battery ?? previous?.battery,
        cadence: hasCadence ? partial.cadence ?? null : previous?.cadence ?? null,
        cadenceAt: hasCadence ? receivedAt : previous?.cadenceAt,
        deviceId,
        label,
        signal: 1,
        source: 'bluetooth',
        speedKph: hasSpeed ? partial.speedKph ?? null : previous?.speedKph ?? null,
        speedAt: hasSpeed ? receivedAt : previous?.speedAt,
        watts: hasWatts ? partial.watts ?? 0 : previous?.watts ?? 0,
        wattsAt: hasWatts ? receivedAt : previous?.wattsAt,
      });
      return next;
    });
  }, []);

  const connectBike = useCallback(async () => {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) {
      setConnection('unsupported');
      setError(unsupportedBluetoothMessage());
      return;
    }

    setConnection('connecting');
    setError(null);

    try {
      const device = await bluetooth.requestDevice({
        filters: bluetoothFilters,
        optionalServices: Object.values(bluetoothServices),
      });
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Bluetooth device did not expose a GATT server.');
      }

      let numericId = deviceIdsRef.current.get(device.id);
      if (!numericId) {
        numericId = wattbikeMonitorIdFromName(device.name) ?? bluetoothBaseDeviceId + deviceIdsRef.current.size + 1;
        deviceIdsRef.current.set(device.id, numericId);
      }

      const label = device.name?.trim() || `Bluetooth Wattbike ${numericId}`;
      setDeviceConnected(numericId, label, server.connected);

      const disconnectHandler = () => {
        setDeviceConnected(numericId, label, false);
        setConnection('idle');
      };
      device.addEventListener('gattserverdisconnected', disconnectHandler);
      listenerCleanupRef.current.push(() => device.removeEventListener('gattserverdisconnected', disconnectHandler));

      let subscriptions = 0;
      const subscribe = async (
        serviceUuid: string,
        characteristicUuid: string,
        onValue: (value: DataView) => PartialBikeSample,
      ) => {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          const characteristic = await service.getCharacteristic(characteristicUuid);
          const listener = (event: Event) => {
            const value = (event as BluetoothValueEvent).target.value;
            if (value) {
              commitSample(numericId, label, onValue(value));
            }
          };
          await characteristic.startNotifications();
          characteristic.addEventListener('characteristicvaluechanged', listener);
          listenerCleanupRef.current.push(() => characteristic.removeEventListener('characteristicvaluechanged', listener));
          subscriptions += 1;
        } catch {
          // Wattbike models vary; unsupported standard services are expected.
        }
      };

      await subscribe(
        bluetoothServices.fitnessMachine,
        bluetoothCharacteristics.indoorBikeData,
        parseIndoorBikeData,
      );
      await subscribe(
        bluetoothServices.cyclingPower,
        bluetoothCharacteristics.cyclingPowerMeasurement,
        (value) => parseCyclingPowerMeasurement(value, numericId, crankCacheRef.current),
      );
      await subscribe(
        bluetoothServices.cyclingSpeedCadence,
        bluetoothCharacteristics.cscMeasurement,
        (value) => parseCscMeasurement(value, numericId, crankCacheRef.current),
      );

      try {
        const batteryService = await server.getPrimaryService(bluetoothServices.battery);
        const batteryLevel = await batteryService.getCharacteristic(bluetoothCharacteristics.batteryLevel);
        const value = await batteryLevel.readValue?.();
        if (value && hasBytes(value, 0, 1)) {
          commitSample(numericId, label, { battery: value.getUint8(0) });
        }
      } catch {
        // Battery is optional.
      }

      if (subscriptions === 0) {
        throw new Error('No FTMS, Cycling Power, or Cycling Speed/Cadence service was found on that Bluetooth device.');
      }

      setConnection('open');
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : 'Bluetooth pairing was cancelled or failed.';
      setConnection('error');
      setError(message);
    }
  }, [commitSample, setDeviceConnected]);

  return useMemo(() => {
    const connectedCount = devices.filter((device) => device.connected).length;
    const status = !supported
      ? unsupportedBluetoothMessage()
      : connection === 'connecting'
        ? 'Choose a Wattbike from the Bluetooth pairing prompt.'
        : error
          ? error
          : connectedCount > 0
            ? `${connectedCount} Bluetooth bike${connectedCount === 1 ? '' : 's'} connected.`
            : 'Use Bluetooth pairing to connect Wattbikes. On Model B, turn Settings > Remote > Bluetooth On, then enter Just Ride and pedal.';

    return {
      connectBike,
      connectedCount,
      connection,
      devices,
      error,
      samplesByDevice,
      status,
      supported,
    };
  }, [connectBike, connection, devices, error, samplesByDevice, supported]);
}
