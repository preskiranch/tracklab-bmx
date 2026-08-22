import { formatWatchConnectTimeRemaining, watchConnectRemainingMs } from './watchConnect';
import type { WatchConnectStudioProjection } from './watchConnectCloud';
import type { ClubTabletWatchConnectStatus } from './clubTabletStorage';

export type StudioWatchConnectSelectionState = Readonly<{
  phase: 'unclaimed' | 'not-set-up' | 'recognized' | 'connected' | 'ended';
  label: string;
  detail: string;
  connectedUntil: number | null;
  remainingMs: number;
}>;

export function studioWatchConnectOwnerLabel(state: StudioWatchConnectSelectionState) {
  if (state.phase === 'not-set-up') return 'Set up on paired iPhone';
  if (state.phase === 'unclaimed') return 'Claim profile first';
  return state.label;
}

/**
 * Resolves a tablet row from stable club + studio rider identity after the
 * roster confirms that profile is claimed. Display names and current
 * Wattbike/slot assignments are never accepted, so reconnecting a bike cannot
 * switch or clear Watch identity.
 */
export function studioWatchConnectSelectionState({
  clubId,
  studioRiderId,
  claimed,
  projections,
  now = Date.now(),
}: {
  clubId: string;
  studioRiderId: string;
  claimed: boolean;
  projections: readonly WatchConnectStudioProjection[];
  now?: number;
}): StudioWatchConnectSelectionState {
  if (!claimed) {
    return {
      phase: 'unclaimed',
      label: 'Watch Connect',
      detail: 'This athlete must claim their TrackLab profile before connecting a Watch.',
      connectedUntil: null,
      remainingMs: 0,
    };
  }
  const projection = projections.find((candidate) => (
    candidate.clubId === clubId
    && candidate.studioRiderId === studioRiderId
  )) ?? null;
  if (!projection || projection.state === 'not-set-up') {
    return {
      phase: 'not-set-up',
      label: 'Watch Connect',
      detail: 'Set up Watch Connect once on this athlete’s paired iPhone.',
      connectedUntil: null,
      remainingMs: 0,
    };
  }
  const remainingMs = projection.connection?.state === 'connected'
    ? watchConnectRemainingMs(projection.connection.connectedUntil, now)
    : 0;
  if (projection.state === 'connected' && projection.connection && remainingMs > 0) {
    return {
      phase: 'connected',
      label: `Connected · ${formatWatchConnectTimeRemaining(remainingMs)}`,
      detail: 'Watch recognized for this athlete across every program on this tablet.',
      connectedUntil: projection.connection.connectedUntil,
      remainingMs,
    };
  }
  if (projection.state === 'ready' && projection.enrollment?.state === 'trusted') {
    return {
      phase: 'recognized',
      label: 'Recognized',
      detail: 'This Watch is remembered. The athlete presses Watch Connect once for four hours.',
      connectedUntil: null,
      remainingMs: 0,
    };
  }
  return {
    phase: 'ended',
    label: 'Session ended',
    detail: 'The Watch is remembered. Press Watch Connect on the paired iPhone for four more hours.',
    connectedUntil: projection.connection?.connectedUntil ?? null,
    remainingMs: 0,
  };
}

export function clubTabletWatchConnectSelectionState({
  claimed,
  status,
  now = Date.now(),
}: {
  claimed: boolean;
  status: ClubTabletWatchConnectStatus | null | undefined;
  now?: number;
}): StudioWatchConnectSelectionState {
  if (!claimed) {
    return {
      phase: 'unclaimed',
      label: 'Watch Connect',
      detail: 'This athlete must claim their TrackLab profile before connecting a Watch.',
      connectedUntil: null,
      remainingMs: 0,
    };
  }
  const remainingMs = status?.state === 'connected' && status.connectedUntil != null
    ? watchConnectRemainingMs(status.connectedUntil, now)
    : 0;
  if (status?.state === 'connected' && status.recognized && status.connectedUntil != null && remainingMs > 0) {
    if (!status.liveSharingEnabled) {
      return {
        phase: 'connected',
        label: 'Watch connected · live sharing off',
        detail: 'This Watch is recognized, but live BPM stays private until the athlete enables Live BPM sharing on the paired iPhone.',
        connectedUntil: status.connectedUntil,
        remainingMs,
      };
    }
    return {
      phase: 'connected',
      label: `Connected · ${formatWatchConnectTimeRemaining(remainingMs)}`,
      detail: 'Watch recognized for this athlete across every program on this tablet.',
      connectedUntil: status.connectedUntil,
      remainingMs,
    };
  }
  if (status?.recognized && status.state === 'ready') {
    return {
      phase: 'recognized',
      label: 'Recognized',
      detail: 'On the paired iPhone, press Watch Connect once for four hours.',
      connectedUntil: null,
      remainingMs: 0,
    };
  }
  if (status?.recognized && status.state === 'expired') {
    return {
      phase: 'ended',
      label: 'Session ended',
      detail: 'On the paired iPhone, press Watch Connect for four more hours.',
      connectedUntil: status.connectedUntil,
      remainingMs: 0,
    };
  }
  return {
    phase: 'not-set-up',
    label: 'Set up on paired iPhone',
    detail: 'Open TrackLab on this athlete’s paired iPhone and use Watch Connect once.',
    connectedUntil: null,
    remainingMs: 0,
  };
}
