import { Check, Clock3, Watch } from 'lucide-react';
import type { StudioWatchConnectSelectionState } from '../lib/studioWatchConnectSelection';
import './StudioWatchConnectStatus.css';

export type StudioWatchConnectStatusProps = Readonly<{
  athleteName: string;
  state: StudioWatchConnectSelectionState;
}>;

/** Athlete-safe tablet status. It deliberately exposes no owner controls. */
export function StudioWatchConnectStatus({ athleteName, state }: StudioWatchConnectStatusProps) {
  const Icon = state.phase === 'connected'
    ? Check
    : state.phase === 'recognized'
      ? Watch
      : Clock3;
  return (
    <span
      aria-label={`${athleteName} Watch Connect: ${state.label}`}
      className={`studio-watch-connect-status ${state.phase}`}
      title={state.detail}
    >
      <Icon aria-hidden="true" size={13} /> {state.label}
    </span>
  );
}

export default StudioWatchConnectStatus;
