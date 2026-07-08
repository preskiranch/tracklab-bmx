import { EventEmitter } from 'node:events';

const characteristicUuids = {
  batteryLevel: '2a19',
  cscMeasurement: '2a5b',
  cyclingPowerMeasurement: '2a63',
  indoorBikeData: '2ad2',
};

const defaultMaxDevices = 4;
const defaultWheelCircumferenceMeters = 2.07;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value, decimals = 0) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function hasBytes(view, offset, byteCount) {
  return offset + byteCount <= view.byteLength;
}

function dataViewFromBuffer(data) {
  const buffer = Buffer.from(data ?? []);
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function normalizeUuid(uuid) {
  const compact = String(uuid ?? '').replace(/-/g, '').toLowerCase();
  if (compact.length === 32 && compact.endsWith('00001000800000805f9b34fb')) {
    return compact.slice(4, 8);
  }
  return compact;
}

function positiveDelta(current, previous, max) {
  return current >= previous ? current - previous : current + max - previous;
}

function signalFromRssi(rssi) {
  const value = finiteNumber(rssi);
  if (value == null) {
    return 1;
  }

  return clamp((value + 100) / 60, 0.05, 1);
}

function hashTextToDeviceId(value) {
  let hash = 2166136261;
  const text = String(value || 'wattbike');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 72000 + (Math.abs(hash) % 8000);
}

function deviceIdFromPeripheral(peripheral) {
  const name = peripheral.advertisement?.localName ?? '';
  const serialMatch = name.match(/(\d{4,})/);
  if (serialMatch) {
    const serial = Number(serialMatch[1].slice(-5));
    if (Number.isFinite(serial) && serial > 0) {
      return Math.round(serial);
    }
  }

  return hashTextToDeviceId(peripheral.id || peripheral.address || name);
}

function peripheralLabel(peripheral) {
  return peripheral.advertisement?.localName || peripheral.name || `BLE ${peripheral.id || peripheral.address || 'Wattbike'}`;
}

function peripheralMatches(peripheral, options) {
  const idMatch = String(options.idMatch ?? '').trim().toLowerCase();
  const nameMatch = String(options.nameMatch ?? '').trim().toLowerCase();
  const advertisement = peripheral.advertisement ?? {};
  const haystack = [
    peripheral.id,
    peripheral.address,
    peripheral.name,
    advertisement.localName,
    ...(advertisement.serviceUuids ?? []),
  ].filter(Boolean).join(' ').toLowerCase();

  if (idMatch) {
    return haystack.includes(idMatch);
  }

  if (nameMatch) {
    return haystack.includes(nameMatch);
  }

  return haystack.includes('wattbike');
}

function cadenceFromCrankDeltas(cache, deviceId, revolutions, eventTime) {
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

function speedFromWheelDeltas(cache, deviceId, revolutions, eventTime, wheelCircumferenceMeters) {
  const previous = cache.get(deviceId);
  cache.set(deviceId, { eventTime, revolutions });

  if (!previous) {
    return null;
  }

  const revolutionDelta = positiveDelta(revolutions, previous.revolutions, 4294967296);
  const timeDeltaTicks = positiveDelta(eventTime, previous.eventTime, 65536);
  if (revolutionDelta <= 0 || timeDeltaTicks <= 0) {
    return null;
  }

  return (revolutionDelta * wheelCircumferenceMeters / (timeDeltaTicks / 1024)) * 3.6;
}

function readUint24(view, offset) {
  return view.getUint8(offset) + (view.getUint8(offset + 1) << 8) + (view.getUint8(offset + 2) << 16);
}

function parseIndoorBikeData(data) {
  const view = dataViewFromBuffer(data);
  if (!hasBytes(view, 0, 2)) {
    return {};
  }

  const flags = view.getUint16(0, true);
  let offset = 2;
  const sample = {};

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

function parseCyclingPowerMeasurement(data, deviceId, crankCache) {
  const view = dataViewFromBuffer(data);
  if (!hasBytes(view, 0, 4)) {
    return {};
  }

  const flags = view.getUint16(0, true);
  let offset = 2;
  const sample = {
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
  }

  return sample;
}

function parseCscMeasurement(data, deviceId, crankCache, wheelCache, wheelCircumferenceMeters) {
  const view = dataViewFromBuffer(data);
  if (!hasBytes(view, 0, 1)) {
    return {};
  }

  const flags = view.getUint8(0);
  let offset = 1;
  const sample = {};

  if ((flags & 0x01) !== 0 && hasBytes(view, offset, 6)) {
    const speedKph = speedFromWheelDeltas(
      wheelCache,
      deviceId,
      view.getUint32(offset, true),
      view.getUint16(offset + 4, true),
      wheelCircumferenceMeters,
    );
    if (speedKph != null) {
      sample.speedKph = speedKph;
    }
    offset += 6;
  }

  if ((flags & 0x02) !== 0 && hasBytes(view, offset, 4)) {
    const cadence = cadenceFromCrankDeltas(
      crankCache,
      deviceId,
      view.getUint16(offset, true),
      view.getUint16(offset + 2, true),
    );
    if (cadence != null) {
      sample.cadence = cadence;
    }
  }

  return sample;
}

function sampleHasMetric(partial) {
  return ['battery', 'cadence', 'speedKph', 'watts'].some((key) => Object.hasOwn(partial, key));
}

function loadNoble() {
  return import('@abandonware/noble').then((module) => module.default ?? module);
}

async function waitForBluetooth(noble) {
  if (noble.state === 'poweredOn') {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Bluetooth adapter did not become poweredOn. Current state: ${noble.state}`));
    }, 30000);

    const cleanup = () => {
      clearTimeout(timeout);
      noble.removeListener('stateChange', onStateChange);
    };

    const onStateChange = (state) => {
      if (state === 'poweredOn') {
        cleanup();
        resolve();
      } else if (['unsupported', 'unauthorized'].includes(state)) {
        cleanup();
        reject(new Error(`Bluetooth adapter state is ${state}.`));
      }
    };

    noble.on('stateChange', onStateChange);
  });
}

export function createBleSource(options = {}) {
  const emitter = new EventEmitter();
  const maxDevices = Math.max(1, Math.min(8, Number(options.maxDevices ?? process.env.WATTBIKE_BLE_MAX_DEVICES ?? defaultMaxDevices)));
  const nameMatch = options.nameMatch ?? process.env.WATTBIKE_BLE_NAME_MATCH ?? 'Wattbike';
  const idMatch = options.idMatch ?? process.env.WATTBIKE_BLE_ID ?? '';
  const wheelCircumferenceMeters = finiteNumber(options.wheelCircumferenceMeters ?? process.env.WATTBIKE_BLE_WHEEL_CIRCUMFERENCE_M)
    ?? defaultWheelCircumferenceMeters;

  const connectedByPeripheral = new Map();
  const connectingIds = new Set();
  const knownDevices = new Map();
  const lastSamplesByDevice = new Map();
  const powerCrankCache = new Map();
  const cscCrankCache = new Map();
  const wheelCache = new Map();

  let noble = null;
  let stopped = false;

  function devicesPayload() {
    return [...knownDevices.values()]
      .sort((a, b) => a.deviceId - b.deviceId)
      .map((device) => ({
        at: device.at,
        deviceId: device.deviceId,
        label: device.label,
        connected: device.connected,
        signal: device.signal,
        source: 'bluetooth',
      }));
  }

  function emitStatus(message, extra = {}) {
    emitter.emit('status', {
      at: Date.now(),
      devices: devicesPayload(),
      message,
      ...extra,
    });
  }

  function rememberDevice(peripheral, connected) {
    const deviceId = deviceIdFromPeripheral(peripheral);
    const label = peripheralLabel(peripheral);
    const signal = signalFromRssi(peripheral.rssi);
    knownDevices.set(deviceId, {
      at: Date.now(),
      deviceId,
      label,
      connected,
      signal,
    });
    return { deviceId, label, signal };
  }

  function emitBikeSample(peripheral, partial) {
    if (!sampleHasMetric(partial)) {
      return;
    }

    const now = Date.now();
    const { deviceId, label, signal } = rememberDevice(peripheral, true);
    const previous = lastSamplesByDevice.get(deviceId);
    const hasWatts = Object.hasOwn(partial, 'watts');
    const hasCadence = Object.hasOwn(partial, 'cadence');
    const hasSpeed = Object.hasOwn(partial, 'speedKph');
    const hasBattery = Object.hasOwn(partial, 'battery');

    const sample = {
      at: now,
      source: 'bluetooth',
      deviceId,
      label,
      watts: hasWatts ? Math.max(0, Math.round(partial.watts ?? 0)) : previous?.watts ?? 0,
      cadence: hasCadence ? Math.max(0, Math.round(partial.cadence ?? 0)) : previous?.cadence ?? null,
      speedKph: hasSpeed ? Math.max(0, rounded(partial.speedKph ?? 0, 1)) : previous?.speedKph ?? null,
      wattsAt: hasWatts ? now : previous?.wattsAt,
      cadenceAt: hasCadence ? now : previous?.cadenceAt,
      speedAt: hasSpeed ? now : previous?.speedAt,
      speedSource: hasSpeed ? 'measured' : previous?.speedSource,
      signal,
      battery: hasBattery ? partial.battery : previous?.battery,
    };

    lastSamplesByDevice.set(deviceId, sample);
    emitter.emit('bike', sample);
  }

  async function subscribeCharacteristic(peripheral, characteristic, onData) {
    characteristic.on('data', onData);
    try {
      await characteristic.subscribeAsync();
      return true;
    } catch (error) {
      characteristic.removeListener('data', onData);
      emitStatus(`Bluetooth subscription failed for ${peripheralLabel(peripheral)}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function connectPeripheral(peripheral) {
    if (stopped || connectingIds.has(peripheral.id) || connectedByPeripheral.has(peripheral.id)) {
      return;
    }

    const activeCount = connectedByPeripheral.size + connectingIds.size;
    if (activeCount >= maxDevices) {
      return;
    }

    connectingIds.add(peripheral.id);
    rememberDevice(peripheral, false);
    emitStatus(`Bluetooth Wattbike found: ${peripheralLabel(peripheral)}. Connecting.`);

    try {
      await peripheral.connectAsync();
      if (stopped) {
        await peripheral.disconnectAsync().catch(() => undefined);
        return;
      }

      const device = rememberDevice(peripheral, true);
      const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
      const subscriptions = [];
      let metricSubscriptions = 0;

      for (const characteristic of characteristics) {
        const uuid = normalizeUuid(characteristic.uuid);
        const properties = characteristic.properties ?? [];

        if (uuid === characteristicUuids.batteryLevel && properties.includes('read')) {
          try {
            const batteryValue = await characteristic.readAsync();
            const view = dataViewFromBuffer(batteryValue);
            if (hasBytes(view, 0, 1)) {
              emitBikeSample(peripheral, { battery: view.getUint8(0) });
            }
          } catch {
            // Battery is optional; live power/cadence is the important path.
          }
        }

        if (!properties.some((property) => property === 'notify' || property === 'indicate')) {
          continue;
        }

        let onData = null;
        if (uuid === characteristicUuids.cyclingPowerMeasurement) {
          onData = (data) => {
            emitBikeSample(peripheral, parseCyclingPowerMeasurement(data, device.deviceId, powerCrankCache));
          };
        } else if (uuid === characteristicUuids.cscMeasurement) {
          onData = (data) => {
            emitBikeSample(peripheral, parseCscMeasurement(data, device.deviceId, cscCrankCache, wheelCache, wheelCircumferenceMeters));
          };
        } else if (uuid === characteristicUuids.indoorBikeData) {
          onData = (data) => {
            emitBikeSample(peripheral, parseIndoorBikeData(data));
          };
        } else if (uuid === characteristicUuids.batteryLevel) {
          onData = (data) => {
            const view = dataViewFromBuffer(data);
            if (hasBytes(view, 0, 1)) {
              emitBikeSample(peripheral, { battery: view.getUint8(0) });
            }
          };
        }

        if (!onData) {
          continue;
        }

        const subscribed = await subscribeCharacteristic(peripheral, characteristic, onData);
        if (subscribed) {
          subscriptions.push({ characteristic, onData });
          if (uuid !== characteristicUuids.batteryLevel) {
            metricSubscriptions += 1;
          }
        }
      }

      if (metricSubscriptions === 0) {
        for (const subscription of subscriptions) {
          subscription.characteristic.removeListener('data', subscription.onData);
        }
        await peripheral.disconnectAsync().catch(() => undefined);
        rememberDevice(peripheral, false);
        emitStatus(`Bluetooth connected to ${device.label}, but no Wattbike power, cadence, or speed feed was available. Check Remote > Bluetooth and Just Ride mode.`);
        return;
      }

      connectedByPeripheral.set(peripheral.id, { peripheral, subscriptions });
      emitStatus(`Bluetooth connected to ${device.label}. Pedal to stream power, cadence, and speed.`, {
        connectedDeviceId: device.deviceId,
      });

      peripheral.once('disconnect', () => {
        for (const subscription of subscriptions) {
          subscription.characteristic.removeListener('data', subscription.onData);
        }

        connectedByPeripheral.delete(peripheral.id);
        knownDevices.set(device.deviceId, {
          ...device,
          connected: false,
          signal: 0,
        });
        emitStatus(`Bluetooth Wattbike disconnected: ${device.label}. The connector will keep scanning.`);
      });
    } catch (error) {
      rememberDevice(peripheral, false);
      emitStatus(`Bluetooth connect failed for ${peripheralLabel(peripheral)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connectingIds.delete(peripheral.id);
    }
  }

  function onDiscover(peripheral) {
    if (stopped || !peripheralMatches(peripheral, { idMatch, nameMatch })) {
      return;
    }

    void connectPeripheral(peripheral).catch((error) => {
      emitter.emit('error', error);
    });
  }

  emitter.start = async () => {
    stopped = false;
    noble = await loadNoble();
    noble.on('warning', (message) => emitStatus(`Bluetooth adapter warning: ${message}`));
    await waitForBluetooth(noble);
    noble.on('discover', onDiscover);
    await noble.startScanningAsync([], true);
    emitStatus('Bluetooth bridge scanning for Wattbikes. Put each monitor in Settings > Remote > Bluetooth On, enter Just Ride, then pedal.', {
      maxDevices,
    });
  };

  emitter.stop = async () => {
    stopped = true;
    if (noble) {
      noble.removeListener('discover', onDiscover);
      await noble.stopScanningAsync().catch(() => undefined);
    }

    const connected = [...connectedByPeripheral.values()];
    connectedByPeripheral.clear();
    for (const connection of connected) {
      for (const subscription of connection.subscriptions) {
        try {
          await subscription.characteristic.unsubscribeAsync();
        } catch {
          // Device may already be gone.
        }
        subscription.characteristic.removeListener('data', subscription.onData);
      }
      await connection.peripheral.disconnectAsync().catch(() => undefined);
    }

    for (const [deviceId, device] of knownDevices) {
      knownDevices.set(deviceId, {
        ...device,
        connected: false,
        signal: 0,
      });
    }
    emitStatus('Bluetooth bridge stopped.');
  };

  return emitter;
}
