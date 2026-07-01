#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const standardServices = {
  '180a': 'Device Information',
  '180f': 'Battery',
  '1816': 'Cycling Speed and Cadence',
  '1818': 'Cycling Power',
  '1826': 'Fitness Machine',
};

const standardCharacteristics = {
  '2a19': 'Battery Level',
  '2a24': 'Model Number String',
  '2a25': 'Serial Number String',
  '2a26': 'Firmware Revision String',
  '2a27': 'Hardware Revision String',
  '2a28': 'Software Revision String',
  '2a29': 'Manufacturer Name String',
  '2a5b': 'CSC Measurement',
  '2a63': 'Cycling Power Measurement',
  '2ad2': 'Indoor Bike Data',
  '2ad3': 'Training Status',
  '2ad4': 'Supported Speed Range',
  '2ad5': 'Supported Inclination Range',
  '2ad6': 'Supported Resistance Level Range',
  '2ad7': 'Supported Heart Rate Range',
  '2ad8': 'Supported Power Range',
  '2ad9': 'Fitness Machine Control Point',
  '2ada': 'Fitness Machine Status',
  '2acc': 'Object Action Control Point',
};

const writableProperties = new Set(['write', 'writeWithoutResponse']);
const notifyProperties = new Set(['notify', 'indicate']);

