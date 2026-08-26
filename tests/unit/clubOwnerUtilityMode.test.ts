import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetPulledResult } from '../../src/lib/getPulled';
import type { ClubOwnerTrainingCoordinatorEntry } from '../../src/lib/clubOwnerTrainingCoordinator';
import type { ClubOwnerUtilityModeProps } from '../../src/components/ClubOwnerUtilityMode';

const mocks = vi.hoisted(() => ({
  getPulledProps: null as Record<string, unknown> | null,
  exploreProps: null as Record<string, unknown> | null,
  activate: vi.fn(async () => undefined),
  complete: vi.fn(async () => ({ sessions: [{}], replayed: false })),
  saveLegacyGetPulled: vi.fn(async () => undefined),
  saveLegacyExplore: vi.fn(async () => undefined),
}));

vi.mock('../../src/components/GetPulledView', () => ({
  GetPulledView: (props: Record<string, unknown>) => {
    mocks.getPulledProps = props;
    return null;
  },
}));

vi.mock('../../src/components/ExploreView', () => ({
  ExploreView: (props: Record<string, unknown>) => {
    mocks.exploreProps = props;
    return null;
  },
}));

vi.mock('../../src/components/ClubOwnerTrainingPreparationDialog', () => ({
  ClubOwnerTrainingPreparationDialog: () => null,
}));

vi.mock('../../src/lib/clubOwnerUtilityTrainingActions', () => ({
  activateClubOwnerUtilityTraining: mocks.activate,
  completeClubOwnerUtilityTraining: mocks.complete,
  continueClubOwnerUtilityTraining: vi.fn(),
  createClubOwnerExploreRequest: vi.fn(() => null),
  createClubOwnerGetPulledRequest: vi.fn(() => null),
  prepareClubOwnerUtilityTraining: vi.fn(async () => null),
  resumeClubOwnerExploreTraining: vi.fn(),
  saveLegacyExploreHistory: mocks.saveLegacyExplore,
  saveLegacyGetPulledHistory: mocks.saveLegacyGetPulled,
}));

vi.mock('../../src/lib/clubOwnerTrainingCoordinator', () => ({
  clubOwnerExploreAuthorizationReferences: vi.fn(),
}));

import { ClubOwnerUtilityMode } from '../../src/components/ClubOwnerUtilityMode';

afterEach(() => {
  vi.useRealTimers();
});

function entry(): ClubOwnerTrainingCoordinatorEntry {
  return {
    request: {
      requestId: 'request-get-pulled',
      clubId: 'club-one',
      sessionId: 'pull-one',
      activityType: 'get-pulled',
      armedAt: 1_000,
      assignments: [{ studioRiderId: 'rider-one', bikeDeviceId: '101', playerId: 1 }],
    },
    riders: [{ studioRiderId: 'rider-one', bikeDeviceId: 101, playerId: 1 }],
  };
}

