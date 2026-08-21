import type {
  GetPulledSessionArm,
} from '../components/GetPulledView';
import type {
  ExploreRideCompleteEvent,
  ExploreRideSessionArm,
  ExploreRideStudioBinding,
  PlayerSlot,
} from '../types';
import type { GetPulledResult } from './getPulled';
import type { ClubOwnerTrainingAuthorizationRequest } from './clubOwnerTrainingHistory';
import type { ClubTrainingSelection } from './trainingHistory';
import {
  activateAndCheckpointClubOwnerTrainingGroup,
  cancelClubOwnerTrainingGroup,
  checkpointClubOwnerTrainingGroup,
  clearClubOwnerTrainingCheckpoint,
  clubOwnerTrainingGroupMatches,
  completeClubOwnerExploreRide,
  completeClubOwnerGetPulledResult,
  prepareClubOwnerTrainingGroup,
  recoverClubOwnerExploreBinding,
  resolveClubOwnerTrainingContinuation,
  waitForClubOwnerTrainingContinuation,
  type ClubOwnerTrainingCoordinatorEntry,
} from './clubOwnerTrainingCoordinator';
import { saveTrainingSession } from './trainingHistory';

export type ClubOwnerUtilityStatus = Readonly<{
  phase: 'authorizing' | 'ready' | 'activating' | 'active' | 'saving' | 'saved' | 'error';
  sessionId: string;
  playerIds: readonly PlayerSlot['id'][];
  detail: string;
  failureStage?: 'prepare' | 'activate' | 'complete';
}>;

type StatusCallback = (status: ClubOwnerUtilityStatus) => void;

export function createClubOwnerGetPulledRequest(
  clubId: string,
  arm: GetPulledSessionArm,
  claimedStudioRiderIds: ReadonlySet<string>,
): ClubOwnerTrainingAuthorizationRequest | null {
  if (!arm.riderId || !claimedStudioRiderIds.has(arm.riderId)) return null;
  return {
    requestId: `club-get-pulled-${arm.sessionId}`,
    clubId,
    sessionId: arm.sessionId,
    activityType: 'get-pulled',
    armedAt: arm.armedAt,
    assignments: [{
      studioRiderId: arm.riderId,
      bikeDeviceId: arm.deviceId,
      playerId: arm.playerId,
    }],
  };
}

export function createClubOwnerExploreRequest(
  clubId: string,
  arm: ExploreRideSessionArm,
  claimedStudioRiderIds: ReadonlySet<string>,
  accountRiderId: string | null,
): ClubOwnerTrainingAuthorizationRequest | null {
  const assignments = arm.riderBindings.flatMap((rider) => (
    rider.riderId && rider.riderId !== accountRiderId && claimedStudioRiderIds.has(rider.riderId)
      ? [{ studioRiderId: rider.riderId, bikeDeviceId: rider.deviceId, playerId: rider.playerId }]
      : []
  ));
  return assignments.length > 0 ? {
    requestId: `club-explore-${arm.sessionId}`,
    clubId,
    sessionId: arm.sessionId,
    activityType: 'explore',
    armedAt: arm.armedAt,
    assignments,
  } : null;
}

