import { EventEmitter } from 'node:events';

const defaultProfileIds = ['power', 'fitness', 'speed-cadence', 'cadence', 'speed', 'raw'];
const commonMetricEvents = ['fitnessData', 'powerData', 'speedData', 'cadenceData'];
const defaultMaxEstimatedSpeedKph = 55;
const defaultPowerSpeedGain = 2.1;
const defaultCadenceSpeedGain = 0.12;
const defaultBaseDriveKph = 4;

const profileDefinitions = {
  fitness: {
    label: 'Fitness Equipment',
    scannerExport: 'FitnessEquipmentScanner',
    events: ['fitnessData'],
  },
  power: {
    label: 'Bicycle Power',
    scannerExport: 'BicyclePowerScanner',
    events: ['powerData'],
  },
  'speed-cadence': {
    label: 'Speed/Cadence',
    scannerExport: 'SpeedCadenceScanner',
    events: ['speedData', 'cadenceData'],
  },
  cadence: {
    label: 'Cadence',
    scannerExport: 'CadenceScanner',
    events: ['cadenceData'],
  },
  speed: {
    label: 'Speed',
    scannerExport: 'SpeedScanner',
    events: ['speedData'],
  },
  raw: {
    label: 'Raw ANT+',
    scannerExport: null,
    events: ['rawData'],
  },
};

