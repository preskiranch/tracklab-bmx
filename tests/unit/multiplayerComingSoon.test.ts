import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MultiplayerPanel } from '../../src/components/MultiplayerPanel';
import { DiagnosticsPanel } from '../../src/components/DiagnosticsPanel';
import { ExploreView } from '../../src/components/ExploreView';

const noop = vi.fn();

describe('multiplayer availability in activity components', () => {
  it('keeps the local Wattbike roster while removing room, invite and chat actions', () => {
    const markup = renderToStaticMarkup(createElement(MultiplayerPanel, {
      multiplayerAvailable: false,
      playMode: 'multiplayer',
      currentRoom: { id: 'ROOM-RESTORED', hostId: 'rider-1' },
      players: [{ id: 1, name: 'Local Rider', deviceId: 123, accent: '#1d1d1f' }],
      maxPlayers: 4,
      onPlayModeChange: noop,
    } as ComponentProps<typeof MultiplayerPanel>));
    expect(markup).toContain('Coming soon');
    expect(markup).toContain('Continue solo');
    expect(markup).toContain('Local Rider');
    expect(markup).toContain('Wattbike 123');
    expect(markup).not.toMatch(/ROOM-RESTORED|Create private|Copy invite|Send chat message|Enable microphone/);
  });

  it('keeps solo Explore route building available despite a restored multiplayer mode', () => {
    const markup = renderToStaticMarkup(createElement(ExploreView, {
      multiplayerAvailable: false,
      developerMode: false,
      players: [], demoPlayerOptions: [], selectedDemoPlayerIds: [],
      liveRiderProfiles: [], liveRiderAssignments: {}, samplesByDevice: new Map(),
      speedUnit: 'mph', distanceUnit: 'ft', onDistanceUnitChange: noop,
      playMode: 'multiplayer', demoMode: false, demoParticipantEligible: true,
      multiplayerConnection: 'open', multiplayerClockOffsetMs: 0, multiplayerClockMeasuredAt: null,
      currentRoom: { id: 'ROOM-RESTORED', hostId: 'rider-1' }, currentUserId: 'rider-1',
      accountProfileKey: null, cloudRecentRoutesEnabled: true, cloudRecentRoutesAuthoritative: true,
      inviteUrl: 'https://example.test/room', remoteStates: [],
      voiceEnabled: false, voiceSupported: true, voiceStatus: '', voiceRemoteCount: 0,
      onPlayModeChange: noop, onCreatePrivateRoom: () => true, onShareInvite: noop,
      onSyncRoute: () => true, onControlSession: () => true, onSendState: () => true,
      onDemoPlayerSelectionChange: noop, onLiveRiderAssignment: noop,
      onVoiceStart: noop, onVoiceStop: noop, fullscreen: false, onFullscreenChange: noop,
    } as ComponentProps<typeof ExploreView>));
    expect(markup).toContain('Explore the World');
    expect(markup).toContain('Local bikes');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Private room[\s\S]*?Coming soon/);
    expect(markup).toContain('Where should we ride?');
    expect(markup).not.toMatch(/Create private room|Share room link|ROOM-RESTORED|Waiting for the host/);
  });

  it('keeps bike diagnostics and cloud records available without multiplayer actions', () => {
    const markup = renderToStaticMarkup(createElement(DiagnosticsPanel, {
      multiplayerAvailable: false,
      bridgeConnection: 'open', bridgeMode: 'sim', bridgeSourceState: 'running',
      bridgeStatus: 'Connected', bridgeError: null, bridgeControlStatus: null,
      bridgeBusy: false, bridgeRunning: true, bluetoothSupported: true,
      bluetoothStatus: 'Available', bluetoothConnectedCount: 0, googleMapsConfigured: true,
      cloudStatus: 'online', cloudMessage: 'Your saved records are online.', profileKey: 'cloud-profile',
      playMode: 'multiplayer', multiplayerConnection: 'open', multiplayerStatus: 'ROOM-RESTORED',
      currentRoomId: 'ROOM-RESTORED', inviteUrl: 'https://example.test/room', onlineRiderCount: 99,
      track: { id: 'track', name: 'Home BMX', country: 'US', lengthMeters: 300, routeStatus: 'user-mapped', zones: [] },
      hasSavedMapping: true, customRouteCount: 1, catalogTrackCount: 10,
      players: [], samplesByDevice: new Map(), bikeProfiles: [], maxPlayers: 4,
      demoMode: true, demoBikeCount: 1, demoVariableCount: 3, distanceUnit: 'ft', raceCapture: null,
      onStartBridge: noop, onStopBridge: noop, onEnableDemoTest: noop,
      onEnableMultiplayer: noop, onCreatePrivateRoom: noop, onCopyInvite: noop,
      onCopyProfileKey: noop, onOpenRace: noop, onOpenMonitor: noop,
    } as ComponentProps<typeof DiagnosticsPanel>));
    expect(markup).toContain('Coming soon');
    expect(markup).toContain('Enable demo test');
    expect(markup).toContain('Bike readiness');
    expect(markup).toContain('Your saved records are online.');
    expect(markup).toContain('cloud-profile');
    expect(markup).not.toMatch(/Multiplayer online|Create private room|Copy invite|ROOM-RESTORED|riders online/);
  });
});
