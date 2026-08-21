import { describe, expect, it } from 'vitest';
import type { HeartRateMeasurement } from '../../src/types';
import type {
  NativeHeartRateAvailability,
  NativeHeartRateStatus,
} from '../../src/lib/nativeHeartRate';
import { deriveHeartRateReadingState } from '../../src/hooks/useHeartRate';

const available: NativeHeartRateAvailability = {
  version: 1,
  supported: true,
  platform: 'iphone',
  paired: true,
  watchAppInstalled: true,
  healthDataAvailable: true,
  minimumIOS: '17.0',
  minimumWatchOS: '10.0',
};

function status(state: NativeHeartRateStatus['state']): NativeHeartRateStatus {
  return { version: 1, state, sessionId: 'session-1', at: 10_000 };
}

function sample(recordedAt: number): HeartRateMeasurement {
  return {
    source: 'apple-watch',
    sessionId: 'session-1',
    sequence: 1,
    bpm: 150,
    recordedAt,
    receivedAt: recordedAt + 20,
  };
}

describe('useHeartRate live-state derivation', () => {
  it('distinguishes missing, live, and stale Apple Watch samples', () => {
    expect(deriveHeartRateReadingState({
      availability: available,
      status: status('active'),
      latest: null,
      now: 20_000,
    })).toBe('missing');
    expect(deriveHeartRateReadingState({
      availability: available,
      status: status('active'),
      latest: sample(15_000),
      now: 20_000,
      freshnessMs: 10_000,
    })).toBe('live');
    expect(deriveHeartRateReadingState({
      availability: available,
      status: status('active'),
      latest: sample(5_000),
      now: 20_000,
      freshnessMs: 10_000,
    })).toBe('stale');
  });

  it('keeps unsupported, paused, connecting, and error states explicit', () => {
    expect(deriveHeartRateReadingState({
      availability: null, status: status('error'), latest: null,
    })).toBe('error');
    expect(deriveHeartRateReadingState({
      availability: { ...available, supported: false }, status: null, latest: null,
    })).toBe('unavailable');
    expect(deriveHeartRateReadingState({
      availability: available, status: status('paused'), latest: sample(10_000),
    })).toBe('paused');
    expect(deriveHeartRateReadingState({
      availability: available, status: status('connecting'), latest: null,
    })).toBe('connecting');
    expect(deriveHeartRateReadingState({
      availability: available, status: status('error'), latest: null,
    })).toBe('error');
  });
});
