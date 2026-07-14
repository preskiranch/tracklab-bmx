import type { BikeSample, ConnectedBikeDevice } from '../types';

const defaultFutureClockSkewMs = 1_000;

type RaceBikeDeviceOptions = {
  deviceTimeoutMs: number;
  maxDevices: number;
};

export function bikeSampleIsLive(
  sample: BikeSample | undefined,
  now: number,
  timeoutMs: number,
  futureClockSkewMs = defaultFutureClockSkewMs,
) {
  if (!sample || !Number.isFinite(sample.at)) {
    return false;
  }

  const ageMs = now - sample.at;
  return ageMs >= -futureClockSkewMs && ageMs <= timeoutMs;
}

export function connectedDeviceFromBikeSample(sample: BikeSample): ConnectedBikeDevice {
  return {
    at: sample.at,
    connected: true,
    connectionOrigin: 'bridge-sample',
    deviceId: sample.deviceId,
    label: sample.label,
    signal: sample.signal,
    source: sample.source,
  };
}

function isSupplementalBikeDevice(device: ConnectedBikeDevice) {
  const label = device.label.toLowerCase();
  const isSpeedOrCadence = /speed\/cadence|speed cadence|\bcadence\b|\bspeed\b/.test(label);
  const isPrimaryPower = /wattbike|bicycle power|cycling power|fitness|power meter|powermeter/.test(label);
  return isSpeedOrCadence && !isPrimaryPower;
}

function isConnectedBikeDevice(
  device: ConnectedBikeDevice,
  now: number,
  deviceTimeoutMs: number,
) {
  if (!device.connected) {
    return false;
  }

  if (device.connectionOrigin === 'direct-bluetooth') {
    return true;
  }

  if (device.connectionOrigin === 'bridge-status' && device.source === 'bluetooth') {
    return true;
  }

  if (device.source === 'usb') {
    return true;
  }

  return Number.isFinite(device.at)
    && now - Number(device.at) >= -defaultFutureClockSkewMs
    && now - Number(device.at) <= deviceTimeoutMs;
}

export function selectRaceBikeDevices(
  devices: ConnectedBikeDevice[],
  now: number,
  options: RaceBikeDeviceOptions,
) {
  const connectedById = new Map<number, ConnectedBikeDevice>();
  devices.forEach((device) => {
    const deviceId = Number(device.deviceId);
    if (
      !Number.isFinite(deviceId)
      || deviceId <= 0
      || !isConnectedBikeDevice(device, now, options.deviceTimeoutMs)
    ) {
      return;
    }

    const normalizedDevice = {
      ...device,
      deviceId: Math.round(deviceId),
      label: device.label || `Wattbike ${Math.round(deviceId)}`,
    };
    const previous = connectedById.get(normalizedDevice.deviceId);
    if (!previous || (normalizedDevice.at ?? 0) >= (previous.at ?? 0)) {
      connectedById.set(normalizedDevice.deviceId, normalizedDevice);
    }
  });

  const connectedDevices = [...connectedById.values()];
  const primaryDevices = connectedDevices.filter((device) => !isSupplementalBikeDevice(device));
  return (primaryDevices.length > 0 ? primaryDevices : connectedDevices)
    .sort((a, b) => a.deviceId - b.deviceId)
    .slice(0, Math.max(0, options.maxDevices));
}

export function upsertBoundedBikeSample(
  current: Map<number, BikeSample>,
  sample: BikeSample,
  maxEntries = 16,
) {
  const previous = current.get(sample.deviceId);
  if (previous && sample.at < previous.at) {
    return current;
  }

  const next = new Map(current);
  next.set(sample.deviceId, sample);

  const boundedSize = Math.max(1, Math.floor(maxEntries));
  if (next.size <= boundedSize) {
    return next;
  }

  const oldestFirst = [...next.values()].sort((left, right) => left.at - right.at);
  oldestFirst.slice(0, next.size - boundedSize).forEach((entry) => {
    next.delete(entry.deviceId);
  });
  return next;
}

export function removeBikeSample(current: Map<number, BikeSample>, deviceId: number) {
  if (!current.has(deviceId)) {
    return current;
  }

  const next = new Map(current);
  next.delete(deviceId);
  return next;
}

export function retainBikeSamples(
  current: Map<number, BikeSample>,
  retainedDeviceIds: ReadonlySet<number>,
) {
  let changed = false;
  const next = new Map<number, BikeSample>();
  current.forEach((sample, deviceId) => {
    if (retainedDeviceIds.has(deviceId)) {
      next.set(deviceId, sample);
    } else {
      changed = true;
    }
  });
  return changed ? next : current;
}
