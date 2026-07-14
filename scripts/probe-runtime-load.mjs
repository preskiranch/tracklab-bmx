function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const target = argument('--url') || process.env.TRACKLAB_SMOKE_URL;
if (!target) {
  throw new Error('Set TRACKLAB_SMOKE_URL or pass --url https://your-tracklab-host.example.');
}

const baseUrl = new URL(target).toString().replace(/\/$/, '');
const requestCount = Math.max(1, Number(argument('--requests') || process.env.TRACKLAB_LOAD_REQUESTS) || 40);
const concurrency = Math.max(1, Math.min(20, Number(argument('--concurrency') || process.env.TRACKLAB_LOAD_CONCURRENCY) || 4));
const p95BudgetMs = Math.max(100, Number(process.env.TRACKLAB_LOAD_P95_MS) || 2_000);
const timeoutMs = Math.max(1_000, Number(process.env.TRACKLAB_SMOKE_TIMEOUT_MS) || 10_000);
const paths = ['/api/health', '/data/track-locator.json'];
const durations = [];
const failures = [];
let nextRequest = 0;

async function worker() {
  while (nextRequest < requestCount) {
    const requestIndex = nextRequest;
    nextRequest += 1;
    const pathname = paths[requestIndex % paths.length];
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        headers: {
          Accept: pathname.endsWith('.json') ? 'application/json' : '*/*',
          'Accept-Encoding': 'br, gzip',
          'User-Agent': 'TrackLab-ReadOnly-Load-Probe/1.0',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      const durationMs = performance.now() - startedAt;
      durations.push(durationMs);
      if (!response.ok) {
        failures.push(`${pathname} returned ${response.status}`);
      }
    } catch (error) {
      failures.push(`${pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const suiteStartedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const totalDurationMs = performance.now() - suiteStartedAt;
durations.sort((left, right) => left - right);

function percentile(percent) {
  if (durations.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const index = Math.min(durations.length - 1, Math.ceil((percent / 100) * durations.length) - 1);
  return durations[index];
}

const p50 = percentile(50);
const p95 = percentile(95);
const p99 = percentile(99);
const requestsPerSecond = durations.length / Math.max(totalDurationMs / 1_000, 0.001);

console.log(`Read-only load probe: ${durations.length}/${requestCount} responses, concurrency ${concurrency}`);
console.log(`Latency p50=${Math.round(p50)} ms p95=${Math.round(p95)} ms p99=${Math.round(p99)} ms`);
console.log(`Throughput ${requestsPerSecond.toFixed(1)} requests/second over ${Math.round(totalDurationMs)} ms`);

if (failures.length > 0) {
  throw new Error(`Load probe recorded ${failures.length} failures:\n- ${failures.slice(0, 10).join('\n- ')}`);
}
if (p95 > p95BudgetMs) {
  throw new Error(`Load probe p95 ${Math.round(p95)} ms exceeded the ${p95BudgetMs} ms budget.`);
}
