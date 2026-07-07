import { EventEmitter } from 'node:events';
import { createAntSource } from './ant-source.mjs';
import { createBleSource } from './ble-source.mjs';

export function createHybridSource(options = {}) {
  const emitter = new EventEmitter();
  const runningSources = [];
  const disabled = new Set(
    String(options.disabled ?? process.env.WATTBIKE_AUTO_DISABLE ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

  function emitStatus(message, extra = {}) {
    emitter.emit('status', {
      at: Date.now(),
      message,
      ...extra,
    });
  }

  async function startOne(label, factory) {
    if (disabled.has(label)) {
      emitStatus(`${label.toUpperCase()} source disabled by WATTBIKE_AUTO_DISABLE.`);
      return null;
    }

    const source = factory();
    source.on('bike', (bike) => emitter.emit('bike', bike));
    source.on('raw', (raw) => emitter.emit('raw', raw));
    source.on('status', (status) => {
      emitter.emit('status', {
        ...status,
        sourceLabel: label,
      });
    });
    source.on('error', (error) => {
      emitStatus(`${label.toUpperCase()} source warning: ${error instanceof Error ? error.message : String(error)}`);
    });

    try {
      await source.start();
      emitStatus(`${label.toUpperCase()} source running.`);
      return source;
    } catch (error) {
      await source.stop?.().catch(() => undefined);
      emitStatus(`${label.toUpperCase()} source unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  emitter.start = async () => {
    const sources = await Promise.all([
      startOne('bluetooth', () => createBleSource(options.bluetooth)),
      startOne('ant', () => createAntSource(options.ant)),
    ]);

    for (const source of sources) {
      if (source) {
        runningSources.push(source);
      }
    }

    if (runningSources.length === 0) {
      throw new Error('No Wattbike source could start. Check Bluetooth permission or plug in an ANT+ dongle.');
    }

    emitStatus('Auto connector running. It will use Bluetooth or ANT+ samples as bikes appear.', {
      activeSources: runningSources.length,
    });
  };

  emitter.stop = async () => {
    const sources = runningSources.splice(0);
    await Promise.allSettled(sources.map((source) => source.stop?.()));
    emitStatus('Auto connector stopped.');
  };

  return emitter;
}
