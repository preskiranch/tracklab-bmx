import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createSimulatorSource } from './simulator-source.mjs';
import { createAntSource } from './ant-source.mjs';
import { createWattbikeControl } from './wattbike-control.mjs';

const port = Number(process.env.WATTBIKE_BRIDGE_PORT ?? 8787);
const inputMode = process.env.WATTBIKE_INPUT === 'sim' ? 'sim' : 'ant';
const autoStart = process.env.WATTBIKE_BRIDGE_AUTOSTART === '1';
const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
const clients = new Set();

const wattbikeControl = createWattbikeControl();
let source = null;
let sourceState = 'idle';
let sourceError = null;
let controlStatusMessage = null;

function createSource() {
  return inputMode === 'ant' ? createAntSource() : createSimulatorSource();
}

function bridgeMessage() {
  if (sourceState === 'running') {
    return inputMode === 'ant'
      ? 'ANT bridge scanning. Put each Wattbike in Just Ride and pedal for a few seconds.'
      : 'Simulator bridge running.';
  }

  if (sourceState === 'starting') {
    return inputMode === 'ant' ? 'Starting ANT bridge.' : 'Starting simulator bridge.';
  }

  if (sourceState === 'error') {
    return sourceError ?? 'Bridge failed to start.';
  }

  return inputMode === 'ant'
    ? 'Local helper online. Press Start Local Bridge, then put each Wattbike in Just Ride.'
    : 'Local helper online. Press Start Local Bridge to run the simulator.';
}

function statusPayload(extra = {}) {
  return {
    type: 'bridge-status',
    mode: inputMode,
    at: Date.now(),
    sourceState,
    message: bridgeMessage(),
    ...extra,
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(payload));
}

async function startSource() {
  if (sourceState === 'running' || sourceState === 'starting') {
    return statusPayload();
  }

  sourceState = 'starting';
  sourceError = null;
  broadcast(statusPayload());

  const nextSource = createSource();
  nextSource.on('status', (status) => broadcast(statusPayload(status)));
  nextSource.on('bike', (bike) => broadcast({ type: 'bike-sample', ...bike }));
  nextSource.on('error', (error) => {
    sourceState = 'error';
    sourceError = error instanceof Error ? error.message : String(error);
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
    broadcast(statusPayload());
    return statusPayload();
  } catch (error) {
    sourceState = 'error';
    sourceError = error instanceof Error ? error.message : String(error);
    await nextSource.stop?.().catch(() => undefined);
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

  writeJson(response, 404, {
    type: 'not-found',
    message: 'Unknown TrackLab local bridge endpoint.',
  });
}

wss.on('connection', (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(statusPayload({ connectedAt: Date.now() })));

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
  console.log(`[bridge] TrackLab local helper listening on http://127.0.0.1:${port} (${inputMode})`);
  console.log(`[bridge] ${controlStatus.message}`);
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
