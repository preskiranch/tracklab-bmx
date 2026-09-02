import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clubTabletRecoveryFinishSignals as selectClubTabletRecoveryFinishSignals,
  flushClubTabletRecoveryOutbox,
  submitClubTabletRecoveryEpisode,
  type ClubTabletRecoveryFinishContext,
} from '../lib/clubTabletRecoveryAlert';
import {
  recoverySubmissionCanRetry,
  recoverySubmissionRetryDelayMs,
  retainPendingRecoveryFinishSignals,
  type RecoveryFinishSignal,
} from '../lib/recoveryFinishSignals';

export type ClubTabletRecoveryCoordinatorProps = ClubTabletRecoveryFinishContext;
export { clubTabletRecoveryFinishSignals } from '../lib/clubTabletRecoveryAlert';

function retryableClubTabletRecoveryError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return !(
    message.includes('expired or ended')
    || message.includes('claimed tracklab account')
    || message.includes('does not accept an account')
    || message.includes('needs one valid')
    || message.includes('already used')
  );
}

/**
 * This coordinator is intentionally non-visual and never schedules a native
 * recovery notification on the shared tablet. It only durably records a
 * selected claimed athlete's finish; the athlete's own account/device owns
 * the timer and alert.
 */
export function ClubTabletRecoveryCoordinator(props: ClubTabletRecoveryCoordinatorProps) {
  const { credential } = props;
  const finishSignals = useMemo(() => selectClubTabletRecoveryFinishSignals(props), [
    credential,
    props.getPulledResult,
    props.mode,
    props.raceCapture,
    props.raceRiders,
  ]);
  const finishSignalsRef = useRef(finishSignals);
  finishSignalsRef.current = finishSignals;
  const signalKey = finishSignals.map((signal) => signal.requestId).join('|');
  const [retryRevision, setRetryRevision] = useState(0);
  const mountedRef = useRef(true);
  const submittedRequestIdsRef = useRef(new Set<string>());
  const pendingSignalsRef = useRef(new Map<string, RecoveryFinishSignal>());
  const submissionAttemptsRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Map<string, number>());
  const sessionTokenRef = useRef(credential.sessionToken);
  sessionTokenRef.current = credential.sessionToken;

  useEffect(() => {
    mountedRef.current = true;
    submittedRequestIdsRef.current.clear();
    pendingSignalsRef.current.clear();
    submissionAttemptsRef.current.clear();
    retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    retryTimersRef.current.clear();
    // Retry opaque finishes retained before a prior athlete handoff. The
    // server resolves each by its original result credential, not this
    // session's selected athlete.
    void flushClubTabletRecoveryOutbox({ keepalive: true }).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      retryTimersRef.current.clear();
    };
  }, [credential.sessionToken]);

  useEffect(() => {
    const submittedForToken = credential.sessionToken;
    const isCurrentSession = () => mountedRef.current && sessionTokenRef.current === submittedForToken;
    pendingSignalsRef.current = retainPendingRecoveryFinishSignals(
      pendingSignalsRef.current,
      finishSignalsRef.current.filter((signal) => !submittedRequestIdsRef.current.has(signal.requestId)),
    );
    pendingSignalsRef.current.forEach((signal) => {
      if (submittedRequestIdsRef.current.has(signal.requestId)) return;
      submittedRequestIdsRef.current.add(signal.requestId);
      void submitClubTabletRecoveryEpisode({
        requestId: signal.requestId,
        activityType: signal.activityType,
        sessionId: signal.sessionId,
        repetitionId: signal.repetitionId,
        finishedAt: signal.finishedAt,
        effortSummary: signal.effortSummary,
      }, credential).then(() => {
        if (!isCurrentSession()) return;
        submissionAttemptsRef.current.delete(signal.requestId);
        pendingSignalsRef.current.delete(signal.requestId);
        const retryTimer = retryTimersRef.current.get(signal.requestId);
        if (retryTimer != null) window.clearTimeout(retryTimer);
        retryTimersRef.current.delete(signal.requestId);
      }).catch((error: unknown) => {
        if (!isCurrentSession()) return;
        submittedRequestIdsRef.current.delete(signal.requestId);
        const attempt = (submissionAttemptsRef.current.get(signal.requestId) ?? 0) + 1;
        submissionAttemptsRef.current.set(signal.requestId, attempt);
        const retryTimer = retryTimersRef.current.get(signal.requestId);
        if (retryTimer != null) window.clearTimeout(retryTimer);
        if (retryableClubTabletRecoveryError(error) && recoverySubmissionCanRetry(attempt)) {
          retryTimersRef.current.set(signal.requestId, window.setTimeout(() => {
            retryTimersRef.current.delete(signal.requestId);
            if (isCurrentSession()) setRetryRevision((revision) => revision + 1);
          }, recoverySubmissionRetryDelayMs(attempt)));
          return;
        }
        pendingSignalsRef.current.delete(signal.requestId);
        submissionAttemptsRef.current.delete(signal.requestId);
      });
    });
  }, [credential.sessionToken, retryRevision, signalKey]);

  return null;
}

export default ClubTabletRecoveryCoordinator;
