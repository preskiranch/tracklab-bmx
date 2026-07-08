import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createSimulatorSource } from './simulator-source.mjs';
import { createAntSource } from './ant-source.mjs';
import { createBleSource } from './ble-source.mjs';
import { createHybridSource } from './hybrid-source.mjs';
import { createWattbikeControl } from './wattbike-control.mjs';

const port = Number(process.env.WATTBIKE_BRIDGE_PORT ?? 8787);
const inputMode = normalizeInputMode(process.env.WATTBIKE_INPUT);
const autoStart = process.env.WATTBIKE_BRIDGE_AUTOSTART === '1';
const userDataDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'TrackLab BMX');
const userDataPath = path.join(userDataDirectory, 'user-data.json');
const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
const clients = new Set();

const wattbikeControl = createWattbikeControl();
let source = null;
let sourceState = 'idle';
let sourceError = null;
let controlStatusMessage = null;
const seenBikeDevices = new Set();
const latestBikeSamples = new Map();

function logBridge(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[bridge] ${message}${suffix}`);
}

function warnBridge(message, error = null) {
  const suffix = error ? ` ${error instanceof Error ? error.message : String(error)}` : '';
  console.warn(`[bridge] ${message}${suffix}`);
}

function normalizeInputMode(value) {
  const normalized = String(value ?? 'auto').trim().toLowerCase();
  if (normalized === 'sim') {
    return 'sim';
  }
  if (normalized === 'ble' || normalized === 'bluetooth') {
    return 'bluetooth';
  }
  if (normalized === 'ant') {
    return 'ant';
  }
  return 'auto';
}

function createSource() {
  if (inputMode === 'sim') {
    return createSimulatorSource();
  }
  if (inputMode === 'bluetooth') {
    return createBleSource();
  }
  if (inputMode === 'ant') {
    return createAntSource();
  }
  return createHybridSource();
}

function bridgeMessage() {
  if (sourceState === 'running') {
    if (inputMode === 'ant') {
      return 'ANT bridge scanning. Put each Wattbike in Just Ride and pedal for a few seconds.';
    }
    if (inputMode === 'bluetooth') {
      return 'Bluetooth bridge scanning. Turn Model B Remote Bluetooth On, enter Just Ride, then pedal.';
    }
    if (inputMode === 'auto') {
      return 'Auto connector scanning with Bluetooth and ANT+. Put each Wattbike in Just Ride and pedal.';
    }
    return 'Simulator bridge running.';
  }

  if (sourceState === 'starting') {
    if (inputMode === 'ant') {
      return 'Starting ANT bridge.';
    }
    if (inputMode === 'bluetooth') {
      return 'Starting Bluetooth bridge.';
    }
    if (inputMode === 'auto') {
      return 'Starting auto connector.';
    }
    return 'Starting simulator bridge.';
  }

  if (sourceState === 'error') {
    return sourceError ?? 'Bridge failed to start.';
  }

  if (inputMode === 'sim') {
    return 'Local helper online. Press Start Local Bridge to run the simulator.';
  }

  return 'Local helper online. Press Start Connector, then put each Wattbike in Just Ride.';
}

function statusPayload(extra = {}) {
  const sampledConnectedDevices = [...latestBikeSamples.values()].map((bike) => ({
    at: bike.at,
    connected: sourceState === 'running',
    deviceId: bike.deviceId,
    label: bike.label,
    signal: bike.signal,
    source: bike.source,
  }));
  const extraConnectedDevices = Array.isArray(extra.connectedDevices)
    ? extra.connectedDevices
    : Array.isArray(extra.devices)
      ? extra.devices
      : [];
  const connectedDevices = sampledConnectedDevices.length > 0 ? sampledConnectedDevices : extraConnectedDevices;

  return {
    type: 'bridge-status',
    mode: inputMode,
    at: Date.now(),
    sourceState,
    message: bridgeMessage(),
    ...extra,
    connectedDevices,
    devices: connectedDevices,
  };
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(payload));
}

function defaultUserData() {
  return {
    version: 1,
    updatedAt: Date.now(),
    trackMappings: {},
    customRoutes: [],
    bikeProfiles: [],
  };
}

function normalizeUserData(value) {
  const fallback = defaultUserData();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  return {
    version: 1,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : fallback.updatedAt,
    trackMappings: value.trackMappings && typeof value.trackMappings === 'object' ? value.trackMappings : {},
    customRoutes: Array.isArray(value.customRoutes) ? value.customRoutes : [],
    bikeProfiles: Array.isArray(value.bikeProfiles) ? value.bikeProfiles : [],
  };
}

async function readUserData() {
  try {
    const contents = await readFile(userDataPath, 'utf8');
    return normalizeUserData(JSON.parse(contents));
  } catch {
    return defaultUserData();
  }
}

async function writeUserData(data) {
  const normalized = normalizeUserData({
    ...data,
    updatedAt: Date.now(),
  });
  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(userDataPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function startSource() {
  if (sourceState === 'running' || sourceState === 'starting') {
    return statusPayload();
  }

  sourceState = 'starting';
  sourceError = null;
  broadcast(statusPayload());

  const nextSource = createSource();
  nextSource.on('status', (status) => {
    const message = status?.message ? String(status.message) : 'Source status update.';
    logBridge(message);
    broadcast(statusPayload(status));
  });
  nextSource.on('bike', (bike) => {
    const deviceKey = `${bike.source ?? 'unknown'}:${bike.deviceId}`;
    latestBikeSamples.set(bike.deviceId, bike);
    if (!seenBikeDevices.has(deviceKey)) {
      seenBikeDevices.add(deviceKey);
      logBridge(`Detected ${bike.source ?? 'bike'} device ${bike.deviceId}.`, {
        label: bike.label,
        watts: bike.watts,
        cadence: bike.cadence,
        speedKph: bike.speedKph,
        antProfile: bike.antProfile,
      });
    }
    broadcast({ type: 'bike-sample', ...bike });
  });
  nextSource.on('error', (error) => {
    sourceState = 'error';
    sourceError = error instanceof Error ? error.message : String(error);
    warnBridge('Source error:', error);
    broadcast({
      type: 'bridge-error',
      mode: inputMode,
      sourceState,
      message: sourceError,
      at: Date.now(),
    });
  });

  try {
    await nextSource.start();
    source = nextSource;
    sourceState = 'running';
    logBridge(`${inputMode.toString().toUpperCase()} source is running.`);
    broadcast(statusPayload());
    return statusPayload();
  } catch (error) {
    sourceState = 'error';
    sourceError = error instanceof Error ? error.message : String(error);
    await nextSource.stop?.().catch(() => undefined);
    warnBridge('Source failed to start:', error);
    broadcast({
      type: 'bridge-error',
      mode: inputMode,
      sourceState,
      message: sourceError,
      at: Date.now(),
    });
    return statusPayload();
  }
}

async function stopSource() {
  if (!source || sourceState === 'idle') {
    sourceState = 'idle';
    return statusPayload();
  }

  sourceState = 'stopping';
  broadcast(statusPayload());

  try {
    await source.stop?.();
  } finally {
    source = null;
    sourceState = 'idle';
    seenBikeDevices.clear();
    latestBikeSamples.clear();
    logBridge('Source stopped.');
    broadcast(statusPayload());
  }

  return statusPayload();
}

async function handleHttpRequest(request, response) {
  if (request.method === 'OPTIONS') {
    writeJson(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

  if (request.method === 'GET' && url.pathname === '/api/bridge/status') {
    writeJson(response, 200, {
      ...statusPayload(),
      controlStatus: controlStatusMessage,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/bridge/start') {
    const payload = await startSource();
    writeJson(response, sourceState === 'error' ? 500 : 200, payload);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/bridge/stop') {
    const payload = await stopSource();
    writeJson(response, 200, payload);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/user-data') {
    writeJson(response, 200, await readUserData());
    return;
  }

  if (request.method === 'PATCH' && url.pathname === '/api/user-data') {
    try {
      const patch = await readRequestJson(request);
      const current = await readUserData();
      const next = await writeUserData({
        ...current,
        trackMappings: patch.trackMappings && typeof patch.trackMappings === 'object'
          ? patch.trackMappings
          : current.trackMappings,
        customRoutes: Array.isArray(patch.customRoutes)
          ? patch.customRoutes
          : current.customRoutes,
        bikeProfiles: Array.isArray(patch.bikeProfiles)
          ? patch.bikeProfiles
          : current.bikeProfiles,
      });
      writeJson(response, 200, next);
    } catch (error) {
      writeJson(response, 400, {
        type: 'user-data-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  writeJson(response, 404, {
    type: 'not-found',
    message: 'Unknown TrackLab local bridge endpoint.',
  });
}

wss.on('connection', (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(statusPayload({ connectedAt: Date.now() })));
  for (const bike of latestBikeSamples.values()) {
    socket.send(JSON.stringify({ type: 'bike-sample', ...bike }));
  }

  socket.on('message', async (data) => {
    let parsed = null;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      socket.send(JSON.stringify({
        type: 'bike-control-result',
        action: 'unknown',
        ok: false,
        at: Date.now(),
        message: 'Bridge received invalid JSON command.',
      }));
      return;
    }

    if (parsed.type !== 'bike-control') {
      return;
    }

    try {
      const result = await wattbikeControl.send(parsed);
      const payload = {
        type: 'bike-control-result',
        at: Date.now(),
        ...result,
      };
      controlStatusMessage = payload.message;
      socket.send(JSON.stringify(payload));
      broadcast({
        type: 'bridge-status',
        mode: inputMode,
        sourceState,
        at: Date.now(),
        message: payload.message,
      });
    } catch (controlError) {
      socket.send(JSON.stringify({
        type: 'bike-control-result',
        action: parsed.action,
        ok: false,
        at: Date.now(),
        message: controlError instanceof Error ? controlError.message : String(controlError),
      }));
    }
  });

  socket.on('close', () => clients.delete(socket));
});

try {
  const controlStatus = await wattbikeControl.status();
  controlStatusMessage = controlStatus.message;
  server.listen(port, '127.0.0.1');
  logBridge(`TrackLab local helper listening on http://127.0.0.1:${port} (${inputMode})`);
  logBridge(controlStatus.message);
  if (autoStart) {
    await startSource();
  }
} catch (error) {
  console.error('[bridge] Failed to start local helper:', error);
  broadcast({
    type: 'bridge-error',
    mode: inputMode,
    sourceState: 'error',
    message: error instanceof Error ? error.message : String(error),
    at: Date.now(),
  });
}

process.on('SIGINT', async () => {
  await stopSource();
  wss.close();
  server.close(() => process.exit(0));
});
