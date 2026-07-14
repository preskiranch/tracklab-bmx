import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const sensitiveFieldPattern = /(?:authorization|cookie|email|guest.?key|password|profile.?key|secret|session|token|api.?key)/i;
const metricNamePattern = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const maxLogDepth = 5;
const maxLogStringLength = 2_048;

function sanitizeString(value) {
  const stringValue = String(value);
  return stringValue.length > maxLogStringLength
    ? `${stringValue.slice(0, maxLogStringLength)}...[truncated]`
    : stringValue;
}

function sanitizedLogValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (sensitiveFieldPattern.test(key)) {
    return '[redacted]';
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'bigint') {
    return sanitizeString(value);
  }
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name || 'Error'),
      message: sanitizeString(value.message || 'Unknown error'),
      ...(process.env.NODE_ENV !== 'production' && value.stack
        ? { stack: sanitizeString(value.stack) }
        : {}),
    };
  }
  if (typeof value !== 'object') {
    return sanitizeString(value);
  }
  if (depth >= maxLogDepth || seen.has(value)) {
    return '[omitted]';
  }

  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizedLogValue(item, '', depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizedLogValue(entryValue, entryKey, depth + 1, seen),
      ]),
  );
}

function canonicalLabels(labels = {}) {
  return Object.entries(labels)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => [String(key), String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function metricKey(name, labels) {
  return JSON.stringify([name, canonicalLabels(labels)]);
}

function parsedMetricKey(key) {
  const [name, labels] = JSON.parse(key);
  return { name, labels: Object.fromEntries(labels) };
}

function assertMetricName(name) {
  if (!metricNamePattern.test(name)) {
    throw new TypeError(`Invalid metric name: ${name}`);
  }
}

function escapePrometheusValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function prometheusLabels(labels) {
  const entries = canonicalLabels(labels);
  return entries.length === 0
    ? ''
    : `{${entries.map(([key, value]) => `${key}="${escapePrometheusValue(value)}"`).join(',')}}`;
}

function metricStatusClass(statusCode) {
  const status = Number(statusCode) || 0;
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : 'unknown';
}

export function safeRequestId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  return /^[a-zA-Z0-9._:-]{8,96}$/.test(normalized) ? normalized : randomUUID();
}

export function normalizedHttpRoute(rawUrl) {
  let pathname = '/';
  try {
    pathname = new URL(rawUrl || '/', 'http://tracklab.local').pathname;
  } catch {
    return '/invalid';
  }

  if (!pathname.startsWith('/api/') && pathname !== '/api') {
    if (pathname === '/multiplayer') {
      return '/multiplayer';
    }
    if (pathname === '/manifest.webmanifest') {
      return pathname;
    }
    return '/static';
  }

  return pathname
    .split('/')
    .map((segment) => {
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) {
        return ':id';
      }
      if (/^\d+$/.test(segment)) {
        return ':number';
      }
      return segment.slice(0, 80);
    })
    .join('/');
}

