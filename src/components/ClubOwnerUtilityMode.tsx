import { useCallback, useRef, type ComponentProps } from 'react';
import { ClubOwnerTrainingPreparationDialog } from './ClubOwnerTrainingPreparationDialog';
import {
  GetPulledView,
  type GetPulledSessionArm,
  type GetPulledSessionCancellation,
  type GetPulledSessionStart,
} from './GetPulledView';
import { ExploreView } from './ExploreView';
import type { UseHeartRateResult } from '../hooks/useHeartRate';
import type { OwnedClub } from '../lib/clubConnect';
import type { ClubTabletSessionCredential } from '../lib/clubTabletStorage';
import type { GetPulledResult } from '../lib/getPulled';
import type { ClubTrainingSelection } from '../lib/trainingHistory';
import type {
  HeartRateStudioBlockStatus,
  HeartRateStudioInvitation,
} from '../lib/heartRateCloud';
import {
  clubOwnerExploreAuthorizationReferences,
  type ClubOwnerTrainingCoordinatorEntry,
} from '../lib/clubOwnerTrainingCoordinator';
import {
  activateClubOwnerUtilityTraining,
  completeClubOwnerUtilityTraining,
  continueClubOwnerUtilityTraining,
  createClubOwnerExploreRequest,
  createClubOwnerGetPulledRequest,
  prepareClubOwnerUtilityTraining,
  resumeClubOwnerExploreTraining,
  saveLegacyExploreHistory,
  saveLegacyGetPulledHistory,
} from '../lib/clubOwnerUtilityTrainingActions';
import type {
  ExploreRideAuthorizationReferences,
  ExploreRideCompleteEvent,
  ExploreRideSessionArm,
  ExploreRideSessionCancellation,
  ExploreRideSessionRestored,
  ExploreRideSessionStartEvent,
  PlayerSlot,
  PlayMode,
} from '../types';

type ValueRef<T> = { current: T };
type PreparationState = Readonly<{
  phase: 'idle' | 'authorizing' | 'ready' | 'activating' | 'active' | 'saving' | 'saved' | 'error';
  sessionId: string | null;
  playerIds: readonly PlayerSlot['id'][];
  detail: string;
  failureStage?: 'prepare' | 'activate' | 'complete';
}>;
type SetPreparation = (value: PreparationState | ((current: PreparationState) => PreparationState)) => void;
type BeginHeartRateRelay = (input: Readonly<{
  sessionId: string;
  activityType: 'get-pulled' | 'explore';
  riderId: string | undefined;
  playerId: PlayerSlot['id'];
  startedAt: number;
}>) => Promise<boolean>;
type FinalizeHeartRateRelay = (input: Readonly<{
  sessionId: string;
  endedAt: number;
  activeDurationMs: number;
}>) => Promise<unknown>;

type OwnerContext = Readonly<{
  authUser: Readonly<{ id: string; profileKey: string }> | null;
  ownedClub: OwnedClub | null;
  clubOwnerActive: boolean;
  clubTabletSessionActive: boolean;
  clubTabletSession: ClubTabletSessionCredential | null;
  clubTrainingSelection: ClubTrainingSelection | null;
  playMode: PlayMode;
  preparation: PreparationState;
  setPreparation: SetPreparation;
  groupRef: ValueRef<ClubOwnerTrainingCoordinatorEntry | null>;
  preparePromiseRef: ValueRef<Promise<void> | null>;
  generationRef: ValueRef<number>;
  completionStartedRef: ValueRef<Set<string>>;
  authorizedPlayersRef: ValueRef<Map<string, Set<PlayerSlot['id']>>>;
  checkpointScopeRef: ValueRef<string | null>;
  startedAtRef: ValueRef<{ sessionId: string; startedAt: number } | null>;
  completionRef: ValueRef<GetPulledResult | ExploreRideCompleteEvent | null>;
  cancelActiveGroup: (options?: { keepalive?: boolean; preserveStatus?: boolean }) => Promise<void>;
  onHistoryChanged: () => void;
}>;

