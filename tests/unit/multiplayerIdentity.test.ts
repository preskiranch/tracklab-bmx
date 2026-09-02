import { describe, expect, it } from 'vitest';
import {
  canonicalizeMultiplayerExploreState,
  canonicalizeMultiplayerRaceState,
  resolveMultiplayerProfile,
  type MultiplayerIdentityOverride,
  type MultiplayerProfile,
} from '../../src/hooks/useMultiplayer';
import { EVERGREEN_RIDER_ACCENT } from '../../src/lib/playerPalette';
import type { MultiplayerExploreState, MultiplayerRaceState } from '../../src/types';

const ownerProfile: MultiplayerProfile = {
  guestKey: 'owner-profile',
  name: 'Studio Owner',
  email: 'owner@example.com',
  available: false,
  membershipTier: 'racer',
};

describe('multiplayer identity scoping', () => {
  it('uses the exact selected Club Tablet athlete without mutating owner identity', () => {
    const athleteOverride: MultiplayerIdentityOverride = {
      scopeKey: 'tablet-session-1',
      guestKey: 'club-tablet:tablet-1:rider-1',
      name: 'Rider One',
      available: true,
      membershipTier: 'racer',
      readOnly: true,
    };

    expect(resolveMultiplayerProfile(ownerProfile, athleteOverride)).toEqual({
      guestKey: 'club-tablet:tablet-1:rider-1',
      name: 'Rider One',
      email: '',
      available: true,
      membershipTier: 'racer',
    });
    expect(ownerProfile).toEqual({
      guestKey: 'owner-profile',
      name: 'Studio Owner',
      email: 'owner@example.com',
      available: false,
      membershipTier: 'racer',
    });
  });

  it('returns the stored owner profile when no kiosk identity scope is active', () => {
    expect(resolveMultiplayerProfile(ownerProfile, null)).toBe(ownerProfile);
  });

  it('keeps a Club Tablet demo identity simulated and device-scoped', () => {
    expect(resolveMultiplayerProfile(ownerProfile, {
      scopeKey: 'club-tablet-demo:tablet-701',
      guestKey: 'demo:tablet-701',
      name: 'Demo · Club tablet · Bike 701',
      available: true,
      membershipTier: 'racer',
      readOnly: true,
    })).toEqual({
      guestKey: 'demo:tablet-701',
      name: 'Demo · Club tablet · Bike 701',
      email: '',
      available: true,
      membershipTier: 'racer',
    });
    expect(ownerProfile.name).toBe('Studio Owner');
  });

  it('canonicalizes legacy lime cards and pins at multiplayer receive boundaries', () => {
    const raceState = canonicalizeMultiplayerRaceState({
      sessionId: 'race-1',
      clientId: 'remote-1',
      riderName: 'Remote rider',
      roomId: 'room-1',
      trackId: 'track-1',
      raceState: 'racing',
      at: 100,
      riders: [{ colorName: 'lime', accent: '#7ade36' }],
      summary: [{ colorName: 'lime', accent: '#b7ff33' }],
    } as MultiplayerRaceState, 200);
    const exploreState = canonicalizeMultiplayerExploreState({
      sessionId: 'explore-1',
      clientId: 'remote-1',
      roomId: 'room-1',
      routeId: 'route-1',
      at: 100,
      riders: [{ colorName: 'lime', accent: '#7ade36' }],
    } as MultiplayerExploreState);

    expect(raceState.riders[0].accent).toBe(EVERGREEN_RIDER_ACCENT);
    expect(raceState.summary[0].accent).toBe(EVERGREEN_RIDER_ACCENT);
    expect(raceState.receivedAt).toBe(200);
    expect(exploreState.riders[0].accent).toBe(EVERGREEN_RIDER_ACCENT);
  });
});
