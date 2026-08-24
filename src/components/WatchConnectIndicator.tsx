import { Watch } from 'lucide-react';
import type { WatchConnectIndicatorState } from '../lib/watchConnectIndicator';

export type WatchConnectIndicatorProps = Readonly<{
  state: WatchConnectIndicatorState;
  onOpenSettings?: () => void;
}>;

export function WatchConnectIndicator({ state, onOpenSettings }: WatchConnectIndicatorProps) {
  const accessibleLabel = `${state.label}${state.bpm == null
    ? ''
    : `, ${state.bpm} beats per minute`}. ${state.detail}${onOpenSettings
    ? ' Open Watch Connect settings.'
    : ''}`;
  const cue = state.phase === 'live' || state.phase === 'connected'
    ? '✓'
    : state.phase === 'disconnected'
      ? '×'
      : state.phase === 'syncing'
        ? '↻'
        : state.phase === 'checking'
          ? '?'
          : '…';
  const contents = <>
    <span className="watch-connect-indicator-icon" aria-hidden="true">
      <Watch size={17} strokeWidth={2.5} />
      {state.bpm != null && <b>{state.bpm}</b>}
    </span>
    <span className="watch-connect-indicator-label">
      <span>{state.label}</span>
      {state.bpm != null && <strong>{state.bpm} BPM</strong>}
    </span>
    <span className="watch-connect-indicator-cue" aria-hidden="true">{cue}</span>
  </>;
  return onOpenSettings ? (
    <button
      aria-atomic="true"
      aria-label={accessibleLabel}
      aria-live="polite"
      className={`watch-connect-indicator ${state.phase}`}
      data-watch-connect-status={state.phase}
      onClick={onOpenSettings}
      title={accessibleLabel}
      type="button"
    >
      {contents}
    </button>
  ) : (
    <div
      aria-atomic="true"
      aria-label={accessibleLabel}
      aria-live="polite"
      className={`watch-connect-indicator ${state.phase}`}
      data-watch-connect-status={state.phase}
      role="status"
      title={accessibleLabel}
    >
      {contents}
    </div>
  );
}

export default WatchConnectIndicator;
