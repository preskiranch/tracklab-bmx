import { WebSocketServer } from 'ws';
import { createSimulatorSource } from './simulator-source.mjs';
import { createAntSource } from './ant-source.mjs';
import { createWattbikeControl } from './wattbike-control.mjs';

const port = Number(process.env.WATTBIKE_BRIDGE_PORT ?? 8787);
const inputMode = process.env.WATTBIKE_INPUT === 'ant' ? 'ant' : 'sim';
const wss = new WebSocketServer({ port });
const clients = new Set();

const source = inputMode === 'ant' ? createAntSource() : createSimulatorSource();
const wattbikeControl = createWattbikeControl();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({
    type: 'bridge-status',
    mode: inputMode,
    connectedAt: Date.now(),
    message: inputMode === 'ant'
      ? 'ANT bridge starting. Waiting for bike power sensors.'
      : 'Simulator bridge running. Use this until the ANT dongle arrives.',
  }));

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
      socket.send(JSON.stringify(payload));
      broadcast({
        type: 'bridge-status',
        mode: inputMode,
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

source.on('status', (status) => broadcast({ type: 'bridge-status', mode: inputMode, ...status }));
source.on('bike', (bike) => broadcast({ type: 'bike-sample', ...bike }));
source.on('error', (error) => {
  broadcast({
    type: 'bridge-error',
    message: error instanceof Error ? error.message : String(error),
    at: Date.now(),
  });
});

try {
  await source.start();
  const controlStatus = await wattbikeControl.status();
  console.log(`[bridge] Wattbike bridge listening on ws://127.0.0.1:${port} (${inputMode})`);
  console.log(`[bridge] ${controlStatus.message}`);
} catch (error) {
  console.error('[bridge] Failed to start source:', error);
  broadcast({
    type: 'bridge-error',
    message: error instanceof Error ? error.message : String(error),
    at: Date.now(),
  });
}

process.on('SIGINT', async () => {
  await source.stop?.();
  wss.close();
  process.exit(0);
});
