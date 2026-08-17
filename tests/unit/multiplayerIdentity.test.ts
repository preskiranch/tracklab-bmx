import { describe, expect, it } from 'vitest';
import {
  resolveMultiplayerProfile,
  type MultiplayerIdentityOverride,
  type MultiplayerProfile,
} from '../../src/hooks/useMultiplayer';

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
});
