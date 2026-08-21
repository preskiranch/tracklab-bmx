import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { UseHeartRateResult } from '../hooks/useHeartRate';
import type { HeartRateAccountBlockStatus } from '../lib/heartRateCloud';
import type { HeartRateAccountBlockSecret } from '../lib/heartRateAccountBlockActions';
import {
  HeartRateAccountBlockSettings,
  type HeartRateAccountBlockActionState,
} from './HeartRateAccountBlockSettings';

export const heartRateAccountBlockSettingsSlotId = 'heart-rate-account-block-settings-slot';

type AccountHydration = {
  accountId: string;
  promise: Promise<boolean>;
};

type PendingStop = Readonly<{
  pairingId: string;
  blockId: string;
  localRelayObserved: boolean;
}>;

type HeartRateAccountBlockCoordinatorProps = Readonly<{
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  accountId: string | null;
  kioskMode: boolean;
  settingsOpen: boolean;
  hydratedAccountId: string | null;
  heartRate: UseHeartRateResult;
  accountHydrationRef: MutableRefObject<AccountHydration | null>;
  activeRelaySessionRef: MutableRefObject<string | null>;
  activePairingIdRef: MutableRefObject<string | null>;
  pairingIdsBySessionRef: MutableRefObject<Map<string, string>>;
  knownPairingIdsRef: MutableRefObject<Set<string>>;
  accountBlocksRef: MutableRefObject<HeartRateAccountBlockStatus[]>;
  activeBlockRef: MutableRefObject<HeartRateAccountBlockStatus | null>;
  coversSessionsRef: MutableRefObject<boolean>;
  observedRelayIdsRef: MutableRefObject<Set<string>>;
  actionPromiseRef: MutableRefObject<Promise<void> | null>;
  onMessage: (message: string) => void;
  onRequestSignIn: () => void;
  onOpenSettings: () => void;
  onBlockPresenceChange: (present: boolean) => void;
}>;