export function createTelemetry({ service, logger = console } = {}) {
  const serviceName = String(service || 'tracklab');
  const counters = new Map();
  const gauges = new Map();
  const summaries = new Map();
  const startedAt = Date.now();

  function emit(level, event, fields = {}) {
    const record = sanitizedLogValue({
      timestamp: new Date().toISOString(),
      level,
      service: serviceName,
      event,
      ...fields,
    });
    const line = JSON.stringify(record);
    const output = level === 'error'
      ? logger.error
      : level === 'warn'
        ? logger.warn
        : logger.log;
    output.call(logger, line);
    return record;
  }

  function increment(name, labels = {}, amount = 1) {
    assertMetricName(name);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      return;
    }
    const key = metricKey(name, labels);
    counters.set(key, (counters.get(key) ?? 0) + numericAmount);
  }

  function setGauge(name, value, labels = {}) {
    assertMetricName(name);
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    gauges.set(metricKey(name, labels), numericValue);
  }

  function addGauge(name, amount, labels = {}) {
    assertMetricName(name);
    const key = metricKey(name, labels);
    const next = Math.max(0, (gauges.get(key) ?? 0) + Number(amount || 0));
    gauges.set(key, next);
  }

  function observe(name, value, labels = {}) {
    assertMetricName(name);
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    const key = metricKey(name, labels);
    const previous = summaries.get(key) ?? { count: 0, sum: 0, max: Number.NEGATIVE_INFINITY };
    summaries.set(key, {
      count: previous.count + 1,
      sum: previous.sum + numericValue,
      max: Math.max(previous.max, numericValue),
    });
  }

  function snapshot() {
    return {
      service: serviceName,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      counters: [...counters.entries()].map(([key, value]) => ({ ...parsedMetricKey(key), value })),
      gauges: [...gauges.entries()].map(([key, value]) => ({ ...parsedMetricKey(key), value })),
      summaries: [...summaries.entries()].map(([key, value]) => ({ ...parsedMetricKey(key), ...value })),
    };
  }

  function prometheus() {
    const lines = [
      '# HELP tracklab_process_uptime_seconds Time since this TrackLab service started.',
      '# TYPE tracklab_process_uptime_seconds gauge',
      `tracklab_process_uptime_seconds{service="${escapePrometheusValue(serviceName)}"} ${Math.floor((Date.now() - startedAt) / 1_000)}`,
    ];

    const emittedTypes = new Set();
    for (const [key, value] of counters.entries()) {
      const { name, labels } = parsedMetricKey(key);
      if (!emittedTypes.has(name)) {
        lines.push(`# TYPE ${name} counter`);
        emittedTypes.add(name);
      }
      lines.push(`${name}${prometheusLabels(labels)} ${value}`);
    }
    for (const [key, value] of gauges.entries()) {
      const { name, labels } = parsedMetricKey(key);
      if (!emittedTypes.has(name)) {
        lines.push(`# TYPE ${name} gauge`);
        emittedTypes.add(name);
      }
      lines.push(`${name}${prometheusLabels(labels)} ${value}`);
    }
    for (const [key, value] of summaries.entries()) {
      const { name, labels } = parsedMetricKey(key);
      if (!emittedTypes.has(name)) {
        lines.push(`# TYPE ${name} summary`);
        emittedTypes.add(name);
      }
      lines.push(`${name}_count${prometheusLabels(labels)} ${value.count}`);
      lines.push(`${name}_sum${prometheusLabels(labels)} ${value.sum}`);
      lines.push(`${name}_max${prometheusLabels(labels)} ${value.max}`);
    }
    return `${lines.join('\n')}\n`;
  }

  return {
    debug: (event, fields) => {
      if (process.env.TRACKLAB_LOG_LEVEL === 'debug') {
        return emit('debug', event, fields);
      }
      return null;
    },
    error: (event, fields) => emit('error', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    increment,
    setGauge,
    addGauge,
    observe,
    snapshot,
    prometheus,
  };
}

export function instrumentHttpRequest(request, response, telemetry, options = {}) {
  const startedAt = performance.now();
  const requestId = safeRequestId(request.headers?.['x-request-id']);
  const method = String(request.method || 'GET').toUpperCase();
  const route = normalizedHttpRoute(request.url);
  request.tracklabRequestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  telemetry.addGauge('tracklab_http_active_requests', 1, { service: options.service });

  let finalized = false;
  const finalize = (aborted = false) => {
    if (finalized) {
      return;
    }
    finalized = true;
    const durationMs = Math.max(0, performance.now() - startedAt);
    const statusCode = Number(response.statusCode) || (aborted ? 499 : 0);
    const labels = {
      method,
      route,
      status_class: metricStatusClass(statusCode),
    };
    telemetry.addGauge('tracklab_http_active_requests', -1, { service: options.service });
    telemetry.increment('tracklab_http_requests_total', labels);
    telemetry.observe('tracklab_http_request_duration_ms', durationMs, { method, route });
    if (aborted) {
      telemetry.increment('tracklab_http_aborted_requests_total', { method, route });
    }

    const logEveryRequest = process.env.TRACKLAB_LOG_HTTP === '1';
    const slowRequestMs = Number(process.env.TRACKLAB_SLOW_REQUEST_MS ?? 1_000);
    const logFields = {
      requestId,
      method,
      route,
      statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      aborted,
    };
    if (statusCode >= 500 || aborted) {
      telemetry.error('http.request', logFields);
    } else if (statusCode === 429 || durationMs >= slowRequestMs) {
      telemetry.warn('http.request', logFields);
    } else if (logEveryRequest) {
      telemetry.info('http.request', logFields);
    }
  };

  response.once('finish', () => finalize(false));
  response.once('close', () => {
    if (!response.writableFinished) {
      finalize(true);
    }
  });
  return requestId;
}

export const prometheusContentType = 'text/plain; version=0.0.4; charset=utf-8';
