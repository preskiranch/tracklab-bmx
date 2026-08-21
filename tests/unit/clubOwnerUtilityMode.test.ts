import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function sharedProps(group: ClubOwnerTrainingCoordinatorEntry | null) {
  const begin = vi.fn(async () => true);
  const finalize = vi.fn(async () => undefined);
  const cancelActiveGroup = vi.fn(async () => undefined);
  const props = {
    owner: {
      authUser: { id: 'owner', profileKey: 'owner-profile' },
      ownedClub: null,
      clubOwnerActive: false,
      clubTabletSessionActive: false,
      clubTabletSession: null,
      clubTrainingSelection: null,
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
      onHistoryChanged: vi.fn(),
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
  return { props, begin, finalize, cancelActiveGroup };
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
