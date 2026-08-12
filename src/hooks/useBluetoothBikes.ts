import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cleanBikeCadenceRpm,
  cleanBikeSpeedKph,
  cleanBikeWatts,
  maxReasonableBikeCadenceRpm,
  sanitizeBikeMetricPatch,
  type BikeMetricPatch,
} from '../lib/bikeSampleSanity';
import {
  assignBluetoothBikeDeviceId,
  parseBluetoothBikeIdentityAssignments,
  serializeBluetoothBikeIdentityAssignments,
} from '../lib/bluetoothBikeIdentity';
import { KeyedCleanupRegistry } from '../lib/keyedCleanupRegistry';
import { removeBikeSample, upsertBoundedBikeSample } from '../lib/liveBikeRegistry';
import {
  isWindowsBluetoothPlatform,
  shouldReconnectWattbikeBluetoothDevice,
  wattbikeBluetoothRequestOptions,
  wattbikeBluetoothServices,
  type BluetoothRequestDeviceOptions,
} from '../lib/bluetoothDiscovery';
import { liveBikeTimeoutMs } from '../data';
import type { BikeSample, ConnectedBikeDevice } from '../types';

type BluetoothConnectionState = 'unsupported' | 'idle' | 'connecting' | 'open' | 'error';

type BluetoothBikeDevice = ConnectedBikeDevice;

type BluetoothBikeSnapshot = {
  authorizedCount: number;
  connectBike: () => Promise<boolean>;
  connection: BluetoothConnectionState;
  connectedCount: number;
  devices: BluetoothBikeDevice[];
  error: string | null;
  samplesByDevice: Map<number, BikeSample>;
  reconnectSavedBikes: () => Promise<number>;
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
  stopNotifications?: () => Promise<BluetoothCharacteristic>;
};

type BluetoothService = {
  getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristic>;
};

type BluetoothServer = {
  connected: boolean;
  disconnect?: () => void;
  getPrimaryService: (uuid: string) => Promise<BluetoothService>;
};

type BluetoothDeviceLike = EventTarget & {
  gatt?: {
    connected?: boolean;
    connect: () => Promise<BluetoothServer>;
  };
  id: string;
  name?: string;
};

type BluetoothApi = {
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
  requestDevice: (options: BluetoothRequestDeviceOptions) => Promise<BluetoothDeviceLike>;
};

type BluetoothNavigator = Navigator & {
  bluetooth?: BluetoothApi;
};

type PartialBikeSample = BikeMetricPatch;

const bluetoothIdentityStorageKey = 'tracklab.bluetooth-bike-identities.v1';
const unsupportedTabletBluetoothMessage = 'Direct Bluetooth is not available in this tablet browser. iPad and iPhone Chrome/Safari cannot pair with Wattbikes from a website; use Advanced Connector on the Mac/PC near the bikes, or use Android Chrome if Web Bluetooth is available.';
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

function readStoredBluetoothBikeIdentities() {
  try {
    return parseBluetoothBikeIdentityAssignments(window.localStorage.getItem(bluetoothIdentityStorageKey));
  } catch {
    return new Map<string, number>();
  }
}

function persistBluetoothBikeIdentities(assignments: Map<string, number>) {
  try {
    window.localStorage.setItem(
      bluetoothIdentityStorageKey,
      serializeBluetoothBikeIdentityAssignments(assignments),
    );
  } catch {
    // Bluetooth remains usable when browser storage is unavailable.
  }
}

function isBluetoothChooserCancel(error: unknown) {
  const name = typeof error === 'object' && error && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return name === 'NotFoundError'
    || message.includes('cancel')
    || message.includes('no device selected')
    || message.includes('user cancelled');
}