export async function prepareClubOwnerUtilityTraining(input: Readonly<{
  request: ClubOwnerTrainingAuthorizationRequest;
  checkpointScope: string;
  isCurrent: () => boolean;
  onArm: (entry: ClubOwnerTrainingCoordinatorEntry) => void;
  onStatus: StatusCallback;
}>) {
  const playerIds = input.request.assignments.map((assignment) => assignment.playerId);
  input.onStatus({
    phase: 'authorizing',
    sessionId: input.request.sessionId,
    playerIds,
    detail: `Securing ${playerIds.length} rider/bike ${playerIds.length === 1 ? 'assignment' : 'assignments'}.`,
  });
  let entry: ClubOwnerTrainingCoordinatorEntry | null = null;
  try {
    entry = await prepareClubOwnerTrainingGroup({
      request: input.request,
      checkpointScope: input.checkpointScope,
      isCurrent: input.isCurrent,
      onArm: input.onArm,
    });
    if (!entry || !input.isCurrent()) return null;
    input.onStatus({
      phase: 'ready',
      sessionId: input.request.sessionId,
      playerIds,
      detail: 'Riders locked. Connect Apple Watch now or continue without it.',
    });
    if (!await waitForClubOwnerTrainingContinuation(entry) || !input.isCurrent()) return null;
    input.onStatus({
      phase: 'active',
      sessionId: input.request.sessionId,
      playerIds,
      detail: 'Club athlete history is ready.',
    });
    return entry;
  } catch (error) {
    if (input.isCurrent()) {
      input.onStatus({
        phase: 'error',
        failureStage: 'prepare',
        sessionId: input.request.sessionId,
        playerIds,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export async function activateClubOwnerUtilityTraining(input: Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  startedAt: number;
  checkpointScope: string | null;
  isCurrent: () => boolean;
  onStatus: StatusCallback;
}>) {
  const playerIds = input.entry.riders.map((rider) => rider.playerId);
  input.onStatus({
    phase: 'activating',
    sessionId: input.entry.request.sessionId,
    playerIds,
    detail: 'Binding athlete history to the exact session start.',
  });
  try {
    const authorization = await activateAndCheckpointClubOwnerTrainingGroup(
      input.entry,
      input.startedAt,
      input.checkpointScope,
    );
    if (input.isCurrent()) {
      input.onStatus({
        phase: 'active',
        sessionId: input.entry.request.sessionId,
        playerIds,
        detail: 'Club athlete history is recording this exact session window.',
      });
    }
    return authorization;
  } catch (error) {
    if (input.isCurrent()) {
      input.onStatus({
        phase: 'error',
        failureStage: 'activate',
        sessionId: input.entry.request.sessionId,
        playerIds,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export async function resumeClubOwnerExploreTraining(input: Readonly<{
  existing: ClubOwnerTrainingCoordinatorEntry | null;
  binding: ExploreRideStudioBinding;
  sessionId: string;
  clubId: string;
  startedAt: number;
  checkpointScope: string;
}>) {
  const saved = input.binding.authorizationCheckpoint;
  if (!saved) throw new Error('This Explore checkpoint has no recoverable club authorization.');
  const entry = input.existing ?? await recoverClubOwnerExploreBinding(input.binding);
  const current = input.existing ? await checkpointClubOwnerTrainingGroup(entry) : saved;
  const referencesByPlayer = new Map(input.binding.riders.flatMap((rider) => (
    rider.authorizationId ? [[rider.playerId, rider.authorizationId] as const] : []
  )));
  const matches = entry.request.sessionId === input.sessionId
    && entry.request.clubId === input.clubId
    && entry.request.activityType === 'explore'
    && current.authorization.id === input.binding.authorizationGroupId
    && clubOwnerTrainingGroupMatches(entry, saved.request)
    && current.authorization.assignments.every((assignment) => (
      referencesByPlayer.get(assignment.playerId) === assignment.id
    ));
  if (!matches) {
    if (!input.existing) await cancelClubOwnerTrainingGroup(entry, { keepalive: true });
    throw new Error('The restored Explore authorization does not match this club or ride.');
  }
  await activateAndCheckpointClubOwnerTrainingGroup(entry, input.startedAt, input.checkpointScope);
  return entry;
}

export function continueClubOwnerUtilityTraining(
  entry: ClubOwnerTrainingCoordinatorEntry,
  accepted: boolean,
) {
  return resolveClubOwnerTrainingContinuation(entry, accepted);
}

export async function completeClubOwnerUtilityTraining(input: Readonly<{
  entry: ClubOwnerTrainingCoordinatorEntry;
  result: GetPulledResult | ExploreRideCompleteEvent;
  checkpointScope: string | null;
  isCurrent: () => boolean;
  onCheckpointCleared: () => void;
  onHistoryChanged: () => void;
  onStatus: StatusCallback;
}>) {
  const { entry } = input;
  const playerIds = entry.riders.map((rider) => rider.playerId);
  input.onStatus({
    phase: 'saving',
    sessionId: entry.request.sessionId,
    playerIds,
    detail: `Atomically saving ${playerIds.length} exact athlete ${playerIds.length === 1 ? 'window' : 'windows'}.`,
  });
  try {
    const saved = entry.request.activityType === 'get-pulled'
      ? await completeClubOwnerGetPulledResult(entry, input.result as GetPulledResult)
      : await completeClubOwnerExploreRide(entry, input.result as ExploreRideCompleteEvent);
    if (!input.isCurrent()) return saved;
    if (input.checkpointScope) clearClubOwnerTrainingCheckpoint(input.checkpointScope);
    input.onCheckpointCleared();
    input.onHistoryChanged();
    input.onStatus({
      phase: 'saved',
      sessionId: entry.request.sessionId,
      playerIds,
      detail: `${saved.sessions.length} athlete ${saved.sessions.length === 1 ? 'result' : 'results'} saved${saved.replayed ? ' (confirmed replay)' : ''}.`,
    });
    return saved;
  } catch (error) {
    if (input.isCurrent()) {
      input.onStatus({
        phase: 'error',
        failureStage: 'complete',
        sessionId: entry.request.sessionId,
        playerIds,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export function saveLegacyGetPulledHistory(
  result: GetPulledResult,
  clubTrainingSelection: ClubTrainingSelection | null,
) {
  return saveTrainingSession({
    id: result.id,
    activityType: 'get-pulled',
    title: `${result.durationSeconds}s Get Pulled · Air ${result.airSetting}`,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: Math.max(0, result.endedAt - result.startedAt),
    distanceMeters: result.distanceMeters,
    trackId: 'preski-ranch-pull-lane',
    trackName: 'Preski Ranch Pull Lane',
    details: {
      durationSeconds: result.durationSeconds,
      airSetting: result.airSetting,
      recordKey: `${result.durationSeconds}s-air-${result.airSetting}`,
      riders: [{
        playerId: result.playerId,
        ...(result.riderId ? { riderId: result.riderId } : {}),
        name: result.riderName,
        distanceMeters: result.distanceMeters,
        averageWatts: result.averageWatts,
        peakWatts: result.peakWatts,
        averageCadence: result.averageCadence,
        peakCadence: result.peakCadence,
        averageSpeedKph: result.averageSpeedKph,
        peakSpeedKph: result.peakSpeedKph,
      }],
    },
  }, clubTrainingSelection, { localPlayerId: result.playerId });
}

export function saveLegacyExploreHistory(input: Readonly<{
  result: ExploreRideCompleteEvent;
  riders: ExploreRideCompleteEvent['riders'];
  clubTrainingSelection: ClubTrainingSelection | null;
  localPlayerId: PlayerSlot['id'] | null;
}>) {
  const { result, riders } = input;
  const durationHours = Math.max(1, result.durationMs) / 3_600_000;
  return saveTrainingSession({
    id: result.sessionId,
    activityType: 'explore',
    title: result.route.name || `${result.route.originLabel} to ${result.route.destinationLabel}`,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    distanceMeters: Math.max(0, ...riders.map((rider) => rider.distanceMeters)),
    trackId: result.route.id,
    trackName: result.route.name || result.route.destinationLabel,
    details: {
      originLabel: result.route.originLabel,
      destinationLabel: result.route.destinationLabel,
      travelMode: result.route.travelMode,
      elevationGainMeters: result.route.elevationGainMeters ?? 0,
      elevationLossMeters: result.route.elevationLossMeters ?? 0,
      activeClockSegments: result.activeClockSegments,
      riders: riders.map((rider) => ({
        playerId: rider.playerId,
        ...(rider.riderId ? { riderId: rider.riderId } : {}),
        name: rider.name,
        ...(rider.photoUrl ? { photoUrl: rider.photoUrl } : {}),
        distanceMeters: rider.distanceMeters,
        averageSpeedMph: (rider.distanceMeters / 1609.344) / durationHours,
      })),
    },
  }, input.clubTrainingSelection, { localPlayerId: input.localPlayerId });
}
