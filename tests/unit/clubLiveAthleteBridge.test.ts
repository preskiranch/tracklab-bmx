import { describe, expect, it } from 'vitest';
import {
  advanceClubLiveRacePreviewSession,
  buildClubLiveSnapshot,
  clubLiveScreenFrameMatchesVisibleActivity,
  type ClubLiveActivityState,
} from '../../src/components/ClubLiveAthleteBridge';

const selection = { clubId: 'club-1', studioRiderId: 'rider-1' };
const now = 1_788_179_696_789;

function snapshot(activity: ClubLiveActivityState) {
  return buildClubLiveSnapshot({
    accessActive: true,
    activity,
    demoMode: false,
    selection,
    tabletSessionActive: true,
  });
}

describe('Club Live athlete review lifecycle', () => {
  it('never publishes a native frame while a non-activity screen is visible', () => {
    const liveSnapshot = {
      clubId: selection.clubId,
      studioRiderId: selection.studioRiderId,
      sessionId: 'activity-session-1',
    } as ReturnType<typeof buildClubLiveSnapshot>;

    expect(clubLiveScreenFrameMatchesVisibleActivity(true, liveSnapshot, selection)).toBe(true);
    expect(clubLiveScreenFrameMatchesVisibleActivity(false, liveSnapshot, selection)).toBe(false);
    expect(clubLiveScreenFrameMatchesVisibleActivity(
      true,
      liveSnapshot,
      selection,
      'different-session',
    )).toBe(false);
  });

  it('regenerates a unique race preview ID when the same athlete re-enters the same track', () => {
    const first = advanceClubLiveRacePreviewSession(null, {
      key: 'club:rider:race:track:player:bike',
      captureCurrent: false,
    }, () => 'first-visit');
    const leftActivity = advanceClubLiveRacePreviewSession(first, {
      key: '',
      captureCurrent: false,
    }, () => 'unused');
    const second = advanceClubLiveRacePreviewSession(leftActivity, {
      key: 'club:rider:race:track:player:bike',
      captureCurrent: false,
    }, () => 'second-visit');
    const capturing = advanceClubLiveRacePreviewSession(second, {
      key: 'club:rider:race:track:player:bike',
      captureCurrent: true,
    }, () => 'unused');
    const afterFinishedReset = advanceClubLiveRacePreviewSession(capturing, {
      key: 'club:rider:race:track:player:bike',
      captureCurrent: false,
    }, () => 'after-finished-reset');

    expect(first?.sessionId).toBe('club-live-preview:first-visit');
    expect(leftActivity).toBeNull();
    expect(second?.sessionId).toBe('club-live-preview:second-visit');
    expect(second?.sessionId).not.toBe(first?.sessionId);
    expect(capturing?.sessionId).toBe(second?.sessionId);
    expect(afterFinishedReset?.sessionId).toBe('club-live-preview:after-finished-reset');
  });

  it('uses the per-entry preview ID before a race is armed', () => {
    const readyRace = {
      accountRiderId: 'account-rider-1',
      appMode: 'race',
      explore: null,
      getPulled: null,
      multiplayerActive: false,
      multiplayerParticipantCount: null,
      now,
      race: {
        capture: null,
        courseLengthMeters: 350,
        players: [{ id: 1, riderId: 'account-rider-1', deviceId: 701 }],
        riders: [{
          playerId: 1,
          distance: 0,
          velocity: 0,
          lastWatts: 0,
          lastRawCadence: 0,
          rank: 1,
        }],
        samplesByDevice: new Map([[701, {
          at: now,
          watts: 0,
          cadence: 0,
          cadenceAt: now,
        }]]),
        startGateActive: false,
        state: 'ready',
        trackId: 'track-1',
        trackName: 'Chula Vista',
      },
    } as unknown as ClubLiveActivityState;

    const build = (racePreviewSessionId: string) => buildClubLiveSnapshot({
      accessActive: true,
      activity: readyRace,
      demoMode: false,
      racePreviewSessionId,
      selection,
      tabletSessionActive: true,
    });
    expect(build('club-live-preview:first-visit')?.sessionId)
      .toBe('club-live-preview:first-visit');
    expect(build('club-live-preview:second-visit')?.sessionId)
      .toBe('club-live-preview:second-visit');
  });

  it('preserves the unique arm ID across repeated Get Pulled attempts with the same settings', () => {
    const getPulledAttempt = (sessionId: string) => ({
      accountRiderId: 'account-rider-1',
      appMode: 'get-pulled',
      explore: null,
      getPulled: {
        sessionId,
        phase: 'active',
        playerId: 1,
        riderId: 'account-rider-1',
        riderName: 'Rider One',
        durationSeconds: 6,
        airSetting: 1,
        elapsedMs: 2_000,
        distanceMeters: 18,
        metrics: { live: true, watts: 700, cadence: 105, speedKph: 31 },
        result: null,
      },
      multiplayerActive: false,
      multiplayerParticipantCount: null,
      now,
      race: {},
    } as unknown as ClubLiveActivityState);

    const first = snapshot(getPulledAttempt('get-pulled:first-attempt'));
    const second = snapshot(getPulledAttempt('get-pulled:second-attempt'));

    expect(first).toMatchObject({
      sessionId: 'get-pulled:first-attempt',
      activityType: 'get-pulled',
    });
    expect(second).toMatchObject({
      sessionId: 'get-pulled:second-attempt',
      activityType: 'get-pulled',
    });
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });

  it('keeps a finished race or straight sprint visible until the activity is exited', () => {
    const finishedRace = {
      accountRiderId: 'account-rider-1',
      appMode: 'straight-sprint',
      explore: null,
      getPulled: null,
      multiplayerActive: false,
      multiplayerParticipantCount: null,
      now,
      race: {
        capture: {
          status: 'finished',
          sessionId: 'straight-sprint-session-1',
          startedAt: now - 8_000,
          endedAt: now - 2_000,
        },
        courseLengthMeters: 100,
        players: [{ id: 1, riderId: 'account-rider-1', deviceId: 701 }],
        riders: [{
          playerId: 1,
          distance: 100,
          velocity: 0,
          lastWatts: 725,
          lastRawCadence: 104,
          rank: 1,
        }],
        samplesByDevice: new Map([[701, {
          watts: 725,
          cadence: 104,
          cadenceAt: now - 60_000,
        }]]),
        startGateActive: false,
        state: 'finished',
        trackName: 'La Salle University',
      },
    } as unknown as ClubLiveActivityState;

    expect(snapshot(finishedRace)).toMatchObject({
      sessionId: 'straight-sprint-session-1',
      activityType: 'straight-sprint',
      status: 'finished',
      metrics: { watts: 725, cadence: 104, elapsedMs: 6_000 },
    });
    expect(snapshot({ ...finishedRace, appMode: 'profile' })).toBeNull();
  });

  it('keeps a finished Explore review visible with its frozen final rider metrics', () => {
    const finishedExplore = {
      accountRiderId: 'account-rider-1',
      appMode: 'explore',
      explore: {
        sessionId: 'explore:attempt-a',
        status: 'finished',
        route: {
          id: 'route-1',
          name: 'Coastal route',
          destinationLabel: 'Malibu',
          distanceMeters: 10_000,
        },
        riders: [{
          id: 'explore-rider-1',
          riderId: 'account-rider-1',
          distanceMeters: 10_000,
          velocityMps: 0,
          cadence: 88,
          watts: 310,
          signal: 0,
          at: now - 60_000,
        }],
        elapsedMs: 1_800_000,
      },
      getPulled: null,
      multiplayerActive: false,
      multiplayerParticipantCount: null,
      now,
      race: {},
    } as unknown as ClubLiveActivityState;

    expect(snapshot(finishedExplore)).toMatchObject({
      sessionId: 'explore:attempt-a',
      activityType: 'explore',
      status: 'finished',
      progress: { fraction: 1, distanceMeters: 10_000 },
      metrics: { watts: 310, cadence: 88 },
    });
    expect(snapshot({ ...finishedExplore, appMode: 'profile' })).toBeNull();
  });

  it('uses the supplied per-attempt Explore session ID for repeated rides of one route', () => {
    const exploreActivity = {
      accountRiderId: 'account-rider-1',
      appMode: 'explore',
      explore: {
        sessionId: 'explore:same-route-attempt-a',
        status: 'riding',
        route: {
          id: 'route-1',
          name: 'Coastal route',
          destinationLabel: 'Malibu',
          distanceMeters: 10_000,
        },
        riders: [{
          id: 'explore-rider-1',
          riderId: 'account-rider-1',
          distanceMeters: 1_000,
          velocityMps: 8,
          cadence: 88,
          watts: 310,
          signal: 1,
          at: now,
        }],
        elapsedMs: 120_000,
      },
      getPulled: null,
      multiplayerActive: false,
      multiplayerParticipantCount: null,
      now,
      race: {},
    } as unknown as ClubLiveActivityState;

    expect(snapshot(exploreActivity)?.sessionId).toBe('explore:same-route-attempt-a');
    expect(snapshot({
      ...exploreActivity,
      explore: {
        ...exploreActivity.explore,
        sessionId: 'explore:same-route-attempt-b',
      },
    })?.sessionId).toBe('explore:same-route-attempt-b');
    expect(snapshot({
      ...exploreActivity,
      explore: {
        ...exploreActivity.explore,
        sessionId: null,
      },
    })).toBeNull();
  });
});
