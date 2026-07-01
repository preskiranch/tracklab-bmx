import { appendFile, mkdir } from 'node:fs/promises';
import { createAntSource } from '../bridge/ant-source.mjs';

function argValue(name, fallback) {
  const equalsPrefix = `--${name}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) {
    return equalsArg.slice(equalsPrefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return fallback;
}

function timestampForFile() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}

function formatBike(sample) {
  const cadence = sample.cadence == null ? '--' : `${sample.cadence} rpm`;
  const speedSuffix = sample.speedSource === 'estimated' ? ' est' : '';
  const speed = sample.speedKph == null ? '--' : `${sample.speedKph.toFixed(1)} kph${speedSuffix}`;
  return `${sample.label} device ${sample.deviceId} | ${sample.watts} W | ${cadence} | ${speed}`;
}

const seconds = Math.max(5, Number(argValue('seconds', 120)));
const profile = argValue('profile', process.env.WATTBIKE_ANT_PROFILE ?? 'auto');
const dwellMs = Math.max(3000, Number(argValue('dwell-ms', process.env.WATTBIKE_ANT_PROFILE_DWELL_MS ?? 10000)));
const captureDir = new URL('../captures/', import.meta.url);
const capturePath = new URL(`wattbike-ant-${timestampForFile()}.jsonl`, captureDir);
const source = createAntSource({
  profile,
  profileDwellMs: dwellMs,
  lockOnSample: false,
});

let bikeSampleCount = 0;
let rawEventCount = 0;
const devices = new Map();

async function writeCapture(type, payload) {
  await appendFile(capturePath, `${JSON.stringify({
    type,
    capturedAt: new Date().toISOString(),
    ...payload,
  })}\n`);
}

await mkdir(captureDir, { recursive: true });
await writeCapture('capture-start', {
  seconds,
  profile,
  dwellMs,
  command: process.argv.join(' '),
});

source.on('status', (status) => {
  console.log(`[ant-capture] ${status.message}`);
  writeCapture('status', status).catch((error) => console.error('[ant-capture] Failed to write status:', error));
});

source.on('raw', (raw) => {
  rawEventCount += 1;
  if (raw.profile === 'raw' && raw.eventName === 'rawData') {
    const payload = raw.payload ?? {};
    const device = payload.deviceId == null ? 'unknown' : payload.deviceId;
    const type = payload.deviceType == null ? 'unknown' : payload.deviceType;
    const page = payload.dataPage == null ? 'unknown' : payload.dataPage;
    console.log(`[raw-ant] device ${device} type ${type} page ${page} payload ${payload.payloadHex ?? '--'}`);
  }
  writeCapture('raw', raw).catch((error) => console.error('[ant-capture] Failed to write raw event:', error));
});

source.on('bike', (sample) => {
  bikeSampleCount += 1;
  devices.set(sample.deviceId, sample);
  console.log(`[bike] ${formatBike(sample)}`);
  writeCapture('bike-sample', sample).catch((error) => console.error('[ant-capture] Failed to write sample:', error));
});

source.on('error', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ant-capture] ${message}`);
  writeCapture('error', { message }).catch((writeError) => console.error('[ant-capture] Failed to write error:', writeError));
});

console.log(`[ant-capture] Capturing ANT+ for ${seconds}s. Output: ${capturePath.pathname}`);
console.log('[ant-capture] Put the Wattbike monitor in Just Ride and pedal for 10-20 seconds.');
console.log(`[ant-capture] Profile mode: ${profile}. Use --profile power, fitness, speed-cadence, cadence, or speed to force one.`);

let started = false;

try {
  await source.start();
  started = true;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ant-capture] Failed to start ANT capture: ${message}`);
  await writeCapture('error', { message });
  process.exitCode = 1;
}

if (started) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await source.stop?.();
}

await writeCapture('capture-end', {
  bikeSampleCount,
  rawEventCount,
  devices: [...devices.values()],
});

console.log(`[ant-capture] Finished. ${bikeSampleCount} bike samples, ${rawEventCount} raw ANT events.`);
console.log(`[ant-capture] Capture file: ${capturePath.pathname}`);