function parseProfileIds(value) {
  const requested = String(value || 'auto')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (requested.length === 0 || requested.includes('auto')) {
    return defaultProfileIds;
  }

  return requested.filter((profileId) => profileDefinitions[profileId]);
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumber(raw, keys) {
  for (const key of keys) {
    const value = finiteNumber(raw?.[key]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function rounded(value, decimals = 0) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function signalFromRaw(raw) {
  const rssi = finiteNumber(raw?.Rssi ?? raw?.RSSI ?? raw?.rssi);
  if (rssi == null) {
    return 1;
  }

  return Math.max(0.05, Math.min(1, (rssi + 100) / 60));
}

function speedKphFromRaw(raw) {
  const directKph = firstNumber(raw, ['SpeedKph', 'speedKph']);
  if (directKph != null) {
    return directKph;
  }

  const metersPerSecond = firstNumber(raw, [
    'CalculatedSpeed',
    'RealSpeed',
    'VirtualSpeed',
    'SpeedMetersPerSecond',
    'speedMetersPerSecond',
  ]);

  if (metersPerSecond != null) {
    return metersPerSecond * 3.6;
  }

  return null;
}

function speedSourceFromRaw(raw) {
  return speedKphFromRaw(raw) == null ? null : 'measured';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateSpeedKphFromDrive(rawMetrics, previousSample, now) {
  if (rawMetrics.watts == null && rawMetrics.cadence == null) {
    return null;
  }

  const maxEstimatedSpeedKph = finiteNumber(process.env.WATTBIKE_ANT_ESTIMATED_MAX_KPH) ?? defaultMaxEstimatedSpeedKph;
  const powerGain = finiteNumber(process.env.WATTBIKE_ANT_POWER_SPEED_GAIN) ?? defaultPowerSpeedGain;
  const cadenceGain = finiteNumber(process.env.WATTBIKE_ANT_CADENCE_SPEED_GAIN) ?? defaultCadenceSpeedGain;
  const baseDriveKph = finiteNumber(process.env.WATTBIKE_ANT_BASE_DRIVE_KPH) ?? defaultBaseDriveKph;
  const previousKph = finiteNumber(previousSample?.speedKph) ?? 0;
  const previousAt = finiteNumber(previousSample?.speedAt ?? previousSample?.at) ?? now;
  const dt = clamp((now - previousAt) / 1000, 0.08, 1.4);
  const watts = finiteNumber(rawMetrics.watts ?? previousSample?.watts) ?? 0;
  const cadence = finiteNumber(rawMetrics.cadence ?? previousSample?.cadence) ?? 0;
  const hasDriveSignal = watts > 8 || cadence > 8;

  if (!hasDriveSignal) {
    const decelKph = (3.2 + previousKph * 0.28) * dt;
    return Math.max(0, previousKph - decelKph);
  }

  const targetKph = clamp(
    baseDriveKph + Math.sqrt(Math.max(0, watts)) * powerGain + cadence * cadenceGain,
    0,
    maxEstimatedSpeedKph,
  );
  const response = targetKph >= previousKph ? 1.65 : 2.6;
  const alpha = clamp(dt * response, 0.12, 0.9);
  return previousKph + (targetKph - previousKph) * alpha;
}

function normalizeAntSample(profileId, eventName, raw, previousSample) {
  const now = Date.now();
  const deviceId = firstNumber(raw, ['DeviceId', 'DeviceID', 'deviceId', 'id']);
  if (deviceId == null) {
    return null;
  }

  const watts = firstNumber(raw, [
    'Power',
    'InstantaneousPower',
    'CalculatedPower',
    'AveragePower',
    'computedPower',
    'watts',
  ]);
  const cadence = firstNumber(raw, [
    'Cadence',
    'InstantaneousCadence',
    'CalculatedCadence',
    'cadence',
  ]);
  const measuredSpeedKph = speedKphFromRaw(raw);
  const estimatedSpeedKph = measuredSpeedKph == null
    ? estimateSpeedKphFromDrive({ watts, cadence }, previousSample, now)
    : null;
  const speedKph = measuredSpeedKph ?? estimatedSpeedKph;
  const speedSource = speedSourceFromRaw(raw) ?? (speedKph == null ? previousSample?.speedSource : 'estimated');

  if (watts == null && cadence == null && speedKph == null) {
    return null;
  }

  const profileLabel = profileDefinitions[profileId]?.label ?? profileId;
  const sample = {
    at: now,
    source: 'ant',
    antProfile: profileId,
    antEvent: eventName,
    deviceId: Math.round(deviceId),
    label: `ANT+ ${profileLabel} ${Math.round(deviceId)}`,
    watts: Math.max(0, Math.round(watts ?? previousSample?.watts ?? 0)),
    cadence: cadence == null ? previousSample?.cadence ?? null : Math.max(0, Math.round(cadence)),
    speedKph: speedKph == null ? previousSample?.speedKph ?? null : Math.max(0, rounded(speedKph, 1)),
    wattsAt: watts == null ? previousSample?.wattsAt : now,
    cadenceAt: cadence == null ? previousSample?.cadenceAt : now,
    speedAt: speedKph == null ? previousSample?.speedAt : now,
    speedSource,
    signal: signalFromRaw(raw),
  };

  return sample;
}

function serializeRaw(raw) {
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    return {
      byteLength: raw.byteLength,
      hex: Buffer.from(raw).toString('hex'),
    };
  }

  if (raw instanceof DataView) {
    return {
      byteLength: raw.byteLength,
      hex: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('hex'),
    };
  }

  try {
    return JSON.parse(JSON.stringify(raw));
  } catch {
    return String(raw);
  }
}

function parseAntDataView(data) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const messageType = data.byteLength > 2 ? data.getUint8(2) : null;
  const channel = data.byteLength > 3 ? data.getUint8(3) : null;
  const payload = data.byteLength >= 12 ? bytes.subarray(4, 12) : Buffer.alloc(0);
  const extensionFlag = data.byteLength > 12 ? data.getUint8(12) : 0;
  const hasChannelId = Boolean(extensionFlag & 0x80);
  const hasRssi = Boolean(extensionFlag & 0x40);
  const deviceId = hasChannelId && data.byteLength > 14 ? data.getUint16(13, true) : null;
  const deviceType = hasChannelId && data.byteLength > 15 ? data.getUint8(15) : null;
  const transmissionType = hasChannelId && data.byteLength > 16 ? data.getUint8(16) : null;
  const rssi = hasRssi && data.byteLength > 18 && data.getUint8(17) === 0x20 ? data.getInt8(18) : null;
  const threshold = hasRssi && data.byteLength > 19 && data.getUint8(17) === 0x20 ? data.getInt8(19) : null;

  return {
    byteLength: data.byteLength,
    hex: bytes.toString('hex'),
    messageType,
    channel,
    payloadHex: payload.toString('hex'),
    dataPage: payload.length > 0 ? payload[0] : null,
    extensionFlag,
    deviceId,
    deviceType,
    transmissionType,
    rssi,
    threshold,
  };
}

function waitForScannerDetach(scanner, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);

    scanner.once('detached', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
}

export function createAntSource(options = {}) {
  const emitter = new EventEmitter();
  const profileIds = parseProfileIds(options.profile ?? process.env.WATTBIKE_ANT_PROFILE);
  const profileDwellMs = Number(options.profileDwellMs ?? process.env.WATTBIKE_ANT_PROFILE_DWELL_MS ?? 12000);
  const lockOnSample = options.lockOnSample ?? process.env.WATTBIKE_ANT_LOCK_ON_SAMPLE !== '0';
  const wheelCircumference = Number(process.env.WATTBIKE_ANT_WHEEL_CIRCUMFERENCE_M ?? 2.07);
  const lastSamplesByDevice = new Map();

  let stick = null;
  let currentScanner = null;
  let cycleTimer = null;
  let stopped = false;
  let lockedProfile = null;
  let restoreConsoleLog = null;

  function emitStatus(message, extra = {}) {
    emitter.emit('status', {
      at: Date.now(),
      message,
      ...extra,
    });
  }

  function createScanner(Ant, profileId) {
    const definition = profileDefinitions[profileId];
    if (profileId === 'raw') {
      return new class RawAntScanner extends Ant.BaseSensor {
        constructor(rawStick) {
          super(rawStick);
          this.decodeDataCbk = async (data) => {
            this.emit('rawData', parseAntDataView(data));
          };
        }

        updateState() {}

        async scan() {
          await super.scan('receive', 57);
        }
      }(stick);
    }

    const ScannerClass = Ant[definition.scannerExport];
    if (!ScannerClass) {
      throw new Error(`ant-plus-next did not expose ${definition.scannerExport}.`);
    }

    const scanner = new ScannerClass(stick);
    if (Number.isFinite(wheelCircumference) && typeof scanner.setWheelCircumference === 'function') {
      scanner.setWheelCircumference(wheelCircumference);
    }

    return scanner;
  }

  function wireScanner(scanner, profileId) {
    const definition = profileDefinitions[profileId];
    const eventNames = [...new Set([...definition.events, ...commonMetricEvents])];

    for (const eventName of eventNames) {
      scanner.on(eventName, (raw) => {
        emitter.emit('raw', {
          at: Date.now(),
          source: 'ant',
          profile: profileId,
          eventName,
          payload: serializeRaw(raw),
        });

        const deviceId = firstNumber(raw, ['DeviceId', 'DeviceID', 'deviceId', 'id']);
        const previousSample = deviceId == null ? null : lastSamplesByDevice.get(Math.round(deviceId));
        const sample = normalizeAntSample(profileId, eventName, raw, previousSample);
        if (!sample) {
          return;
        }

        lastSamplesByDevice.set(sample.deviceId, sample);
        emitter.emit('bike', sample);

        if (!lockedProfile && lockOnSample && profileIds.length > 1) {
          lockedProfile = profileId;
          emitStatus(`ANT+ ${definition.label} data detected. Staying on this profile for live racing.`, {
            lockedProfile,
            devices: [...lastSamplesByDevice.values()].map((bike) => ({
              deviceId: bike.deviceId,
              label: bike.label,
              connected: true,
              signal: bike.signal,
            })),
          });
        }
      });
    }

    scanner.on('attached', () => {
      emitStatus(`ANT+ scanning ${definition.label}. Pedal each Wattbike in Just Ride to wake broadcasts.`, {
        profile: profileId,
        profiles: profileIds,
      });
    });

    scanner.on('detached', () => {
      emitStatus(`ANT+ ${definition.label} scanner detached.`, { profile: profileId });
    });

    scanner.on('error', (error) => {
      emitter.emit('error', error);
    });
  }

  async function detachCurrentScanner() {
    const scanner = currentScanner;
    currentScanner = null;
    if (!scanner) {
      return;
    }

    try {
      const detached = waitForScannerDetach(scanner);
      await scanner.detach?.();
      await detached;
    } catch (error) {
      emitStatus(`ANT+ scanner detach warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function scanProfile(Ant, profileId) {
    if (stopped) {
      return;
    }

    await detachCurrentScanner();
    const scanner = createScanner(Ant, profileId);
    currentScanner = scanner;
    wireScanner(scanner, profileId);
    await scanner.scan();
  }

  async function cycleProfiles(Ant, index = 0) {
    if (stopped || lockedProfile) {
      return;
    }

    const profileId = profileIds[index % profileIds.length];
    try {
      await scanProfile(Ant, profileId);
    } catch (error) {
      emitter.emit('error', error);
    }

    if (profileIds.length === 1 || stopped || lockedProfile) {
      return;
    }

    cycleTimer = setTimeout(() => {
      cycleProfiles(Ant, index + 1).catch((error) => emitter.emit('error', error));
    }, Math.max(3000, profileDwellMs));
  }

  emitter.start = async () => {
    const Ant = await import('ant-plus-next');
    const requestedStick = String(process.env.WATTBIKE_ANT_STICK ?? '').trim();
    const stickCandidates = [
      requestedStick === '2' ? Ant.GarminStick2 : null,
      requestedStick === '3' ? Ant.GarminStick3 : null,
      requestedStick ? null : Ant.GarminStick3,
      requestedStick ? null : Ant.GarminStick2,
    ].filter(Boolean);

    if (stickCandidates.length === 0) {
      throw new Error('ant-plus-next did not expose GarminStick2/GarminStick3.');
    }

    if (options.suppressLibraryDeviceLog ?? process.env.WATTBIKE_ANT_SUPPRESS_DEVICE_LOG !== '0') {
      const originalConsoleLog = console.log;
      console.log = (...args) => {
        if (args.length === 1 && args[0] === 0) {
          return;
        }
        originalConsoleLog(...args);
      };
      restoreConsoleLog = () => {
        console.log = originalConsoleLog;
        restoreConsoleLog = null;
      };
    }

    let opened = false;
    let lastOpenError = null;

    for (const StickClass of stickCandidates) {
      const candidate = new StickClass({
        throwLibUSBException: true,
      });

      candidate.on('read', (message) => {
        emitter.emit('raw', {
          at: Date.now(),
          source: 'ant-stick',
          eventName: 'read',
          payload: serializeRaw(message),
        });
      });

      candidate.on('shutdown', () => {
        emitStatus('ANT+ USB stick shut down.');
      });

      candidate.on('startup', () => {
        emitStatus(`ANT+ USB stick started. Scan mode: ${profileIds.join(', ')}.`, {
          profile: profileIds.length === 1 ? profileIds[0] : 'auto',
          profiles: profileIds,
          stick: StickClass.name,
        });
        cycleProfiles(Ant).catch((error) => emitter.emit('error', error));
      });

      try {
        opened = await candidate.open();
      } catch (error) {
        lastOpenError = error;
        opened = false;
      }

      if (opened) {
        stick = candidate;
        break;
      }

      await candidate.close?.().catch(() => undefined);
    }

    if (!opened) {
      restoreConsoleLog?.();
      if (lastOpenError) {
        throw lastOpenError;
      }
      throw new Error('ANT+ USB stick was not found or could not be opened.');
    }
  };

  emitter.stop = async () => {
    stopped = true;
    if (cycleTimer) {
      clearTimeout(cycleTimer);
      cycleTimer = null;
    }

    try {
      await detachCurrentScanner();
    } finally {
      await stick?.close?.();
      stick = null;
      restoreConsoleLog?.();
    }
  };

  return emitter;
}
