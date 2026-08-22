import { describe, expect, it } from 'vitest';
import {
  heartRateLiveMaximumFutureSkewMs,
  mergeLiveHeartRateEvent,
  type HeartRateLiveEvent,
} from '../../src/lib/heartRateCloud';

function reading(overrides: Partial<HeartRateLiveEvent> = {}): HeartRateLiveEvent {
  return {
    streamId: 'stream-one',
    sessionId: 'watch-connect:one',
    relayScope: 'account-block',
    riderId: 'account:one',
    playerId: null,
    bpm: 150,
    recordedAt: 10_000,
    receivedAt: 10_000,
    freshUntil: 25_000,
    activeElapsedMs: 1_000,
    ...overrides,
  };
}

describe('live heart-rate reader boundaries', () => {
  it('accepts only the exact personal account and never moves backward', () => {
    const first = mergeLiveHeartRateEvent({}, reading(), {
      expectedRiderId: 'account:one',
      now: 10_000,
    });
    expect(first['account:one']?.bpm).toBe(150);
    expect(mergeLiveHeartRateEvent(first, reading({
      riderId: 'account:two',
      bpm: 190,
      receivedAt: 11_000,
    }), {
      expectedRiderId: 'account:one',
      now: 11_000,
    })).toBe(first);
    expect(mergeLiveHeartRateEvent(first, reading({
      bpm: 140,
      recordedAt: 9_000,
      receivedAt: 9_000,
    }), { now: 11_000 })).toBe(first);
  });

  it('rejects an old sensor sample even when it was received now', () => {
    const now = 30_001;
    expect(mergeLiveHeartRateEvent({}, reading({
      recordedAt: 20_000,
      receivedAt: now,
      freshUntil: now + 15_000,
    }), { now })).toEqual({});
  });

  it('allows exactly two seconds of future skew and rejects anything beyond it', () => {
    const now = 50_000;
    expect(mergeLiveHeartRateEvent({}, reading({
      recordedAt: now + heartRateLiveMaximumFutureSkewMs,
      receivedAt: now,
      freshUntil: now + 15_000,
    }), { now })['account:one']).toBeDefined();
    expect(mergeLiveHeartRateEvent({}, reading({
      recordedAt: now + heartRateLiveMaximumFutureSkewMs + 1,
      receivedAt: now,
      freshUntil: now + 15_000,
    }), { now })).toEqual({});
  });
});