type HeartRateContext = Readonly<{
  heartRate: Pick<UseHeartRateResult, 'measurements' | 'pauseRelay' | 'resumeRelay'>;
  begin: BeginHeartRateRelay;
  finalize: FinalizeHeartRateRelay;
  clear: (sessionId: string) => void;
  relayStartPromisesRef: ValueRef<Map<string, Promise<boolean>>>;
  cancelledSessionsRef: ValueRef<Set<string>>;
  activeSessionRef: ValueRef<string | null>;
  accountBlockCoveredSessionIdsRef: ValueRef<Set<string>>;
  accountBlockCoversSessionsRef: ValueRef<boolean>;
  onMessage: (message: string) => void;
}>;

type PreparationHeartRateProps = Readonly<{
  players: readonly PlayerSlot[];
  actionsByRider: Readonly<Record<string, Readonly<{ phase: 'inviting' | 'error' }>>>;
  blocks: readonly HeartRateStudioBlockStatus[];
  invitations: readonly HeartRateStudioInvitation[];
  now: number;
  onOpen: (playerId: PlayerSlot['id']) => void;
}>;

type GetPulledProps = Omit<ComponentProps<typeof GetPulledView>,
  'onComplete' | 'onSessionArm' | 'onSessionStart' | 'onSessionCancel' | 'onSessionCancelEvent'>;
type ExploreProps = Omit<ComponentProps<typeof ExploreView>,
  'onRideComplete'
  | 'onRideSessionArm'
  | 'onRideSessionRestore'
  | 'onRideSessionStart'
  | 'onRideSessionPause'
  | 'onRideSessionResume'
  | 'onRideSessionCancel'
  | 'onRideSessionReset'>;

export type ClubOwnerUtilityModeProps = Readonly<{
  owner: OwnerContext;
  heartRateContext: HeartRateContext;
  preparationHeartRate: PreparationHeartRateProps;
}> & (
  | Readonly<{ mode: 'get-pulled'; viewProps: GetPulledProps }>
  | Readonly<{ mode: 'explore'; viewProps: ExploreProps }>
);

const idlePreparation: PreparationState = { phase: 'idle', sessionId: null, playerIds: [], detail: '' };

function resultSessionId(result: GetPulledResult | ExploreRideCompleteEvent) {
  return 'id' in result ? result.id : result.sessionId;
}

