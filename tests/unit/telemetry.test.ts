import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createTelemetry,
  instrumentHttpRequest,
  normalizedHttpRoute,
  safeRequestId,
} from '../../shared/telemetry.mjs';

function memoryLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      error: (line: string) => lines.push(line),
      log: (line: string) => lines.push(line),
      warn: (line: string) => lines.push(line),
    },
  };
}

describe('structured telemetry', () => {
  it('redacts credentials and personally identifying account fields', () => {
    const output = memoryLogger();
    const telemetry = createTelemetry({ service: 'test-service', logger: output.logger });

    telemetry.error('auth.failure', {
      authorization: 'Bearer secret-token',
      email: 'rider@example.com',
      nested: { password: 'correct-horse-battery-staple' },
      reason: 'invalid credentials',
    });

    const record = JSON.parse(output.lines[0]);
    expect(record).toMatchObject({
      level: 'error',
      service: 'test-service',
      event: 'auth.failure',
      authorization: '[redacted]',
      email: '[redacted]',
      nested: { password: '[redacted]' },
      reason: 'invalid credentials',
    });
    expect(output.lines[0]).not.toContain('secret-token');
    expect(output.lines[0]).not.toContain('rider@example.com');
  });

  it('exports bounded counters, gauges, and duration summaries', () => {
    const output = memoryLogger();
    const telemetry = createTelemetry({ service: 'test-service', logger: output.logger });
    telemetry.increment('tracklab_test_requests_total', { outcome: 'ok' });
    telemetry.increment('tracklab_test_requests_total', { outcome: 'ok' }, 2);
    telemetry.setGauge('tracklab_test_clients', 4);
    telemetry.observe('tracklab_test_duration_ms', 10, { operation: 'read' });
    telemetry.observe('tracklab_test_duration_ms', 20, { operation: 'read' });

    const metrics = telemetry.prometheus();
    expect(metrics).toContain('tracklab_test_requests_total{outcome="ok"} 3');
    expect(metrics).toContain('tracklab_test_clients 4');
    expect(metrics).toContain('tracklab_test_duration_ms_count{operation="read"} 2');
    expect(metrics).toContain('tracklab_test_duration_ms_sum{operation="read"} 30');
    expect(metrics).toContain('tracklab_test_duration_ms_max{operation="read"} 20');
  });

  it('normalizes routes without retaining query values or asset names', () => {
    expect(normalizedHttpRoute('/api/ghosts?trackId=private-track')).toBe('/api/ghosts');
    expect(normalizedHttpRoute('/assets/index-private-hash.js')).toBe('/static');
    expect(normalizedHttpRoute('/api/races/123')).toBe('/api/races/:number');
  });

  it('accepts safe upstream request IDs and rejects unsafe values', () => {
    expect(safeRequestId('request-1234')).toBe('request-1234');
    expect(safeRequestId('bad value with spaces')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('instruments an HTTP lifecycle with a response request ID', () => {
    const output = memoryLogger();
    const telemetry = createTelemetry({ service: 'test-service', logger: output.logger });
    const request = {
      headers: { 'x-request-id': 'upstream-request-1' },
      method: 'GET',
      url: '/api/health?secret=value',
    } as never;
    const response = Object.assign(new EventEmitter(), {
      headers: new Map<string, string>(),
      statusCode: 200,
      writableFinished: true,
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
    }) as never;

    const requestId = instrumentHttpRequest(request, response, telemetry, { service: 'test' });
    (response as unknown as EventEmitter).emit('finish');

    expect(requestId).toBe('upstream-request-1');
    expect((response as unknown as { headers: Map<string, string> }).headers.get('X-Request-Id')).toBe('upstream-request-1');
    expect(telemetry.prometheus()).toContain('tracklab_http_requests_total{method="GET",route="/api/health",status_class="2xx"} 1');
  });
});