function sharedProps(group: ClubOwnerTrainingCoordinatorEntry | null, tablet = false) {
  const begin = vi.fn(async () => true);
  const finalize = vi.fn(async () => undefined);
  const cancelActiveGroup = vi.fn(async () => undefined);
  const onTabletExerciseReviewStart = vi.fn();
  const onTabletExerciseSaved = vi.fn(async () => undefined);
  const onHistoryChanged = vi.fn();
  const props = {
    owner: {
      authUser: tablet ? null : { id: 'owner', profileKey: 'owner-profile' },
      ownedClub: null,
      clubOwnerActive: false,
      clubTabletSessionActive: tablet,
      clubTabletSession: tablet ? {
        deviceId: 'tablet-one',
        sessionToken: 'tablet-session-token',
        session: {
          clubId: 'club-one',
          clubName: 'Preski Ranch',
          studioRiderId: 'rider-one',
          riderName: 'Rider One',
          bikeDeviceId: 101,
          expiresAt: Date.now() + 60_000,
        },
        heartbeatTtlMs: 60_000,
        pollAfterMs: 15_000,
      } : null,
      clubTrainingSelection: tablet ? { clubId: 'club-one', studioRiderId: 'rider-one' } : null,
      playMode: 'local',
      preparation: { phase: 'idle', sessionId: null, playerIds: [], detail: '' },
      setPreparation: vi.fn(),
      groupRef: { current: group },
      preparePromiseRef: { current: null },
      generationRef: { current: 0 },
      completionStartedRef: { current: new Set<string>() },
      authorizedPlayersRef: { current: new Map() },
      checkpointScopeRef: { current: 'owner-profile' },
      startedAtRef: { current: null },
      completionRef: { current: null },
      cancelActiveGroup,
      onHistoryChanged,
      onTabletExerciseReviewStart,
      onTabletExerciseSaved,
    },
    heartRateContext: {
      heartRate: {
        measurements: [],
        pauseRelay: vi.fn(async () => ({ configured: false })),
        resumeRelay: vi.fn(async () => ({ configured: false })),
      },
      begin,
      finalize,
      clear: vi.fn(),
      relayStartPromisesRef: { current: new Map() },
      cancelledSessionsRef: { current: new Set<string>() },
      activeSessionRef: { current: null },
      accountBlockCoveredSessionIdsRef: { current: new Set<string>() },
      accountBlockCoversSessionsRef: { current: false },
      onMessage: vi.fn(),
    },
    preparationHeartRate: {
      players: [],
      actionsByRider: {},
      blocks: [],
      invitations: [],
      now: 2_000,
      onOpen: vi.fn(),
    },
  };
  return {
    props,
    begin,
    finalize,
    cancelActiveGroup,
    onHistoryChanged,
    onTabletExerciseReviewStart,
    onTabletExerciseSaved,
  };
}

beforeEach(() => {
  mocks.getPulledProps = null;
  mocks.exploreProps = null;
  vi.clearAllMocks();
});

