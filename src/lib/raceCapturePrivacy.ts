import { raceCaptureStorageKey } from '../data';

type MutableRefLike<T> = { current: T };

type RaceCaptureRuntimeRefs<PlayerKey, TracePoint> = {
  capturedSampleKeysRef: MutableRefLike<Set<string>>;
  lastRaceDebugFrameAtRef: MutableRefLike<number>;
  activeRaceSessionIdRef: MutableRefLike<string | null>;
  ghostRaceStartedAtRef: MutableRefLike<number | null>;
  ghostTraceRef: MutableRefLike<Map<PlayerKey, TracePoint[]>>;
  ghostTraceLastSampleAtRef: MutableRefLike<Map<PlayerKey, number>>;
};

type RaceCaptureDebugTarget = {
  __tracklabLastRaceCapture?: unknown;
};

/**
 * Removes the downloadable local capture before a shared tablet changes
 * identity. This runs synchronously so the previous athlete cannot appear for
 * even one kiosk render while React state is catching up.
 */
export function clearStoredRaceCaptureAtIdentityBoundary(
  storage: Pick<Storage, 'removeItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
  debugTarget: RaceCaptureDebugTarget | null = typeof window === 'undefined'
    ? null
    : window as unknown as RaceCaptureDebugTarget,
) {
  try {
    storage?.removeItem(raceCaptureStorageKey);
  } catch {
    // A blocked storage backend must not prevent the in-memory privacy reset.
  }
  if (debugTarget) debugTarget.__tracklabLastRaceCapture = null;
}

/** Stops any active capture writers before clearing the visible capture. */
export function resetActiveRaceCaptureRefs<PlayerKey, TracePoint>(
  refs: RaceCaptureRuntimeRefs<PlayerKey, TracePoint>,
) {
  refs.capturedSampleKeysRef.current = new Set();
  refs.lastRaceDebugFrameAtRef.current = 0;
  refs.activeRaceSessionIdRef.current = null;
  refs.ghostRaceStartedAtRef.current = null;
  refs.ghostTraceRef.current = new Map();
  refs.ghostTraceLastSampleAtRef.current = new Map();
}

export function clearRaceCaptureAtIdentityBoundary<PlayerKey, TracePoint>(
  refs: RaceCaptureRuntimeRefs<PlayerKey, TracePoint>,
  onClearVisibleCapture: () => void,
  storage?: Pick<Storage, 'removeItem'> | null,
  debugTarget?: RaceCaptureDebugTarget | null,
) {
  resetActiveRaceCaptureRefs(refs);
  clearStoredRaceCaptureAtIdentityBoundary(storage, debugTarget);
  onClearVisibleCapture();
}
