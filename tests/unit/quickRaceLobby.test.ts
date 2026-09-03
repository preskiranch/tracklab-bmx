import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import QuickRaceLobby, {
  canStartQuickRace,
  displayQuickRaceCode,
  normalizeQuickRaceCode,
  quickRaceLobbySeats,
  type QuickRaceLobbyProps,
} from '../../src/components/QuickRaceLobby';
import { normalizeMultiplayerRoomId } from '../../src/hooks/useMultiplayer';
import type { MultiplayerMatchmakingState, MultiplayerRoom } from '../../src/types';

const idleMatchmaking: MultiplayerMatchmakingState = {
  active: false,
  scope: null,
  activityType: null,
  queuedAt: null,
  queuedRacers: 0,
  message: '',
};

function roomFixture(overrides: Partial<MultiplayerRoom> = {}): MultiplayerRoom {
  const track = { id: 'north-bay', name: 'North Bay BMX', country: 'US', state: 'CA' };
  return {
    id: 'ROOM-AB12CD',
    hostId: 'rider-1',
    private: true,
    purpose: 'race',
    track,
    setup: {
      version: 1,
      revision: 2,
      configurationId: 'north-bay:pro:first-straight',
      configuration: {
        activityType: 'bmx-race',
        trackId: track.id,
        trackName: track.name,
        raceView: { mode: '3d' },
        lapCount: 1,
        routeVariantId: 'pro',
      },
    },
    roundNumber: 1,
    readyMemberIds: ['rider-1', 'rider-2'],
    flow: {
      phase: 'lobby',
      candidates: [],
      votes: {},
      routeChoices: {},
      deadlineAt: null,
      selectedTrackId: track.id,
      raceToken: null,
      raceStartAt: null,
    },
    createdAt: 1,
    members: [
      {
        id: 'rider-1',
        name: 'Rasheen',
        available: true,
        membershipTier: 'racer',
        bikeCount: 1,
        racerSeatCount: 1,
        track,
        roomId: 'ROOM-AB12CD',
        roomRole: 'racer',
        ready: true,
        lastSeen: 1,
      },
      {
        id: 'rider-2',
        name: 'Mason',
        available: true,
        membershipTier: 'racer',
        bikeCount: 1,
        racerSeatCount: 1,
        track,
        roomId: 'ROOM-AB12CD',
        roomRole: 'racer',
        ready: true,
        lastSeen: 1,
      },
    ],
    memberCount: 2,
    racerCount: 2,
    racerSeatCount: 2,
    racerSeatCapacity: 4,
    ...overrides,
  };
}

function props(overrides: Partial<QuickRaceLobbyProps> = {}): QuickRaceLobbyProps {
  return {
    room: null,
    localRiderId: 'rider-1',
    isAuthenticatedClubTablet: true,
    setupLabel: 'North Bay BMX · Pro Track · 1 lap · 3D Terrain',
    matchmaking: idleMatchmaking,
    onQuickMatch: vi.fn(),
    onCancelMatchmaking: vi.fn(),
    onStartStudioMatch: vi.fn(),
    onCreatePrivate: vi.fn(),
    onJoinCode: vi.fn(),
    onReady: vi.fn(),
    onStart: vi.fn(),
    onRaceAgain: vi.fn(),
    onChangeSetup: vi.fn(),
    onConfirmSetup: vi.fn(),
    onRouteChoice: vi.fn(),
    onLeave: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  };
}