describe('ClubOwnerUtilityMode integration', () => {
  it('lets the existing non-owner Get Pulled path enter countdown without club authorization', async () => {
    const { props } = sharedProps(null);
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'get-pulled',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const onArm = mocks.getPulledProps?.onSessionArm as (value: Record<string, unknown>) => Promise<boolean>;
    await expect(onArm({
      sessionId: 'personal-pull',
      playerId: 1,
      riderId: 'account:owner',
      riderName: 'Owner',
      deviceId: 101,
      armedAt: 1_000,
      durationMs: 6_000,
      airSetting: 5,
    })).resolves.toBe(true);
  });

  it('activates and atomically completes an authorized Get Pulled session without legacy or personal duplicates', async () => {
    const group = entry();
    const { props, finalize } = sharedProps(group);
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'get-pulled',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const onStart = mocks.getPulledProps?.onSessionStart as (value: Record<string, unknown>) => void;
    onStart({
      sessionId: 'pull-one',
      playerId: 1,
      riderId: 'rider-one',
      riderName: 'Rider One',
      deviceId: 101,
      armedAt: 1_000,
      durationMs: 6_000,
      airSetting: 5,
      startedAt: 2_000,
    });
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ entry: group, startedAt: 2_000 }));

    const result: GetPulledResult = {
      id: 'pull-one',
      playerId: 1,
      riderId: 'rider-one',
      riderName: 'Rider One',
      startedAt: 2_000,
      endedAt: 8_000,
      durationSeconds: 6,
      airSetting: 5,
      distanceMeters: 70,
      averageWatts: 650,
      peakWatts: 1_200,
      averageCadence: 150,
      peakCadence: 210,
      averageSpeedKph: 42,
      peakSpeedKph: 58,
    };
    const onComplete = mocks.getPulledProps?.onComplete as (value: GetPulledResult) => void;
    onComplete(result);
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ entry: group, result })));
    expect(finalize).not.toHaveBeenCalled();
    expect(mocks.saveLegacyGetPulled).not.toHaveBeenCalled();
  });

  it('releases a Club Tablet athlete only after Get Pulled history and heart rate finish saving', async () => {
    vi.useFakeTimers();
    let finishHistory: (() => void) | null = null;
    mocks.saveLegacyGetPulled.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishHistory = resolve;
    }));
    const {
      props,
      finalize,
      onTabletExerciseReviewStart,
      onTabletExerciseSaved,
    } = sharedProps(null, true);
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'get-pulled',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const result: GetPulledResult = {
      id: 'tablet-pull',
      playerId: 1,
      riderId: 'rider-one',
      riderName: 'Rider One',
      startedAt: 2_000,
      endedAt: 8_000,
      durationSeconds: 6,
      airSetting: 5,
      distanceMeters: 70,
      averageWatts: 650,
      peakWatts: 1_200,
      averageCadence: 150,
      peakCadence: 210,
      averageSpeedKph: 42,
      peakSpeedKph: 58,
    };
    const onComplete = mocks.getPulledProps?.onComplete as (value: GetPulledResult) => void;
    onComplete(result);

    expect(finalize).toHaveBeenCalledOnce();
    expect(onTabletExerciseReviewStart).toHaveBeenCalledOnce();
    expect(onTabletExerciseSaved).not.toHaveBeenCalled();
    finishHistory?.();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onTabletExerciseSaved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTabletExerciseSaved).toHaveBeenCalledOnce();
  });

  it('refreshes regular account history even when independent heart-rate finalization fails', async () => {
    const { props, finalize, onHistoryChanged, onTabletExerciseSaved } = sharedProps(null);
    finalize.mockRejectedValueOnce(new Error('heart rate unavailable'));
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'get-pulled',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const onComplete = mocks.getPulledProps?.onComplete as (value: GetPulledResult) => void;
    onComplete({
      id: 'personal-pull',
      playerId: 1,
      riderId: 'account:owner',
      riderName: 'Owner',
      startedAt: 2_000,
      endedAt: 8_000,
      durationSeconds: 6,
      airSetting: 5,
      distanceMeters: 70,
      averageWatts: 650,
      peakWatts: 1_200,
      averageCadence: 150,
      peakCadence: 210,
      averageSpeedKph: 42,
      peakSpeedKph: 58,
    });

    await vi.waitFor(() => expect(onHistoryChanged).toHaveBeenCalledOnce());
    expect(onTabletExerciseSaved).not.toHaveBeenCalled();
  });

  it('keeps the Club Tablet athlete selected when a completed Explore ride cannot be saved', async () => {
    mocks.saveLegacyExplore.mockRejectedValueOnce(new Error('offline'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { props, onTabletExerciseSaved } = sharedProps(null, true);
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'explore',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const onComplete = mocks.exploreProps?.onRideComplete as (value: Record<string, unknown>) => void;
    onComplete({
      sessionId: 'tablet-explore',
      route: {
        id: 'route-one',
        origin: { lat: 38.5, lng: -121.5 },
        destination: { lat: 38.6, lng: -121.4 },
        originLabel: 'Studio',
        destinationLabel: 'Finish',
        travelMode: 'bicycle',
        distanceMeters: 1_000,
        durationSeconds: 600,
        encodedPolyline: 'encoded',
        createdAt: 1_000,
      },
      riders: [{
        id: 'explore-rider-one',
        clientId: 'local',
        playerId: 1,
        riderId: 'rider-one',
        name: 'Rider One',
        colorName: 'lime',
        accent: '#7ade36',
        distanceMeters: 1_000,
        velocityMps: 0,
        cadence: 90,
        watts: 400,
        signal: 1,
        finishedAt: 8_000,
        at: 8_000,
      }],
      startedAt: 2_000,
      endedAt: 8_000,
      durationMs: 6_000,
      activeClockSegments: [{ startedAt: 2_000, endedAt: 8_000 }],
    });

    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringContaining('Could not save Explore')));
    expect(onTabletExerciseSaved).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it('fails a legacy Explore restore closed before any ride resumes', async () => {
    const { props } = sharedProps(null);
    renderToStaticMarkup(createElement(ClubOwnerUtilityMode, {
      ...props,
      mode: 'explore',
      viewProps: { demoMode: false },
    } as unknown as ClubOwnerUtilityModeProps));

    const onRestore = mocks.exploreProps?.onRideSessionRestore as (value: Record<string, unknown>) => Promise<void>;
    await expect(onRestore({
      sessionId: 'legacy-explore',
      startedAt: 1_000,
      studioBinding: { authorizationGroupId: 'legacy', riders: [] },
    })).rejects.toThrow('no secure recovery checkpoint');
  });
});
