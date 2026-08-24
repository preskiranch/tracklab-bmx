import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  demoHeartRateBpm,
  demoHeartRateEffort,
  demoHeartRateReading,
  demoHeartRateReadingForBikeSample,
  maximumDemoHeartRateBpm,
  minimumDemoHeartRateBpm,
  type DemoHeartRateInput,
} from '../../src/lib/demoHeartRate';

const baseInput: DemoHeartRateInput = {
  deviceId: 91001,
  phase: 'active',
  elapsedMs: 10_000,
  effort: 0.7,
  recordedAt: 1_000_000,
};

describe('demo heart-rate physiology', () => {
  it('keeps every phase and input inside a believable demo-only range', () => {
    for (const deviceId of [91001, 91002, 91003, 91004]) {
      for (const effort of [-10, 0, 0.3, 0.7, 1, 10, Number.NaN]) {
        for (const elapsedMs of [-1, 0, 100, 1_000, 10_000, 60_000, 600_000]) {
          for (const phase of ['rest', 'active', 'recovery'] as const) {
            const bpm = demoHeartRateBpm({
              deviceId,
              phase,
              elapsedMs,
              effort,
              recordedAt: 1_000_000,
              activeDurationMs: 45_000,
            });
            expect(bpm).toBeGreaterThanOrEqual(minimumDemoHeartRateBpm);
            expect(bpm).toBeLessThanOrEqual(maximumDemoHeartRateBpm);
          }
        }
      }
    }
    const invalidReading = demoHeartRateReading({
      ...baseInput,
      deviceId: Number.NaN,
      elapsedMs: Number.NaN,
      effort: Number.NaN,
      recordedAt: Number.NaN,
      activeDurationMs: Number.NaN,
    });
    expect(Number.isFinite(invalidReading.bpm)).toBe(true);
    expect(invalidReading.recordedAt).toBe(0);
  });

  it('rises with elapsed work and effort, then recovers smoothly', () => {
    const early = demoHeartRateBpm({ ...baseInput, elapsedMs: 2_000, effort: 0.85 });
    const late = demoHeartRateBpm({ ...baseInput, elapsedMs: 30_000, effort: 0.85 });
    const easy = demoHeartRateBpm({ ...baseInput, elapsedMs: 30_000, effort: 0.2 });
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(easy + 35);

    const recoveryStart = demoHeartRateBpm({
      ...baseInput,
      phase: 'recovery',
      elapsedMs: 0,
      activeDurationMs: 30_000,
      effort: 0.85,
    });
    const recoveryAfter20Seconds = demoHeartRateBpm({
      ...baseInput,
      phase: 'recovery',
      elapsedMs: 20_000,
      activeDurationMs: 30_000,
      effort: 0.85,
    });
    const recoveryAfter60Seconds = demoHeartRateBpm({
      ...baseInput,
      phase: 'recovery',
      elapsedMs: 60_000,
      activeDurationMs: 30_000,
      effort: 0.85,
    });
    expect(recoveryStart).toBe(late);
    expect(recoveryAfter20Seconds).toBeLessThan(recoveryStart);
    expect(recoveryAfter60Seconds).toBeLessThan(recoveryAfter20Seconds);

    const activeSeries = Array.from({ length: 301 }, (_, index) => demoHeartRateBpm({
      ...baseInput,
      elapsedMs: index * 100,
      effort: Math.min(0.85, index / 300),
    }));
    const recoverySeries = Array.from({ length: 301 }, (_, index) => demoHeartRateBpm({
      ...baseInput,
      phase: 'recovery',
      elapsedMs: index * 100,
      activeDurationMs: 30_000,
      effort: 0.85,
    }));
    const largestStep = Math.max(...[activeSeries, recoverySeries].flatMap((series) => (
      series.slice(1).map((bpm, index) => Math.abs(bpm - series[index]))
    )));
    expect(largestStep).toBeLessThanOrEqual(2);
  });

  it('is deterministic while varying rider physiology', () => {
    expect(demoHeartRateReading(baseInput)).toEqual(demoHeartRateReading(baseInput));
    const riderBpms = [91001, 91002, 91003, 91004].map((deviceId) => (
      demoHeartRateBpm({ ...baseInput, deviceId, elapsedMs: 18_000 })
    ));
    expect(new Set(riderBpms).size).toBeGreaterThan(1);
    expect(demoHeartRateEffort(900, 145)).toBeGreaterThan(demoHeartRateEffort(250, 55));
  });

  it('adapts only demo bike samples into a display-only reading', () => {
    const reading = demoHeartRateReadingForBikeSample({
      at: 50_000,
      source: 'demo',
      deviceId: 91003,
      label: 'Demo Bike C',
      watts: 700,
      cadence: 130,
      speedKph: 45,
      demoActiveMs: 12_000,
      signal: 0.95,
    });
    expect(reading).toEqual({
      source: 'demo-simulated',
      bpm: expect.any(Number),
      recordedAt: 50_000,
    });
    expect(Object.keys(reading ?? {}).sort()).toEqual(['bpm', 'recordedAt', 'source']);
    expect(demoHeartRateReadingForBikeSample({
      at: 50_000,
      source: 'bluetooth',
      deviceId: 42,
      label: 'Real Wattbike',
      watts: 700,
      cadence: 130,
      speedKph: 45,
      signal: 0.95,
    })).toBeNull();
  });
});

describe('demo heart-rate privacy boundary', () => {
  it('does not give simulated readings a Watch stream identity or persistence path', () => {
    const demoSource = readFileSync(new URL('../../src/lib/demoHeartRate.ts', import.meta.url), 'utf8');
    expect(demoSource).not.toMatch(/HeartRateMeasurement|PrivateHeartRate|streamId|sessionId|riderId|fetch\(|\/api\//);

    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const displayProjection = appSource.slice(
      appSource.indexOf('const heartRateByPlayer = useMemo'),
      appSource.indexOf('const cloudProfileKey', appSource.indexOf('const heartRateByPlayer = useMemo')),
    );
    expect(displayProjection).toContain('if (demoMode) return next');
    expect(appSource).toContain(
      "if (demoMode || raceState !== 'finished' || !raceCapture || raceCapture.status !== 'finished') return",
    );

    const getPulledSource = readFileSync(new URL('../../src/components/GetPulledView.tsx', import.meta.url), 'utf8');
    expect(getPulledSource).toContain('if (sessionDemoMode || startedAt == null) return null');
    expect(getPulledSource).toContain("source === 'demo-simulated'");
  });

  it('keeps an explicit simulated label in every supported demo heart-rate HUD', () => {
    for (const relativePath of [
      '../../src/components/RaceRiderOverlay.tsx',
      '../../src/components/ExploreView.tsx',
      '../../src/components/MonitorView.tsx',
      '../../src/components/HeartRateMetric.tsx',
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source).toContain('Simulated');
    }
  });
});