function printHelp() {
  console.log(`
Wattbike BLE Inspector

Usage:
  npm run ble:inspect -- --scan --seconds 30
  npm run ble:inspect -- --name Wattbike --seconds 120 --read
  npm run ble:inspect -- --id <peripheral-id-or-address> --seconds 120 --read

Options:
  --scan                 Scan only; do not connect.
  --name <text>          Connect to the first device whose name/id/address contains this text.
                         Defaults to WATTBIKE_BLE_NAME_MATCH or "Wattbike".
  --id <text>            Connect to a specific peripheral id/address substring.
  --seconds <number>     Capture duration. Defaults to 30 for scan, 120 for connect.
  --out <path>           JSONL capture path. Defaults to captures/wattbike-ble-<timestamp>.jsonl.
  --read                 Read characteristics that advertise the read property.
  --no-notify            Do not subscribe to notify/indicate characteristics.
  --help                 Show this help.

Environment alternatives:
  WATTBIKE_BLE_NAME_MATCH, WATTBIKE_BLE_ID, WATTBIKE_BLE_SECONDS,
  WATTBIKE_BLE_OUTPUT, WATTBIKE_BLE_READ=1, WATTBIKE_BLE_NOTIFY=0
`);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function asBool(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function byteSummary(buffer) {
  const data = Buffer.from(buffer ?? []);
  const ascii = data
    .toString('utf8')
    .replace(/[^\x20-\x7e]/g, '.')
    .slice(0, 80);

  return {
    byteLength: data.length,
    hex: data.toString('hex'),
    ascii,
  };
}

function uuidName(uuid, names) {
  const normalized = uuid.replace(/-/g, '').toLowerCase();
  const shortUuid = normalized.length === 32 && normalized.endsWith('00001000800000805f9b34fb')
    ? normalized.slice(4, 8)
    : normalized;
  return names[shortUuid] ?? null;
}

function serviceLabel(uuid) {
  const name = uuidName(uuid, standardServices);
  return name ? `${uuid} (${name})` : uuid;
}

function characteristicLabel(characteristic) {
  const name = characteristic.name || uuidName(characteristic.uuid, standardCharacteristics);
  return name ? `${characteristic.uuid} (${name})` : characteristic.uuid;
}

function peripheralSnapshot(peripheral) {
  const advertisement = peripheral.advertisement ?? {};
  return {
    id: peripheral.id,
    address: peripheral.address,
    addressType: peripheral.addressType,
    connectable: peripheral.connectable,
    localName: advertisement.localName ?? null,
    rssi: peripheral.rssi,
    serviceUuids: advertisement.serviceUuids ?? [],
    serviceSolicitationUuids: advertisement.serviceSolicitationUuids ?? [],
    txPowerLevel: advertisement.txPowerLevel ?? null,
    manufacturerData: advertisement.manufacturerData
      ? byteSummary(advertisement.manufacturerData)
      : null,
  };
}

function peripheralDisplayName(peripheral) {
  const snapshot = peripheralSnapshot(peripheral);
  return [
    snapshot.localName || 'Unnamed BLE device',
    snapshot.id ? `id ${snapshot.id}` : null,
    snapshot.address && snapshot.address !== 'unknown' ? `addr ${snapshot.address}` : null,
    Number.isFinite(snapshot.rssi) ? `rssi ${snapshot.rssi}` : null,
  ].filter(Boolean).join(' / ');
}

function peripheralMatches(peripheral, options) {
  const matchText = options.idMatch || options.nameMatch;
  if (!matchText) {
    return true;
  }

  const snapshot = peripheralSnapshot(peripheral);
  const haystack = [
    snapshot.id,
    snapshot.address,
    snapshot.localName,
    ...(snapshot.serviceUuids ?? []),
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(matchText.toLowerCase());
}

function characteristicSnapshot(characteristic) {
  return {
    serviceUuid: characteristic._serviceUuid,
    serviceName: uuidName(characteristic._serviceUuid, standardServices),
    uuid: characteristic.uuid,
    name: characteristic.name || uuidName(characteristic.uuid, standardCharacteristics),
    properties: characteristic.properties ?? [],
    writable: (characteristic.properties ?? []).some((property) => writableProperties.has(property)),
    notifiable: (characteristic.properties ?? []).some((property) => notifyProperties.has(property)),
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class JsonlCapture {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.startedAt = Date.now();
    this.pending = Promise.resolve();
  }

  async open() {
    await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
    await fs.writeFile(this.outputPath, '');
  }

  write(type, details = {}) {
    const event = {
      at: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      type,
      ...details,
    };

    this.pending = this.pending.then(() => fs.appendFile(this.outputPath, `${JSON.stringify(event)}\n`));
    return this.pending;
  }

  async close() {
    await this.pending;
  }
}

async function loadNoble() {
  try {
    const module = await import('@abandonware/noble');
    return module.default ?? module;
  } catch (error) {
    throw new Error(`Unable to load @abandonware/noble: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForBluetooth(noble, capture) {
  await capture.write('adapter-state', { state: noble.state });
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
      void capture.write('adapter-state', { state });
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

async function runScan(noble, capture, options) {
  const seen = new Set();

  noble.on('discover', (peripheral) => {
    const snapshot = peripheralSnapshot(peripheral);
    const key = snapshot.id || snapshot.address || snapshot.localName;
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    const matches = peripheralMatches(peripheral, options);
    const marker = matches ? '*' : ' ';
    console.log(`[ble]${marker} ${peripheralDisplayName(peripheral)}`);
    void capture.write('advertisement', { matches, peripheral: snapshot });
  });

  console.log(`[ble] Scanning for ${options.seconds}s. Capture: ${capture.outputPath}`);
  await capture.write('scan-start', { seconds: options.seconds });
  await noble.startScanningAsync([], true);
  await sleep(options.seconds * 1000);
  await noble.stopScanningAsync();
  await capture.write('scan-stop', { discoveredCount: seen.size });
  console.log(`[ble] Scan complete. ${seen.size} unique devices written to ${capture.outputPath}`);
}

async function findPeripheral(noble, capture, options) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      noble.removeListener('discover', onDiscover);
      try {
        await noble.stopScanningAsync();
      } catch {
        // Adapter may already be stopped.
      }
      reject(new Error(`No BLE device matched "${options.idMatch || options.nameMatch || 'any'}" within ${options.connectTimeoutMs}ms.`));
    }, options.connectTimeoutMs);

    const onDiscover = async (peripheral) => {
      const matches = peripheralMatches(peripheral, options);
      void capture.write('advertisement', { matches, peripheral: peripheralSnapshot(peripheral) });
      if (!matches) {
        return;
      }

      clearTimeout(timeout);
      noble.removeListener('discover', onDiscover);
      await noble.stopScanningAsync();
      resolve(peripheral);
    };

    noble.on('discover', onDiscover);
    void noble.startScanningAsync([], true).catch((error) => {
      clearTimeout(timeout);
      noble.removeListener('discover', onDiscover);
      reject(error);
    });
  });
}

async function inspectPeripheral(peripheral, capture, options) {
  console.log(`[ble] Connecting to ${peripheralDisplayName(peripheral)}`);
  await capture.write('connect-start', { peripheral: peripheralSnapshot(peripheral) });
  await peripheral.connectAsync();
  await capture.write('connected', { peripheral: peripheralSnapshot(peripheral), mtu: peripheral.mtu ?? null });

  peripheral.once('disconnect', () => {
    void capture.write('disconnected', { peripheralId: peripheral.id });
    console.log('[ble] Device disconnected.');
  });

  const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  await capture.write('gatt-discovery', {
    services: services.map((service) => ({
      uuid: service.uuid,
      name: uuidName(service.uuid, standardServices),
    })),
    characteristics: characteristics.map(characteristicSnapshot),
  });

  console.log(`[ble] Services (${services.length}):`);
  for (const service of services) {
    console.log(`  - ${serviceLabel(service.uuid)}`);
  }

  console.log(`[ble] Characteristics (${characteristics.length}):`);
  for (const characteristic of characteristics) {
    const snapshot = characteristicSnapshot(characteristic);
    const tags = [
      snapshot.writable ? 'WRITE' : null,
      snapshot.notifiable ? 'NOTIFY' : null,
    ].filter(Boolean).join(', ');
    console.log(`  - ${serviceLabel(snapshot.serviceUuid)} -> ${characteristicLabel(characteristic)} [${snapshot.properties.join(', ')}]${tags ? ` ${tags}` : ''}`);
  }

  if (options.readCharacteristics) {
    for (const characteristic of characteristics) {
      if (!(characteristic.properties ?? []).includes('read')) {
        continue;
      }

      try {
        const data = await characteristic.readAsync();
        await capture.write('characteristic-read', {
          characteristic: characteristicSnapshot(characteristic),
          value: byteSummary(data),
        });
      } catch (error) {
        await capture.write('characteristic-read-error', {
          characteristic: characteristicSnapshot(characteristic),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const subscriptions = [];
  if (options.subscribeNotifications) {
    for (const characteristic of characteristics) {
      if (!(characteristic.properties ?? []).some((property) => notifyProperties.has(property))) {
        continue;
      }

      const onData = (data, isNotification) => {
        void capture.write('notification', {
          characteristic: characteristicSnapshot(characteristic),
          isNotification,
          value: byteSummary(data),
        });
      };

      try {
        characteristic.on('data', onData);
        await characteristic.subscribeAsync();
        subscriptions.push({ characteristic, onData });
        await capture.write('notification-subscribed', {
          characteristic: characteristicSnapshot(characteristic),
        });
      } catch (error) {
        characteristic.removeListener('data', onData);
        await capture.write('notification-subscribe-error', {
          characteristic: characteristicSnapshot(characteristic),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const writable = characteristics.filter((characteristic) => (
    (characteristic.properties ?? []).some((property) => writableProperties.has(property))
  ));
  await capture.write('writable-characteristics', {
    count: writable.length,
    characteristics: writable.map(characteristicSnapshot),
  });

  console.log(`[ble] Capturing notifications for ${options.seconds}s. Pedal, press buttons, and start/stop sessions on the monitor if safe.`);
  await capture.write('capture-start', { seconds: options.seconds, subscriptionCount: subscriptions.length });
  await sleep(options.seconds * 1000);
  await capture.write('capture-stop', { subscriptionCount: subscriptions.length });

  for (const subscription of subscriptions) {
    try {
      await subscription.characteristic.unsubscribeAsync();
    } catch {
      // The device may already be disconnected.
    }
    subscription.characteristic.removeListener('data', subscription.onData);
  }

  if (peripheral.state === 'connected') {
    await peripheral.disconnectAsync();
  }
}

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    scan: { type: 'boolean' },
    name: { type: 'string' },
    id: { type: 'string' },
    seconds: { type: 'string' },
    out: { type: 'string' },
    read: { type: 'boolean' },
    'no-notify': { type: 'boolean' },
  },
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const scanOnly = Boolean(values.scan || asBool(process.env.WATTBIKE_BLE_SCAN_ONLY));
const notifyEnv = process.env.WATTBIKE_BLE_NOTIFY?.trim();
const outputPath = path.resolve(
  values.out
    ?? process.env.WATTBIKE_BLE_OUTPUT
    ?? path.join('captures', `wattbike-ble-${timestampForFile()}.jsonl`),
);

const options = {
  connectTimeoutMs: asNumber(process.env.WATTBIKE_BLE_CONNECT_TIMEOUT_MS, 30000),
  idMatch: values.id ?? process.env.WATTBIKE_BLE_ID ?? '',
  nameMatch: values.name ?? process.env.WATTBIKE_BLE_NAME_MATCH ?? 'Wattbike',
  outputPath,
  readCharacteristics: Boolean(values.read || asBool(process.env.WATTBIKE_BLE_READ)),
  scanOnly,
  seconds: asNumber(values.seconds ?? process.env.WATTBIKE_BLE_SECONDS, scanOnly ? 30 : 120),
  subscribeNotifications: values['no-notify'] ? false : notifyEnv ? asBool(notifyEnv, true) : true,
};

const capture = new JsonlCapture(outputPath);

try {
  await capture.open();
  await capture.write('inspector-start', {
    node: process.version,
    platform: process.platform,
    options: {
      ...options,
      outputPath: capture.outputPath,
    },
  });

  const noble = await loadNoble();
  noble.on('warning', (message) => {
    console.warn(`[ble] ${message}`);
    void capture.write('adapter-warning', { message });
  });

  await waitForBluetooth(noble, capture);

  if (scanOnly) {
    await runScan(noble, capture, options);
  } else {
    console.log(`[ble] Looking for device matching "${options.idMatch || options.nameMatch || 'any'}". Capture: ${capture.outputPath}`);
    const peripheral = await findPeripheral(noble, capture, options);
    await inspectPeripheral(peripheral, capture, options);
    console.log(`[ble] Capture complete: ${capture.outputPath}`);
  }

  await capture.write('inspector-stop', { ok: true });
  await capture.close();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ble] ${message}`);
  try {
    await capture.write('inspector-stop', { ok: false, message });
    await capture.close();
  } catch {
    // Ignore capture-write failures during shutdown.
  }
  process.exit(1);
}
