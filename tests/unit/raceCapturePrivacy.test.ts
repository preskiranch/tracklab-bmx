import { describe, expect, it, vi } from 'vitest';
import { raceCaptureStorageKey } from '../../src/data';
import {
  clearRaceCaptureAtIdentityBoundary,
  clearStoredRaceCaptureAtIdentityBoundary,
} from '../../src/lib/raceCapturePrivacy';

describe('Club Tablet race-capture privacy boundary', () => {
  it('purges a previous athlete capture and disables every active capture writer', () => {
    const storage = {
      removeItem: vi.fn(),
    };
    const debugTarget = {
      __tracklabLastRaceCapture: { riders: ['Previous Athlete'] },
    };
    const refs = {
      capturedSampleKeysRef: { current: new Set(['old-athlete:sample']) },
      lastRaceDebugFrameAtRef: { current: 1234 },
      activeRaceSessionIdRef: { current: 'previous-athlete-session' as string | null },
      ghostRaceStartedAtRef: { current: 5678 as number | null },
      ghostTraceRef: { current: new Map([[1, [{ elapsedMs: 100 }]]]) },
      ghostTraceLastSampleAtRef: { current: new Map([[1, 900]]) },
    };

    const clearVisibleCapture = vi.fn();
    clearRaceCaptureAtIdentityBoundary(refs, clearVisibleCapture, storage, debugTarget);

    expect(storage.removeItem).toHaveBeenCalledWith(raceCaptureStorageKey);
    expect(debugTarget.__tracklabLastRaceCapture).toBeNull();
    expect(clearVisibleCapture).toHaveBeenCalledOnce();
    expect(refs.capturedSampleKeysRef.current.size).toBe(0);
    expect(refs.lastRaceDebugFrameAtRef.current).toBe(0);
    expect(refs.activeRaceSessionIdRef.current).toBeNull();
    expect(refs.ghostRaceStartedAtRef.current).toBeNull();
    expect(refs.ghostTraceRef.current.size).toBe(0);
    expect(refs.ghostTraceLastSampleAtRef.current.size).toBe(0);
  });

  it('still clears in-memory debug data when local storage is blocked', () => {
    const debugTarget = {
      __tracklabLastRaceCapture: { riders: ['Previous Athlete'] } as unknown,
    };

    expect(() => clearStoredRaceCaptureAtIdentityBoundary({
      removeItem: () => {
        throw new Error('blocked');
      },
    }, debugTarget)).not.toThrow();
    expect(debugTarget.__tracklabLastRaceCapture).toBeNull();
  });
});