function parseIndoorBikeData(view: DataView): PartialBikeSample {
  if (!hasBytes(view, 0, 2)) {
    return {};
  }

  const flags = view.getUint16(0, true);
  let offset = 2;
  const sample: PartialBikeSample = {};

  if ((flags & 0x01) === 0 && hasBytes(view, offset, 2)) {
    sample.speedKph = cleanBikeSpeedKph(view.getUint16(offset, true) / 100) ?? undefined;
    offset += 2;
  }

  if ((flags & 0x02) !== 0) {
    offset += 2;
  }

  if ((flags & 0x04) !== 0 && hasBytes(view, offset, 2)) {
    sample.cadence = cleanBikeCadenceRpm(view.getUint16(offset, true) / 2) ?? undefined;
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
    sample.watts = cleanBikeWatts(view.getInt16(offset, true)) ?? undefined;
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

  const cadence = Math.round((revolutionDelta / (timeDeltaTicks / 1024)) * 60);
  return cadence > maxReasonableBikeCadenceRpm ? null : cadence;
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
  const sample: PartialBikeSample = {};
  const watts = cleanBikeWatts(view.getInt16(offset, true));
  if (watts != null) {
    sample.watts = watts;
  }
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
  const [authorizedCount, setAuthorizedCount] = useState(0);
  const [devices, setDevices] = useState<BluetoothBikeDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [samplesByDevice, setSamplesByDevice] = useState<Map<number, BikeSample>>(new Map());
  const [now, setNow] = useState(Date.now());
  const deviceIdsRef = useRef<Map<string, number>>(readStoredBluetoothBikeIdentities());
  const crankCacheRef = useRef<Map<number, { eventTime: number; revolutions: number }>>(new Map());
  const connectedBrowserDeviceIdsRef = useRef<Set<string>>(new Set());
  const connectingBrowserDeviceIdsRef = useRef<Set<string>>(new Set());
  const reconnectInFlightRef = useRef(false);
  const listenerCleanupRef = useRef(new KeyedCleanupRegistry<string>());
  const samplesByDeviceRef = useRef<Map<number, BikeSample>>(new Map());
  const supported = Boolean((navigator as BluetoothNavigator).bluetooth);

  useEffect(() => () => {
    listenerCleanupRef.current.clearAll();
  }, []);

  useEffect(() => {
    samplesByDeviceRef.current = samplesByDevice;
  }, [samplesByDevice]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const setDeviceConnected = useCallback((deviceId: number, label: string, connected: boolean) => {
    setDevices((current) => {
      if (!connected) {
        return current.filter((device) => device.deviceId !== deviceId);
      }

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

  const disconnectBluetoothDevice = useCallback((browserDeviceId: string, deviceId: number, label: string) => {
    connectedBrowserDeviceIdsRef.current.delete(browserDeviceId);
    listenerCleanupRef.current.clear(browserDeviceId);
    crankCacheRef.current.delete(deviceId);
    setDeviceConnected(deviceId, label, false);
    setSamplesByDevice((current) => removeBikeSample(current, deviceId));
    setConnection(connectedBrowserDeviceIdsRef.current.size > 0 ? 'open' : 'idle');
  }, [setDeviceConnected]);

  const commitSample = useCallback((deviceId: number, label: string, partial: PartialBikeSample) => {
    setSamplesByDevice((current) => {
      const previous = current.get(deviceId);
      const receivedAt = Date.now();
      const cleanedPartial = sanitizeBikeMetricPatch(partial);
      const hasCadence = cleanedPartial.cadence !== undefined;
      const hasSpeed = cleanedPartial.speedKph !== undefined;
      const hasWatts = cleanedPartial.watts !== undefined;
      const hasBattery = cleanedPartial.battery !== undefined;
      const hasMotionValue = hasCadence || hasSpeed || hasWatts;
      const sample: BikeSample = {
        at: hasMotionValue ? receivedAt : previous?.at ?? receivedAt,
        battery: hasBattery ? cleanedPartial.battery : previous?.battery,
        cadence: hasCadence ? cleanedPartial.cadence ?? null : previous?.cadence ?? null,
        cadenceAt: hasCadence ? receivedAt : previous?.cadenceAt,
        deviceId,
        label,
        signal: 1,
        source: 'bluetooth',
        speedKph: hasSpeed ? cleanedPartial.speedKph ?? null : previous?.speedKph ?? null,
        speedAt: hasSpeed ? receivedAt : previous?.speedAt,
        watts: hasWatts ? cleanedPartial.watts ?? 0 : previous?.watts ?? 0,
        wattsAt: hasWatts ? receivedAt : previous?.wattsAt,
      };
      return upsertBoundedBikeSample(current, sample, 8);
    });
  }, []);

  const connectBluetoothDevice = useCallback(async (device: BluetoothDeviceLike) => {
    const numericId = assignBluetoothBikeDeviceId(device.id, device.name, deviceIdsRef.current);
    persistBluetoothBikeIdentities(deviceIdsRef.current);
    if (connectedBrowserDeviceIdsRef.current.has(device.id)) {
      const sample = samplesByDeviceRef.current.get(numericId);
      if (device.gatt?.connected === true || (sample && Date.now() - sample.at <= liveBikeTimeoutMs)) {
        return false;
      }

      connectedBrowserDeviceIdsRef.current.delete(device.id);
    }

    if (connectingBrowserDeviceIdsRef.current.has(device.id)) {
      return false;
    }

    connectingBrowserDeviceIdsRef.current.add(device.id);
    listenerCleanupRef.current.clear(device.id);

    const label = device.name?.trim() || `Bluetooth Wattbike ${numericId}`;

    try {
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Bluetooth device did not expose a GATT server.');
      }

      connectedBrowserDeviceIdsRef.current.add(device.id);

      const disconnectHandler = () => {
        disconnectBluetoothDevice(device.id, numericId, label);
      };
      device.addEventListener('gattserverdisconnected', disconnectHandler);
      listenerCleanupRef.current.add(
        device.id,
        () => device.removeEventListener('gattserverdisconnected', disconnectHandler),
      );

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
          listenerCleanupRef.current.add(device.id, () => {
            characteristic.removeEventListener('characteristicvaluechanged', listener);
            void characteristic.stopNotifications?.().catch(() => undefined);
          });
          subscriptions += 1;
        } catch {
          // Wattbike models vary; unsupported standard services are expected.
        }
      };

      await subscribe(
        wattbikeBluetoothServices.fitnessMachine,
        bluetoothCharacteristics.indoorBikeData,
        parseIndoorBikeData,
      );
      await subscribe(
        wattbikeBluetoothServices.cyclingPower,
        bluetoothCharacteristics.cyclingPowerMeasurement,
        (value) => parseCyclingPowerMeasurement(value, numericId, crankCacheRef.current),
      );
      await subscribe(
        wattbikeBluetoothServices.cyclingSpeedCadence,
        bluetoothCharacteristics.cscMeasurement,
        (value) => parseCscMeasurement(value, numericId, crankCacheRef.current),
      );

      try {
        const batteryService = await server.getPrimaryService(wattbikeBluetoothServices.battery);
        const batteryLevel = await batteryService.getCharacteristic(bluetoothCharacteristics.batteryLevel);
        const value = await batteryLevel.readValue?.();
        if (value && hasBytes(value, 0, 1)) {
          commitSample(numericId, label, { battery: value.getUint8(0) });
        }
      } catch {
        // Battery is optional.
      }

      if (subscriptions === 0) {
        server.disconnect?.();
        throw new Error('No FTMS, Cycling Power, or Cycling Speed/Cadence service was found on that Bluetooth device.');
      }

      if (!server.connected) {
        throw new Error('Bluetooth bike disconnected before its live data service was ready.');
      }

      setDeviceConnected(numericId, label, true);
      return true;
    } catch (connectError) {
      disconnectBluetoothDevice(device.id, numericId, label);
      throw connectError;
    } finally {
      connectingBrowserDeviceIdsRef.current.delete(device.id);
    }
  }, [commitSample, disconnectBluetoothDevice, setDeviceConnected]);

  const reconnectSavedBikes = useCallback(async () => {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth?.getDevices || reconnectInFlightRef.current) {
      return connectedBrowserDeviceIdsRef.current.size;
    }

    reconnectInFlightRef.current = true;
    try {
      const grantedDevices = await bluetooth.getDevices();
      const savedBrowserDeviceIds = new Set(deviceIdsRef.current.keys());
      const savedBikeDevices = grantedDevices.filter((device) => (
        shouldReconnectWattbikeBluetoothDevice(device.id, device.name, savedBrowserDeviceIds)
      ));
      setAuthorizedCount(Math.min(4, savedBikeDevices.length));
      if (savedBikeDevices.length === 0) {
        return connectedBrowserDeviceIdsRef.current.size;
      }

      setConnection((current) => (current === 'open' ? current : 'connecting'));
      setError(null);

      let connected = 0;
      for (const device of savedBikeDevices) {
        try {
          const didConnect = await connectBluetoothDevice(device);
          connected += didConnect ? 1 : 0;
        } catch {
          // Saved bikes may be off, asleep, or not in Just Ride yet. Keep scanning quietly.
        }
      }

      setConnection(connected > 0 || connectedBrowserDeviceIdsRef.current.size > 0 ? 'open' : 'idle');
      return connectedBrowserDeviceIdsRef.current.size;
    } catch (reconnectError) {
      if (!isBluetoothChooserCancel(reconnectError)) {
        setError(reconnectError instanceof Error ? reconnectError.message : 'Could not reconnect saved Bluetooth bikes.');
      }
      setConnection((current) => (current === 'open' ? 'open' : 'idle'));
      return connectedBrowserDeviceIdsRef.current.size;
    } finally {
      reconnectInFlightRef.current = false;
    }
  }, [connectBluetoothDevice]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;
    const reconnect = () => {
      if (!cancelled) {
        void reconnectSavedBikes();
      }
    };

    reconnect();
    const timer = window.setInterval(reconnect, 5000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reconnectSavedBikes, supported]);

  const connectBike = useCallback(async () => {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) {
      setConnection('unsupported');
      setError(unsupportedBluetoothMessage());
      return false;
    }

    setConnection('connecting');
    setError(null);

    try {
      const device = await bluetooth.requestDevice({
        ...wattbikeBluetoothRequestOptions(navigator.userAgent || ''),
      });
      await connectBluetoothDevice(device);
      setAuthorizedCount((current) => Math.min(
        4,
        Math.max(current, connectedBrowserDeviceIdsRef.current.size),
      ));
      setConnection('open');
      return true;
    } catch (connectError) {
      if (isBluetoothChooserCancel(connectError)) {
        setConnection(connectedBrowserDeviceIdsRef.current.size > 0 ? 'open' : 'idle');
        setError('Bluetooth pairing was cancelled. Click Pair Wattbike when the bike is ready, choose the Wattbike, then pedal in Just Ride.');
        return false;
      }

      setConnection(connectedBrowserDeviceIdsRef.current.size > 0 ? 'open' : 'error');
      setError(connectError instanceof Error ? connectError.message : 'Bluetooth pairing failed.');
      return false;
    }
  }, [connectBluetoothDevice]);

  return useMemo(() => {
    const connectedCount = [...samplesByDevice.values()]
      .filter((sample) => now - sample.at <= liveBikeTimeoutMs)
      .length;
    const status = !supported
      ? unsupportedBluetoothMessage()
      : connection === 'connecting'
        ? 'Pairing with the selected Wattbike and verifying its live data service.'
        : error
          ? error
          : connectedCount > 0
            ? `${connectedCount} Bluetooth bike${connectedCount === 1 ? '' : 's'} live.`
            : connection === 'open'
              ? 'Wattbike paired and connected. Put it in Just Ride and pedal to confirm live data.'
              : isWindowsBluetoothPlatform(navigator.userAgent || '')
                ? 'Bluetooth is ready. On Windows Chrome/Edge, Pair Wattbike shows all nearby Bluetooth devices—choose the Wattbike or its monitor serial. Close Wattbike Hub and disconnect the Mac connector first so the monitor is available.'
                : 'Bluetooth is ready. Saved bikes reconnect automatically; click Pair Wattbike only for first-time pairing.';

    return {
      authorizedCount,
      connectBike,
      connectedCount,
      connection,
      devices,
      error,
      samplesByDevice,
      reconnectSavedBikes,
      status,
      supported,
    };
  }, [authorizedCount, connectBike, connection, devices, error, now, reconnectSavedBikes, samplesByDevice, supported]);
}