export function HeartRateAccountBlockCoordinator({
  authStatus,
  accountId,
  kioskMode,
  settingsOpen,
  hydratedAccountId,
  heartRate,
  accountHydrationRef,
  activeRelaySessionRef,
  activePairingIdRef,
  pairingIdsBySessionRef,
  knownPairingIdsRef,
  accountBlocksRef,
  activeBlockRef,
  coversSessionsRef,
  observedRelayIdsRef,
  actionPromiseRef,
  onMessage,
  onRequestSignIn,
  onOpenSettings,
  onBlockPresenceChange,
}: HeartRateAccountBlockCoordinatorProps) {
  const secretRef = useRef<HeartRateAccountBlockSecret | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const handoffPromiseRef = useRef<Promise<HeartRateAccountBlockSecret> | null>(null);
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const pendingStopRef = useRef<PendingStop | null>(null);
  const previousAccountIdRef = useRef<string | null>(accountId);
  const [blocks, setBlocks] = useState<HeartRateAccountBlockStatus[]>([]);
  const [action, setAction] = useState<HeartRateAccountBlockActionState>({ phase: 'idle' });
  const [handoffPending, setHandoffPending] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const currentBlock = useMemo(() => {
    const ordered = [...blocks].sort((left, right) => right.updatedAt - left.updatedAt);
    const reusable = ordered.filter((block) => !['expired', 'revoked'].includes(block.state));
    const preferredPairingId = activeBlockRef.current?.pairingId;
    return reusable.find((block) => block.pairingId === preferredPairingId)
      ?? reusable.find((block) => block.stopRequestedAt == null)
      ?? reusable[0]
      ?? ordered[0]
      ?? null;
  }, [activeBlockRef, blocks]);

  useEffect(() => {
    setPortalTarget(settingsOpen && typeof document !== 'undefined'
      ? document.getElementById(heartRateAccountBlockSettingsSlotId)
      : null);
  }, [settingsOpen]);

  useEffect(() => {
    if (previousAccountIdRef.current === accountId) return;
    previousAccountIdRef.current = accountId;
    accountBlocksRef.current = [];
    activeBlockRef.current = null;
    coversSessionsRef.current = false;
    observedRelayIdsRef.current.clear();
    pendingStopRef.current = null;
    setBlocks([]);
    setAction({ phase: 'idle' });
    onBlockPresenceChange(false);
  }, [
    accountBlocksRef,
    accountId,
    activeBlockRef,
    coversSessionsRef,
    observedRelayIdsRef,
    onBlockPresenceChange,
  ]);

  const storeBlock = useCallback((block: HeartRateAccountBlockStatus) => {
    setBlocks((current) => {
      const next = [block, ...current.filter((candidate) => candidate.pairingId !== block.pairingId)]
        .sort((left, right) => right.updatedAt - left.updatedAt);
      accountBlocksRef.current = next;
      return next;
    });
    activeBlockRef.current = block;
    knownPairingIdsRef.current.add(block.pairingId);
    pairingIdsBySessionRef.current.set(block.blockId, block.pairingId);
    onBlockPresenceChange(!['expired', 'revoked'].includes(block.state));
  }, [
    accountBlocksRef,
    activeBlockRef,
    knownPairingIdsRef,
    onBlockPresenceChange,
    pairingIdsBySessionRef,
  ]);

  const clearHandoff = useCallback(() => {
    secretRef.current = null;
    requestIdRef.current = null;
    handoffPromiseRef.current = null;
    setHandoffPending(false);
    void import('../lib/heartRateAccountBlock').then(({ removeHeartRateAccountBlockHandoffHref }) => {
      const nextHref = removeHeartRateAccountBlockHandoffHref(window.location.href);
      if (nextHref) window.history.replaceState(window.history.state, '', nextHref);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      void import('../lib/heartRateAccountBlock').then((helpers) => {
        if (disposed) return;
        const parsed = helpers.parseHeartRateAccountBlockHandoffHref(
          window.location.href,
          window.location.origin,
        );
        if (!parsed.present) return;
        if (!parsed.pairCode) {
          const nextHref = helpers.removeHeartRateAccountBlockHandoffHref(window.location.href);
          if (nextHref) window.history.replaceState(window.history.state, '', nextHref);
          secretRef.current = null;
          setHandoffPending(false);
          return;
        }
        secretRef.current = {
          pairCode: parsed.pairCode,
          pairingId: null,
          blockId: null,
          handoffHref: window.location.href,
        };
        setHandoffPending(true);
      });
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    void Promise.all([
      import('../lib/nativeAppLinks'),
      import('../lib/heartRateAccountBlock'),
    ]).then(async ([nativeLinks, handoff]) => {
      listener = await nativeLinks.listenForHeartRateAccountBlockAppLinks((pairCode) => {
        if (disposed) return;
        const handoffHref = handoff.heartRateAccountBlockHandoffHref(window.location.href, pairCode);
        if (!handoffHref) return;
        window.history.replaceState(window.history.state, '', handoffHref);
        secretRef.current = { pairCode, pairingId: null, blockId: null, handoffHref };
        setHandoffPending(true);
      });
      if (disposed && listener) void listener.remove();
    }).catch(() => undefined);
    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !accountId || kioskMode) return undefined;
    let disposed = false;
    let requestActive = false;
    const cloud = import('../lib/heartRateCloud');
    const refresh = async () => {
      if (requestActive) return;
      requestActive = true;
      try {
        const loaded = await cloud.then(({ loadHeartRateAccountBlocks }) => loadHeartRateAccountBlocks());
        if (disposed) return;
        const ordered = [...loaded].sort((left, right) => right.updatedAt - left.updatedAt);
        const nativeBlockId = heartRate.relayState?.sessions.find((session) => (
          session.scope === 'account-block'
        ))?.sessionId ?? null;
        if (nativeBlockId) observedRelayIdsRef.current.add(nativeBlockId);
        const preferredPairingId = activeBlockRef.current?.pairingId;
        const reusable = ordered.filter((block) => !['expired', 'revoked'].includes(block.state));
        const selected = reusable.find((block) => block.blockId === nativeBlockId)
          ?? reusable.find((block) => block.pairingId === preferredPairingId)
          ?? reusable.find((block) => block.stopRequestedAt == null)
          ?? reusable[0]
          ?? ordered[0]
          ?? null;
        accountBlocksRef.current = ordered;
        activeBlockRef.current = selected;
        setBlocks(ordered);
        loaded.forEach((block) => {
          knownPairingIdsRef.current.add(block.pairingId);
          pairingIdsBySessionRef.current.set(block.blockId, block.pairingId);
        });
        coversSessionsRef.current = Boolean(
          selected
          && selected.claimedAt != null
          && selected.stopRequestedAt == null
          && ['waiting-watch', 'live', 'stale'].includes(selected.state)
          && selected.effectiveExpiresAt > Date.now(),
        );
        onBlockPresenceChange(Boolean(selected && !['expired', 'revoked'].includes(selected.state)));
        if (selected && nativeBlockId === selected.blockId) {
          activeRelaySessionRef.current = selected.blockId;
          activePairingIdRef.current = selected.pairingId;
        }
        if (selected?.stopRequestedAt != null && !['expired', 'revoked'].includes(selected.state)) {
          setAction({
            phase: 'queued',
            detail: 'The account block is stopping. Private samples remain queued on the iPhone until cloud sync finishes.',
          });
        } else if (selected && ['expired', 'revoked'].includes(selected.state)) {
          pendingStopRef.current = null;
          setAction((current) => current.phase === 'queued' ? {
            phase: 'idle',
            detail: 'The previous private Apple Watch block finished syncing and stopped.',
          } : current);
        }
      } catch {
        if (!disposed) onMessage('Private Apple Watch block status could not refresh. TrackLab will retry automatically.');
      } finally {
        requestActive = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    accountBlocksRef,
    accountId,
    activeBlockRef,
    activePairingIdRef,
    activeRelaySessionRef,
    authStatus,
    coversSessionsRef,
    heartRate.relayState,
    kioskMode,
    knownPairingIdsRef,
    observedRelayIdsRef,
    onMessage,
    onBlockPresenceChange,
    pairingIdsBySessionRef,
  ]);

  const ensureHandoff = useCallback(() => {
    if (secretRef.current) return Promise.resolve(secretRef.current);
    if (handoffPromiseRef.current) return handoffPromiseRef.current;
    const randomPart = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    const requestId = requestIdRef.current ?? `heart_rate_account_${randomPart}`;
    const waitingBlock = activeBlockRef.current;
    if (!(waitingBlock?.state === 'waiting-watch' && waitingBlock.claimedAt == null)) {
      requestIdRef.current = requestId;
    }
    const request = import('../lib/heartRateAccountBlockActions').then((actions) => (
      actions.prepareHeartRateAccountBlockHandoff({
        currentHref: window.location.href,
        waitingBlock,
        requestId,
      })
    )).then(({ block, secret }) => {
      secretRef.current = secret;
      storeBlock(block);
      return secret;
    }).finally(() => {
      handoffPromiseRef.current = null;
    });
    handoffPromiseRef.current = request;
    return request;
  }, [activeBlockRef, storeBlock]);

  const start = useCallback(() => {
    if (actionPromiseRef.current) return;
    const operation = (async () => {
      if (!accountId) {
        onRequestSignIn();
        setAction({ phase: 'error', detail: 'Sign in to the same personal TrackLab account that created this private handoff.' });
        return;
      }
      if (heartRate.availability?.platform !== 'iphone' || !heartRate.availability.supported) {
        setAction({
          phase: 'error',
          detail: heartRate.availability?.reason
            || 'Open this private handoff in the native TrackLab app on the iPhone paired with Apple Watch.',
        });
        return;
      }
      const hydration = accountHydrationRef.current;
      if (!hydration || hydration.accountId !== accountId || !(await hydration.promise)) {
        throw new Error('TrackLab could not verify this iPhone relay for the signed-in account. Retry after account recovery finishes.');
      }
      const secret = await ensureHandoff();
      setAction({ phase: 'starting', detail: 'Claiming the private handoff and asking Apple Watch to start.' });
      const actions = await import('../lib/heartRateAccountBlockActions');
      try {
        const connected = await actions.connectHeartRateAccountBlockOnIPhone({
          accountId,
          secret,
          currentWorkout: heartRate.status,
          baseUrl: window.location.origin,
          startWorkout: heartRate.startWorkout,
          resumeWorkout: heartRate.resumeWorkout,
          endWorkout: heartRate.endWorkout,
          configureRelay: heartRate.configureRelay,
          clearRelay: heartRate.clearRelay,
        });
        activeRelaySessionRef.current = connected.blockId;
        activePairingIdRef.current = connected.pairingId;
        pairingIdsBySessionRef.current.set(connected.blockId, connected.pairingId);
        knownPairingIdsRef.current.add(connected.pairingId);
        observedRelayIdsRef.current.add(connected.blockId);
        coversSessionsRef.current = true;
        const connectedBlock = activeBlockRef.current;
        if (connectedBlock?.pairingId === connected.pairingId) {
          storeBlock({ ...connectedBlock, claimedAt: connectedBlock.claimedAt ?? Date.now(), updatedAt: Date.now() });
        }
        clearHandoff();
        setAction({ phase: 'phone-ready', detail: 'The account-owned workout is connected. Waiting for a fresh Apple Watch sample.' });
        onMessage('Private Apple Watch heart rate is ready for exact session windows on every device signed in to this account.');
      } catch (error) {
        if (error && typeof error === 'object' && 'pairingId' in error && typeof error.pairingId === 'string') {
          clearHandoff();
        }
        throw error;
      }
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: 'error', detail });
      onMessage(detail);
    }).finally(() => {
      actionPromiseRef.current = null;
    });
    actionPromiseRef.current = operation;
  }, [
    accountHydrationRef,
    accountId,
    actionPromiseRef,
    activeBlockRef,
    activePairingIdRef,
    activeRelaySessionRef,
    clearHandoff,
    coversSessionsRef,
    ensureHandoff,
    heartRate,
    knownPairingIdsRef,
    observedRelayIdsRef,
    onMessage,
    onRequestSignIn,
    pairingIdsBySessionRef,
    storeBlock,
  ]);

  const runHandoffAction = useCallback((kind: 'copy' | 'share') => {
    if (actionPromiseRef.current) return;
    setAction({ phase: 'starting', detail: 'Creating a one-use private iPhone handoff.' });
    const operation = ensureHandoff().then(async (secret) => {
      const actions = await import('../lib/heartRateAccountBlockActions');
      if (kind === 'copy') await actions.copyHeartRateAccountBlockHandoff(secret.handoffHref);
      else await actions.shareHeartRateAccountBlockHandoff(secret.handoffHref);
      setAction({ phase: 'idle' });
      if (kind === 'copy') {
        onMessage('Private iPhone handoff copied. Open it only on the paired iPhone while signed in to this same TrackLab account.');
      }
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAction({ phase: 'idle' });
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: 'error', detail });
      onMessage(detail);
    }).finally(() => {
      actionPromiseRef.current = null;
    });
    actionPromiseRef.current = operation;
  }, [actionPromiseRef, ensureHandoff, onMessage]);

  const requestStop = useCallback((options: {
    endNativeWorkout: boolean;
    serverAlreadyRequested?: boolean;
    localRelayObserved?: boolean;
  }) => {
    if (actionPromiseRef.current) return;
    const operation = (async () => {
      const block = activeBlockRef.current;
      const fallbackBlockId = heartRate.relayState?.sessions.find((session) => (
        session.scope === 'account-block'
      ))?.sessionId ?? null;
      setAction({
        phase: 'starting',
        detail: options.endNativeWorkout ? 'Ending the account-owned Apple Watch workout.' : 'Stopping the private account block.',
      });
      const actions = await import('../lib/heartRateAccountBlockActions');
      const stopped = await actions.stopHeartRateAccountBlockAction({
        block,
        fallbackPairingId: fallbackBlockId ? pairingIdsBySessionRef.current.get(fallbackBlockId) ?? null : null,
        fallbackBlockId,
        relayState: heartRate.relayState,
        workoutStatus: heartRate.status,
        observedRelay: Boolean(
          options.localRelayObserved
          || (block?.blockId && observedRelayIdsRef.current.has(block.blockId))
          || (fallbackBlockId && observedRelayIdsRef.current.has(fallbackBlockId)),
        ),
        endNativeWorkout: options.endNativeWorkout,
        serverAlreadyRequested: options.serverAlreadyRequested === true,
        endWorkout: heartRate.endWorkout,
      });
      const { pairingId, blockId, localRelayObserved } = stopped;
      storeBlock(stopped.block);
      coversSessionsRef.current = false;
      clearHandoff();
      if (stopped.draining) {
        pendingStopRef.current = { pairingId, blockId, localRelayObserved };
        setAction({
          phase: 'queued',
          detail: 'The completed block is queued on the paired iPhone for private cloud sync. Keep its TrackLab app installed and signed in.',
        });
        onMessage('Apple Watch stopped. Private account heart rate is queued on the paired iPhone for cloud sync.');
        return;
      }
      pendingStopRef.current = null;
      if (activeRelaySessionRef.current === blockId) {
        activeRelaySessionRef.current = null;
        activePairingIdRef.current = null;
      }
      pairingIdsBySessionRef.current.delete(blockId);
      observedRelayIdsRef.current.delete(blockId);
      setAction({ phase: 'idle', detail: 'The private Apple Watch block stopped.' });
      onMessage('The private Apple Watch block stopped. Athlete-owned Apple Health history was not deleted.');
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: 'error', detail });
      onMessage(detail);
    }).finally(() => {
      actionPromiseRef.current = null;
    });
    actionPromiseRef.current = operation;
  }, [
    actionPromiseRef,
    activeBlockRef,
    activePairingIdRef,
    activeRelaySessionRef,
    clearHandoff,
    coversSessionsRef,
    heartRate,
    observedRelayIdsRef,
    onMessage,
    pairingIdsBySessionRef,
    storeBlock,
  ]);

  useEffect(() => {
    const pending = pendingStopRef.current;
    if (!pending?.localRelayObserved || !heartRate.relayState) return;
    if (heartRate.relayState.sessions.some((session) => (
      session.scope === 'account-block' && session.sessionId === pending.blockId
    )) || drainPromiseRef.current) return;
    const drain = import('../lib/heartRateCloud').then(({ stopHeartRateAccountBlock }) => (
      stopHeartRateAccountBlock(pending.pairingId)
    )).then((stopped) => {
      storeBlock(stopped.block);
      if (stopped.draining) {
        pendingStopRef.current = { ...pending, localRelayObserved: false };
        return;
      }
      pendingStopRef.current = null;
      if (activeRelaySessionRef.current === pending.blockId) {
        activeRelaySessionRef.current = null;
        activePairingIdRef.current = null;
      }
      pairingIdsBySessionRef.current.delete(pending.blockId);
      observedRelayIdsRef.current.delete(pending.blockId);
      setAction({ phase: 'idle', detail: 'The private Apple Watch block synced and stopped.' });
      onMessage('Private Apple Watch heart rate synced to TrackLab Cloud and the account block stopped.');
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: 'error', detail });
      onMessage(`Private heart rate is still queued. ${detail}`);
    }).finally(() => {
      drainPromiseRef.current = null;
    });
    drainPromiseRef.current = drain;
  }, [
    activePairingIdRef,
    activeRelaySessionRef,
    heartRate.relayState,
    observedRelayIdsRef,
    onMessage,
    pairingIdsBySessionRef,
    storeBlock,
  ]);

  useEffect(() => {
    const block = activeBlockRef.current;
    if (!block?.stopRequestedAt || pendingStopRef.current) return;
    const localRelay = heartRate.relayState?.sessions.some((session) => (
      session.scope === 'account-block' && session.sessionId === block.blockId
    )) ?? false;
    const localWorkout = heartRate.status?.sessionId === `watch-account-block:${block.pairingId}`;
    if (!localRelay && !localWorkout) return;
    requestStop({
      endNativeWorkout: localWorkout,
      serverAlreadyRequested: true,
      localRelayObserved: localRelay,
    });
  }, [activeBlockRef, heartRate.relayState, heartRate.status, requestStop]);

  useEffect(() => {
    const block = activeBlockRef.current;
    if (heartRate.status?.state !== 'ended' || !block || block.stopRequestedAt || pendingStopRef.current) return;
    const endedAccountWorkout = heartRate.status.sessionId === `watch-account-block:${block.pairingId}`
      || (heartRate.status.relay?.scope === 'account-block' && heartRate.status.relay.sessionId === block.blockId);
    if (!endedAccountWorkout) return;
    requestStop({
      endNativeWorkout: false,
      localRelayObserved: heartRate.relayState?.sessions.some((session) => (
        session.scope === 'account-block' && session.sessionId === block.blockId
      )),
    });
  }, [activeBlockRef, heartRate.relayState, heartRate.status, requestStop]);

  useEffect(() => {
    if (!handoffPending) return;
    if (authStatus !== 'signed-in' || !accountId) {
      if (authStatus === 'signed-out') onRequestSignIn();
      return;
    }
    onOpenSettings();
    if (hydratedAccountId !== accountId || !heartRate.availability || action.phase !== 'idle') return;
    if (heartRate.availability.platform !== 'iphone' || !heartRate.availability.supported) {
      setAction({
        phase: 'error',
        detail: 'This private handoff must be opened in the native TrackLab app on the iPhone paired with Apple Watch.',
      });
      return;
    }
    start();
  }, [
    accountId,
    action.phase,
    authStatus,
    handoffPending,
    heartRate.availability,
    hydratedAccountId,
    onOpenSettings,
    onRequestSignIn,
    start,
  ]);

  if (!portalTarget || kioskMode) return null;
  return createPortal(
    <HeartRateAccountBlockSettings
      availability={heartRate.availability}
      block={currentBlock}
      relayState={heartRate.relayState}
      action={action}
      disabled={action.phase === 'starting'}
      onStartOnIPhone={start}
      onCopyIPhoneHandoff={() => runHandoffAction('copy')}
      onShareIPhoneHandoff={() => runHandoffAction('share')}
      onOpenIPhoneHandoff={start}
      onStop={() => requestStop({ endNativeWorkout: true })}
      onRetry={() => {
        setAction({ phase: 'idle' });
        onMessage('');
        void heartRate.refreshAvailability();
        if (handoffPending && heartRate.availability?.platform === 'iphone' && heartRate.availability.supported) start();
      }}
    />,
    portalTarget,
  );
}

export default HeartRateAccountBlockCoordinator;