describe('QuickRaceLobby', () => {
  it('normalizes short private race codes without leaking the room prefix', () => {
    expect(normalizeQuickRaceCode(' ab-12_cd ')).toBe('AB12CD');
    expect(displayQuickRaceCode('ROOM-AB12CD')).toBe('AB12CD');
    expect(normalizeMultiplayerRoomId(' ab12cd ')).toBe('ROOM-AB12CD');
    expect(normalizeMultiplayerRoomId('room-ab12cd')).toBe('ROOM-AB12CD');
  });

  it('offers studio, worldwide, private, and code entry without social clutter', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props()));

    expect(markup).toContain('Race Together');
    expect(markup).toContain('Race at this studio');
    expect(markup).toContain('Quick Match worldwide');
    expect(markup).toContain('Create private race');
    expect(markup).toContain('Have a race code?');
    expect(markup).toContain('North Bay BMX · Pro Track · 1 lap · 3D Terrain');
    expect(markup).not.toMatch(/chat|voice|vote|live rooms/iu);
  });

  it('does not offer same-studio matching to an ordinary signed-in device', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      isAuthenticatedClubTablet: false,
    })));
    expect(markup).not.toContain('Race at this studio');
    expect(markup).toContain('Quick Match worldwide');
  });

  it('keeps local training simple with one prominent multiplayer entry action', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      localEntry: true,
    })));
    expect(markup).toContain('Race Together (2–4)');
    expect(markup).toContain('solo training stays available');
    expect(markup).not.toContain('Create private race');
    expect(markup).not.toMatch(/chat|voice|vote|live rooms/iu);
  });

  it('lets a 2–3 tablet studio queue explicitly start without fragmenting the club', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      matchmaking: {
        active: true,
        scope: 'studio',
        activityType: 'bmx-race',
        queuedAt: 1,
        queuedRacers: 3,
        message: '3/4 studio racers connected.',
      },
    })));
    expect(markup).toContain('Start with 3 racers');
    expect(markup).toContain('Cancel search');
  });

  it('represents all four seats and starts only with 2–4 seats and every client ready', () => {
    const room = roomFixture();
    expect(quickRaceLobbySeats(room)).toHaveLength(2);
    expect(canStartQuickRace(room)).toBe(true);

    const oneRider = roomFixture({
      readyMemberIds: ['rider-1'],
      members: [room.members[0]],
      memberCount: 1,
      racerCount: 1,
      racerSeatCount: 1,
    });
    expect(canStartQuickRace(oneRider)).toBe(false);

    const waitingRider = roomFixture({ readyMemberIds: ['rider-1'] });
    waitingRider.members[1] = { ...waitingRider.members[1], ready: false };
    expect(canStartQuickRace(waitingRider)).toBe(false);

    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({ room })));
    expect(markup).toContain('2 of 4 seats');
    expect(markup).toContain('Rasheen');
    expect(markup).toContain('Mason');
    expect(markup.match(/Open seat/g)).toHaveLength(2);
    expect(markup).toContain('Start together');
  });

  it('auto-starts matched rooms after everyone is Ready without showing a second host start', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room: roomFixture({ matchmakingScope: 'studio' }),
    })));
    expect(markup).toContain('Starts automatically when every racer is Ready.');
    expect(markup).not.toContain('Start together');
  });

  it('shows the locked whole route so every Race Intervals rider sees the same setup', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({ room: roomFixture() })));
    expect(markup).toContain('Same on every screen');
    expect(markup).toContain('North Bay BMX');
    expect(markup).toContain('Pro route');
    expect(markup).toContain('1 lap');
    expect(markup).toContain('Setup locked');
  });

  it('explains and blocks race entry when no athlete or mapped course is ready', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      setupLabel: '',
      setupProblem: 'Choose at least one athlete for this race.',
    })));
    expect(markup).toContain('Choose at least one athlete for this race.');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('shows the exact Straight Sprint map, distance, Air setting, and view', () => {
    const room = roomFixture({
      setup: {
        version: 1,
        revision: 3,
        configurationId: 'sprint-drag-strip-145-7',
        configuration: {
          activityType: 'straight-sprint',
          courseId: 'drag-strip',
          courseName: 'Drag Strip Map 2',
          courseSource: 'saved-map',
          raceView: { mode: 'game' },
          distanceFeet: 145,
          airSetting: 7,
        },
      },
    });
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room,
      setupLabel: 'Drag Strip Map 2 · 145 ft · Air 7 · Game Arena',
    })));
    expect(markup).toContain('Straight Sprint');
    expect(markup).toContain('Drag Strip Map 2');
    expect(markup).toContain('145 ft');
    expect(markup).toContain('Air 7');
    expect(markup).toContain('Game Arena');
  });

  it('shows server feedback and blocks Ready/Start until the shared setup is applied locally', () => {
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room: roomFixture(),
      setupReady: false,
      statusMessage: 'Applying the host’s exact setup.',
    })));
    expect(markup).toContain('Applying the host’s exact setup.');
    expect(markup).toContain('This device is still applying the shared setup');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the group together after a round and gives only the host the next-race action', () => {
    const room = roomFixture({
      flow: { ...roomFixture().flow, phase: 'round-complete' },
    });
    const hostMarkup = renderToStaticMarkup(createElement(QuickRaceLobby, props({ room })));
    expect(hostMarkup).toContain('Keep this group together');
    expect(hostMarkup).toContain('Race again');
    expect(hostMarkup).toContain('change the activity/setup');
    expect(hostMarkup).toContain('Change activity/setup');

    const racerMarkup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room,
      localRiderId: 'rider-2',
    })));
    expect(racerMarkup).toContain('Waiting for the host');
    expect(racerMarkup).not.toContain('>Race again<');
    expect(racerMarkup).not.toContain('Change activity/setup');
  });

  it('keeps Ready locked while the host chooses and confirms a new setup', () => {
    const room = roomFixture({
      readyMemberIds: [],
      flow: { ...roomFixture().flow, phase: 'setup-select' },
    });
    const hostMarkup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room,
      setupLabel: 'Straight Sprint · Drag Strip Map 2 · 145 ft · Air 7',
      canConfirmSetup: true,
    })));
    expect(hostMarkup).toContain('Choose the next setup');
    expect(hostMarkup).toContain('Use this setup');
    expect(hostMarkup).not.toContain('I’m ready');
    expect(hostMarkup).not.toContain('Start together');

    const racerMarkup = renderToStaticMarkup(createElement(QuickRaceLobby, props({
      room,
      localRiderId: 'rider-2',
    })));
    expect(racerMarkup).toContain('Waiting for the host’s setup');
    expect(racerMarkup).not.toContain('Use this setup');
    expect(racerMarkup).not.toContain('I’m ready');
  });

  it('offers a per-rider mapped split choice without changing the shared course route', () => {
    const original = roomFixture();
    const configuration = original.setup?.configuration;
    if (!configuration || configuration.activityType !== 'bmx-race') {
      throw new Error('Expected Race Intervals configuration');
    }
    const room = roomFixture({
      setup: {
        ...original.setup!,
        configuration: {
          ...configuration,
          trackRecord: {
            id: 'north-bay',
            name: 'North Bay BMX',
            country: 'United States',
            countryCode: 'US',
            state: 'California',
            region: 'California',
            source: 'Test',
            sourceUrl: 'https://example.test/north-bay',
            lengthMeters: 320,
            elevationMeters: 5,
            surface: 'Dirt',
            outline: [],
            centerline: [{ lat: 38.1, lng: -122.1 }, { lat: 38.101, lng: -122.099 }],
            zones: [],
            leaderboards: { rpm: [], speed: [] },
            splitSections: [{
              id: 'split-1',
              name: 'First split',
              index: 0,
              splitPoint: { lat: 38.1, lng: -122.1 },
              mergePoint: { lat: 38.101, lng: -122.099 },
              branches: [
                {
                  id: 'a',
                  name: 'Amateur Line',
                  points: [{ lat: 38.1, lng: -122.1 }, { lat: 38.101, lng: -122.099 }],
                  lengthMeters: 100,
                },
                {
                  id: 'b',
                  name: 'Pro Set',
                  points: [{ lat: 38.1, lng: -122.1 }, { lat: 38.1005, lng: -122.0995 }, { lat: 38.101, lng: -122.099 }],
                  lengthMeters: 105,
                },
              ],
            }],
          },
        },
      },
      flow: {
        ...original.flow,
        routeChoices: { 'rider-1': 'b' },
      },
    });
    const markup = renderToStaticMarkup(createElement(QuickRaceLobby, props({ room })));
    expect(markup).toContain('Your race line');
    expect(markup).toContain('Amateur Line');
    expect(markup).toContain('Pro Set');
    expect(markup).toContain('aria-pressed="true"');
  });
});
