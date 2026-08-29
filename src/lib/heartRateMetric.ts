export type HeartRateResultsMetricState = 'checking' | 'connected' | 'unavailable';

type HeartRateResultsMetricInput = Readonly<{
  enabled: boolean;
  availabilityResolved: boolean;
  watchReady: boolean;
  hasLiveReading: boolean;
  watchConnectState?: string | null;
  workoutState?: string | null;
  readingState?: string | null;
}>;

const connectedWatchStates = new Set(['connected', 'syncing', 'reconnect']);
const connectedWorkoutStates = new Set(['active', 'paused']);
const connectedReadingStates = new Set(['live', 'stale', 'paused']);
const checkingWatchStates = new Set(['connecting', 'disconnecting']);
const checkingWorkoutStates = new Set(['launching', 'connecting', 'ending']);
const checkingReadingStates = new Set(['checking', 'connecting']);

/**
 * Heart rate is automatic and private. This state only controls whether the
 * read-only results metric appears checked; it never adds heart rate to the
 * public race-metric or export selections.
 */
export function resolveHeartRateResultsMetricState({
  enabled,
  availabilityResolved,
  watchReady,
  hasLiveReading,
  watchConnectState,
  workoutState,
  readingState,
}: HeartRateResultsMetricInput): HeartRateResultsMetricState {
  if (!enabled) return 'unavailable';

  if (
    watchReady
    || hasLiveReading
    || connectedWatchStates.has(watchConnectState ?? '')
    || connectedWorkoutStates.has(workoutState ?? '')
    || connectedReadingStates.has(readingState ?? '')
  ) {
    return 'connected';
  }

  if (
    !availabilityResolved
    || checkingWatchStates.has(watchConnectState ?? '')
    || checkingWorkoutStates.has(workoutState ?? '')
    || checkingReadingStates.has(readingState ?? '')
  ) {
    return 'checking';
  }

  return 'unavailable';
}
