import type { HeartRateAccountBlockStatus } from '../lib/heartRateCloud';
import type {
  NativeHeartRateAvailability,
  NativeHeartRateRelaySnapshot,
} from '../lib/nativeHeartRate';
import {
  HeartRateAccountBlockCard,
  type HeartRateAccountBlockState,
} from './HeartRateAccountBlockCard';

export type HeartRateAccountBlockActionState = Readonly<{
  phase: 'idle' | 'starting' | 'phone-ready' | 'queued' | 'error';
  detail?: string;
}>;

type HeartRateAccountBlockSettingsProps = Readonly<{
  availability: NativeHeartRateAvailability | null;
  block: HeartRateAccountBlockStatus | null;
  relayState: NativeHeartRateRelaySnapshot | null;
  action: HeartRateAccountBlockActionState;
  disabled?: boolean;
  onStartOnIPhone: () => void;
  onCopyIPhoneHandoff: () => void;
  onShareIPhoneHandoff: () => void;
  onOpenIPhoneHandoff: () => void;
  onStop: () => void;
  onRetry: () => void;
}>;

export function heartRateAccountBlockCardState({
  availability,
  block,
  relayState,
  action,
  now = Date.now(),
}: Pick<HeartRateAccountBlockSettingsProps, 'availability' | 'block' | 'relayState' | 'action'> & {
  now?: number;
}): HeartRateAccountBlockState {
  if (action.phase === 'error') {
    return { phase: 'error', ...(action.detail ? { displayDetail: action.detail } : {}) };
  }
  if (action.phase === 'starting') {
    return { phase: 'starting', ...(action.detail ? { displayDetail: action.detail } : {}) };
  }

  const nativeSession = relayState?.sessions.find((session) => (
    session.scope === 'account-block'
    && (!block || session.sessionId === block.blockId)
  ));
  if (
    action.phase === 'queued'
    || block?.stopRequestedAt != null
    || nativeSession?.finalized
  ) {
    return { phase: 'queued', ...(action.detail ? { displayDetail: action.detail } : {}) };
  }
  if (
    block?.state === 'live'
    && block.freshUntil != null
    && block.freshUntil >= now
  ) {
    return { phase: 'live', ...(action.detail ? { displayDetail: action.detail } : {}) };
  }
  if (action.phase === 'phone-ready') {
    return { phase: 'phone-ready', ...(action.detail ? { displayDetail: action.detail } : {}) };
  }
  if (block && ['waiting-watch', 'stale', 'live'].includes(block.state)) {
    return {
      phase: 'waiting-watch',
      displayDetail: block.claimedAt == null
        ? 'Open the private handoff on the paired iPhone to start Apple Watch.'
        : 'The iPhone is connected; TrackLab is waiting for a fresh Apple Watch sample.',
    };
  }
  if (availability?.platform !== 'iphone' || availability.supported !== true) {
    return {
      phase: 'unavailable',
      ...(availability?.reason ? { displayDetail: availability.reason } : {}),
    };
  }
  return { phase: 'idle', ...(action.detail ? { displayDetail: action.detail } : {}) };
}

export function HeartRateAccountBlockSettings({
  availability,
  block,
  relayState,
  action,
  disabled = false,
  onStartOnIPhone,
  onCopyIPhoneHandoff,
  onShareIPhoneHandoff,
  onOpenIPhoneHandoff,
  onStop,
  onRetry,
}: HeartRateAccountBlockSettingsProps) {
  const state = heartRateAccountBlockCardState({ availability, block, relayState, action });
  const canStartHere = availability?.platform === 'iphone' && availability.supported === true;
  const canStop = Boolean(
    block
    && !['expired', 'revoked'].includes(block.state),
  ) || Boolean(relayState?.sessions.some((session) => session.scope === 'account-block'));
  const canHandoff = block?.claimedAt == null;
  const onIPhone = availability?.platform === 'iphone';

  return (
    <HeartRateAccountBlockCard
      state={state}
      disabled={disabled}
      onRetry={onRetry}
      {...(canStartHere ? { onStartOnIPhone } : {})}
      {...(canStop ? { onStop } : {})}
      {...(canHandoff ? { onCopyIPhoneHandoff } : {})}
      {...(canHandoff && !onIPhone ? { onShareIPhoneHandoff } : {})}
      {...(canHandoff && canStartHere ? { onOpenIPhoneHandoff } : {})}
    />
  );
}

export default HeartRateAccountBlockSettings;