export function ClubOwnerUtilityMode(props: ClubOwnerUtilityModeProps) {
  const { owner, heartRateContext } = props;
  const demoMode = props.viewProps.demoMode;

  const prepareGroup = async (request: ClubOwnerTrainingCoordinatorEntry['request']) => {
    if (!owner.authUser?.profileKey || owner.groupRef.current) {
      throw new Error('Finish or cancel the current club training preparation first.');
    }
    const generation = ++owner.generationRef.current;
    const checkpointScope = owner.authUser.profileKey;
    const playerIds = request.assignments.map((assignment) => assignment.playerId);
    const pending = prepareClubOwnerUtilityTraining({
      request,
      checkpointScope,
      isCurrent: () => generation === owner.generationRef.current,
      onArm: (entry) => {
        if (generation !== owner.generationRef.current) return;
        owner.groupRef.current = entry;
        owner.checkpointScopeRef.current = checkpointScope;
        owner.authorizedPlayersRef.current.set(request.sessionId, new Set(playerIds));
      },
      onStatus: owner.setPreparation,
    });
    const tracked = pending.then(() => undefined, () => undefined);
    owner.preparePromiseRef.current = tracked;
    try {
      return await pending;
    } finally {
      if (owner.preparePromiseRef.current === tracked) owner.preparePromiseRef.current = null;
    }
  };

  const activateGroup = (entry: ClubOwnerTrainingCoordinatorEntry, exactStartedAt: number) => {
    owner.startedAtRef.current = { sessionId: entry.request.sessionId, startedAt: exactStartedAt };
    void activateClubOwnerUtilityTraining({
      entry,
      startedAt: exactStartedAt,
      checkpointScope: owner.checkpointScopeRef.current,
      isCurrent: () => owner.groupRef.current === entry,
      onStatus: owner.setPreparation,
    }).catch(() => undefined);
  };

  const saveGroup = async (
    result: GetPulledResult | ExploreRideCompleteEvent,
    entry: ClubOwnerTrainingCoordinatorEntry,
  ) => {
    owner.completionRef.current = result;
    owner.completionStartedRef.current.add(entry.request.sessionId);
    try {
      const saved = await completeClubOwnerUtilityTraining({
        entry,
        result,
        checkpointScope: owner.checkpointScopeRef.current,
        isCurrent: () => owner.groupRef.current === entry,
        onCheckpointCleared: () => { owner.checkpointScopeRef.current = null; },
        onHistoryChanged: owner.onHistoryChanged,
        onStatus: owner.setPreparation,
      });
      if (owner.groupRef.current === entry) {
        owner.groupRef.current = null;
        owner.authorizedPlayersRef.current.delete(entry.request.sessionId);
        owner.completionStartedRef.current.delete(entry.request.sessionId);
        owner.startedAtRef.current = null;
        owner.completionRef.current = null;
      }
      return saved;
    } catch (error) {
      owner.completionStartedRef.current.delete(entry.request.sessionId);
      throw error;
    }
  };

  const armGetPulled = async (arm: GetPulledSessionArm) => {
    if (demoMode || owner.clubTabletSessionActive || !owner.clubOwnerActive || owner.playMode !== 'local' || !owner.ownedClub) return true;
    if (arm.riderId === (owner.authUser ? `account:${owner.authUser.id}` : null)) return true;
    const request = createClubOwnerGetPulledRequest(
      owner.ownedClub.id,
      arm,
      new Set(owner.ownedClub.members.filter((member) => member.status === 'claimed').map((member) => member.studioRiderId)),
    );
    if (!request) throw new Error('Assign a claimed club athlete before starting this pull.');
    return Boolean(await prepareGroup(request));
  };

  const startGetPulled = (session: GetPulledSessionStart) => {
    if (demoMode) return;
    const group = owner.groupRef.current;
    if (group?.request.activityType === 'get-pulled' && group.request.sessionId === session.sessionId) {
      activateGroup(group, session.startedAt);
      return;
    }
    void heartRateContext.begin({
      sessionId: session.sessionId,
      activityType: 'get-pulled',
      riderId: session.riderId,
      playerId: session.playerId,
      startedAt: session.startedAt,
    });
  };

  const cancelGetPulled = (session: GetPulledSessionCancellation) => {
    if (owner.groupRef.current?.request.activityType === 'get-pulled'
      && owner.groupRef.current.request.sessionId === session.sessionId) {
      void owner.cancelActiveGroup({ preserveStatus: session.reason === 'authorization-failed' }).catch(() => undefined);
    }
  };

  const completeGetPulled = (result: GetPulledResult) => {
    if (demoMode || (!owner.authUser && !owner.clubTabletSessionActive)) return;
    if (owner.clubTabletSessionActive && result.riderId !== owner.clubTabletSession?.session.studioRiderId) {
      console.warn('Get Pulled result was not saved because the selected club athlete could not be matched safely.');
      return;
    }
    const group = owner.groupRef.current;
    if (group?.request.activityType === 'get-pulled' && group.request.sessionId === result.id) {
      if (!owner.completionStartedRef.current.has(result.id)) void saveGroup(result, group).catch(() => undefined);
      return;
    }
    void heartRateContext.finalize({
      sessionId: result.id,
      endedAt: result.endedAt,
      activeDurationMs: Math.max(0, result.endedAt - result.startedAt),
    });
    void saveLegacyGetPulledHistory(result, owner.clubTrainingSelection)
      .then(owner.onHistoryChanged)
      .catch((error: Error) => console.warn(`Could not save Get Pulled history: ${error.message}`));
  };

  const armExplore = async (
    arm: ExploreRideSessionArm,
  ): Promise<ExploreRideAuthorizationReferences | null | void> => {
    if (demoMode || owner.clubTabletSessionActive || !owner.clubOwnerActive || owner.playMode !== 'local' || !owner.ownedClub) return undefined;
    const request = createClubOwnerExploreRequest(
      owner.ownedClub.id,
      arm,
      new Set(owner.ownedClub.members.filter((member) => member.status === 'claimed').map((member) => member.studioRiderId)),
      owner.authUser ? `account:${owner.authUser.id}` : null,
    );
    if (!request) return undefined;
    const entry = await prepareGroup(request);
    if (!entry) throw new Error('The club Explore preparation was cancelled.');
    return clubOwnerExploreAuthorizationReferences(entry);
  };

  const startExplore = (session: ExploreRideSessionStartEvent) => {
    if (demoMode) return;
    const group = owner.groupRef.current;
    if (group?.request.activityType === 'explore' && group.request.sessionId === session.sessionId) {
      activateGroup(group, session.startedAt);
    }
    const accountRiderId = owner.authUser ? `account:${owner.authUser.id}` : null;
    const rider = accountRiderId ? session.riders.find((candidate) => candidate.riderId === accountRiderId) : undefined;
    if (rider) {
      void heartRateContext.begin({
        sessionId: session.sessionId,
        activityType: 'explore',
        riderId: rider.riderId,
        playerId: rider.playerId,
        startedAt: session.startedAt,
      });
    }
  };

  const restoreExplore = async (session: ExploreRideSessionRestored) => {
    if (!session.studioBinding.authorizationCheckpoint) {
      throw new Error('This older studio ride has no secure recovery checkpoint. Reset it and start a new ride.');
    }
    if (!owner.ownedClub?.id || !owner.authUser?.profileKey) {
      throw new Error('Sign in to the owning club to resume this ride.');
    }
    const existing = owner.groupRef.current;
    if (existing && (existing.request.sessionId !== session.sessionId || existing.request.activityType !== 'explore')) {
      throw new Error('Finish or reset the other prepared club session before resuming this ride.');
    }
    const entry = await resumeClubOwnerExploreTraining({
      existing,
      binding: session.studioBinding,
      sessionId: session.sessionId,
      clubId: owner.ownedClub.id,
      startedAt: session.startedAt,
      checkpointScope: owner.authUser.profileKey,
    });
    owner.groupRef.current = entry;
    owner.checkpointScopeRef.current = owner.authUser.profileKey;
    owner.authorizedPlayersRef.current.set(session.sessionId, new Set(entry.riders.map((rider) => rider.playerId)));
    owner.startedAtRef.current = { sessionId: session.sessionId, startedAt: session.startedAt };
    owner.setPreparation({
      phase: 'active',
      sessionId: session.sessionId,
      playerIds: entry.riders.map((rider) => rider.playerId),
      detail: 'Recovered club Explore history.',
    });
  };

  const cancelExplore = (session: ExploreRideSessionCancellation) => {
    if (owner.groupRef.current?.request.sessionId === session.sessionId) {
      void owner.cancelActiveGroup({ preserveStatus: session.reason === 'authorization-failed' }).catch(() => undefined);
    }
    heartRateContext.clear(session.sessionId);
  };

  const pauseOrResumeExplore = (action: 'pause' | 'resume', session: {
    sessionId: string;
    at: number;
    activeElapsedMs: number;
  }) => {
    if (heartRateContext.accountBlockCoveredSessionIdsRef.current.has(session.sessionId)
      || heartRateContext.accountBlockCoversSessionsRef.current) return;
    void (async () => {
      const pending = heartRateContext.relayStartPromisesRef.current.get(session.sessionId);
      if (pending) await pending.catch(() => false);
      if (heartRateContext.cancelledSessionsRef.current.has(session.sessionId)
        || (heartRateContext.activeSessionRef.current != null
          && heartRateContext.activeSessionRef.current !== session.sessionId)) return;
      const relay = await heartRateContext.heartRate[action === 'pause' ? 'pauseRelay' : 'resumeRelay'](session);
      if (relay.configured) {
        heartRateContext.activeSessionRef.current = session.sessionId;
        if (action === 'resume') heartRateContext.onMessage('Heart rate resumed with the saved Explore ride.');
      }
    })().catch(() => undefined);
  };

  const completeExplore = (result: ExploreRideCompleteEvent) => {
    if (demoMode || (!owner.authUser && !owner.clubTabletSessionActive)) return;
    const tabletRider = owner.clubTabletSessionActive && owner.clubTabletSession
      ? result.riders.find((rider) => rider.riderId === owner.clubTabletSession?.session.studioRiderId)
      : undefined;
    if (owner.clubTabletSessionActive && !tabletRider) {
      console.warn('Club Tablet Explore result was not saved because the selected athlete could not be matched safely.');
      return;
    }
    const group = owner.groupRef.current;
    const matchingGroup = group?.request.activityType === 'explore' && group.request.sessionId === result.sessionId
      ? group
      : null;
    const authorizedPlayerIds = new Set(matchingGroup?.riders.map((rider) => rider.playerId) ?? []);
    if (matchingGroup && !owner.completionStartedRef.current.has(result.sessionId)) {
      void saveGroup(result, matchingGroup).catch(() => undefined);
    }
    const savedRiders = (tabletRider ? [tabletRider] : result.riders)
      .filter((rider) => !authorizedPlayerIds.has(rider.playerId));
    if (savedRiders.length === 0) return;
    const accountRiderId = owner.authUser ? `account:${owner.authUser.id}` : null;
    if (owner.clubTabletSessionActive || savedRiders.some((rider) => rider.riderId === accountRiderId)) {
      void heartRateContext.finalize({
        sessionId: result.sessionId,
        endedAt: result.endedAt,
        activeDurationMs: result.durationMs,
      });
    }
    void saveLegacyExploreHistory({
      result,
      riders: savedRiders,
      clubTrainingSelection: owner.clubTrainingSelection,
      localPlayerId: tabletRider?.playerId ?? null,
    }).then(owner.onHistoryChanged)
      .catch((error: Error) => console.warn(`Could not save Explore the World history: ${error.message}`));
  };

  // App receives live bike/map frames many times per second. Keep the mode
  // lifecycle props stable across those parent renders so Get Pulled's
  // countdown/sample timers and Explore's session effects are not repeatedly
  // torn down and restarted. The ref still routes every call to the latest
  // authorization, account, and heart-rate context.
  const lifecycleRef = useRef({
    armGetPulled,
    startGetPulled,
    cancelGetPulled,
    completeGetPulled,
    armExplore,
    restoreExplore,
    startExplore,
    cancelExplore,
    pauseOrResumeExplore,
    completeExplore,
    clearHeartRate: heartRateContext.clear,
  });
  lifecycleRef.current = {
    armGetPulled,
    startGetPulled,
    cancelGetPulled,
    completeGetPulled,
    armExplore,
    restoreExplore,
    startExplore,
    cancelExplore,
    pauseOrResumeExplore,
    completeExplore,
    clearHeartRate: heartRateContext.clear,
  };
  const onGetPulledArm = useCallback((arm: GetPulledSessionArm) => (
    lifecycleRef.current.armGetPulled(arm)
  ), []);
  const onGetPulledStart = useCallback((session: GetPulledSessionStart) => {
    lifecycleRef.current.startGetPulled(session);
  }, []);
  const onGetPulledCancel = useCallback((sessionId: string) => {
    lifecycleRef.current.clearHeartRate(sessionId);
  }, []);
  const onGetPulledCancelEvent = useCallback((session: GetPulledSessionCancellation) => {
    lifecycleRef.current.cancelGetPulled(session);
  }, []);
  const onGetPulledComplete = useCallback((result: GetPulledResult) => {
    lifecycleRef.current.completeGetPulled(result);
  }, []);
  const onExploreArm = useCallback((arm: ExploreRideSessionArm) => (
    lifecycleRef.current.armExplore(arm)
  ), []);
  const onExploreRestore = useCallback((session: ExploreRideSessionRestored) => (
    lifecycleRef.current.restoreExplore(session)
  ), []);
  const onExploreStart = useCallback((session: ExploreRideSessionStartEvent) => {
    lifecycleRef.current.startExplore(session);
  }, []);
  const onExploreCancel = useCallback((session: ExploreRideSessionCancellation) => {
    lifecycleRef.current.cancelExplore(session);
  }, []);
  const onExplorePause = useCallback((session: {
    sessionId: string;
    at: number;
    activeElapsedMs: number;
  }) => {
    lifecycleRef.current.pauseOrResumeExplore('pause', session);
  }, []);
  const onExploreResume = useCallback((session: {
    sessionId: string;
    at: number;
    activeElapsedMs: number;
  }) => {
    lifecycleRef.current.pauseOrResumeExplore('resume', session);
  }, []);
  const onExploreReset = useCallback((sessionId: string) => {
    lifecycleRef.current.clearHeartRate(sessionId);
  }, []);
  const onExploreComplete = useCallback((result: ExploreRideCompleteEvent) => {
    lifecycleRef.current.completeExplore(result);
  }, []);

  const preparationVisible = owner.preparation.phase === 'authorizing'
    || owner.preparation.phase === 'ready'
    || owner.preparation.phase === 'error';
  const retry = () => {
    const entry = owner.groupRef.current;
    const completion = owner.completionRef.current;
    if (entry && completion && resultSessionId(completion) === entry.request.sessionId
      && owner.preparation.failureStage === 'complete') {
      void saveGroup(completion, entry).catch(() => undefined);
      return;
    }
    const start = owner.startedAtRef.current;
    if (entry && start?.sessionId === entry.request.sessionId && owner.preparation.failureStage === 'activate') {
      activateGroup(entry, start.startedAt);
      return;
    }
    if (entry) {
      void owner.cancelActiveGroup({ preserveStatus: true })
        .then(() => owner.setPreparation(idlePreparation))
        .catch(() => undefined);
    } else {
      owner.setPreparation(idlePreparation);
    }
  };

  return (
    <>
      {preparationVisible && (
        <ClubOwnerTrainingPreparationDialog
          activityLabel={props.mode === 'get-pulled' ? 'Get Pulled' : 'Explore'}
          clubId={owner.ownedClub?.id}
          detail={owner.preparation.detail}
          heartRateActionsByRider={props.preparationHeartRate.actionsByRider}
          heartRateBlocks={props.preparationHeartRate.blocks}
          heartRateInvitations={props.preparationHeartRate.invitations}
          now={props.preparationHeartRate.now}
          onCancel={() => { void owner.cancelActiveGroup().catch(() => undefined); }}
          onHeartRateOpen={props.preparationHeartRate.onOpen}
          onRetry={retry}
          onStart={() => {
            const entry = owner.groupRef.current;
            if (entry) continueClubOwnerUtilityTraining(entry, true);
          }}
          phase={owner.preparation.phase === 'error'
            ? 'error'
            : owner.preparation.phase === 'ready'
              ? 'ready'
              : 'authorizing'}
          retryLabel={owner.preparation.failureStage === 'complete'
            || owner.preparation.failureStage === 'activate'
            ? 'Retry athlete save'
            : 'Retry preparation'}
          playerIds={owner.preparation.playerIds}
          players={props.preparationHeartRate.players}
        />
      )}
      {props.mode === 'get-pulled' ? (
        <GetPulledView
          {...props.viewProps}
          onComplete={onGetPulledComplete}
          onSessionArm={onGetPulledArm}
          onSessionStart={onGetPulledStart}
          onSessionCancel={onGetPulledCancel}
          onSessionCancelEvent={onGetPulledCancelEvent}
        />
      ) : (
        <ExploreView
          {...props.viewProps}
          onRideComplete={onExploreComplete}
          onRideSessionArm={onExploreArm}
          onRideSessionRestore={onExploreRestore}
          onRideSessionStart={onExploreStart}
          onRideSessionPause={onExplorePause}
          onRideSessionResume={onExploreResume}
          onRideSessionCancel={onExploreCancel}
          onRideSessionReset={onExploreReset}
        />
      )}
    </>
  );
}

export default ClubOwnerUtilityMode;
