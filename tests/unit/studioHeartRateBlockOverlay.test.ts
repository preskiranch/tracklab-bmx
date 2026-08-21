import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudioHeartRateBlockOverlay } from '../../src/components/StudioHeartRateBlockOverlay';
import type { PlayerSlot } from '../../src/types';

const player: PlayerSlot = {
  id: 1,
  name: 'Athlete One',
  deviceId: 101,
  deviceLabel: 'Bike 1',
  riderId: 'rider-one',
  colorName: 'lime',
};

const actions = {
  onClose: vi.fn(),
  onCancel: vi.fn(),
  onCopy: vi.fn(),
  onCreate: vi.fn(),
  onRetry: vi.fn(),
  onShare: vi.fn(),
};

describe('StudioHeartRateBlockOverlay', () => {
  it('derives fresh Watch readiness inside the lazy accessible overlay without rendering secrets', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockOverlay, {
      player,
      action: null,
      anchorContext: {
        appMode: 'race',
        group: {
          request: {
            requestId: 'request-one',
            clubId: 'club-one',
            sessionId: 'session-one',
            activityType: 'bmx-race',
            armedAt: 1_000,
            assignments: [{ studioRiderId: 'rider-one', bikeDeviceId: '101', playerId: 1 }],
          },
          riders: [{ studioRiderId: 'rider-one', bikeDeviceId: 101, playerId: 1 }],
        },
        preparation: { phase: 'ready', sessionId: 'session-one' },
      },
      clubId: 'club-one',
      blocks: [{
        invitationId: 'invite-one',
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        anchorSessionId: 'session-one',
        activityType: 'bmx-race',
        relayScope: 'studio-block',
        playerId: 1,
        state: 'watch-ready',
        invitationExpiresAt: 2_000,
        pairCodeExpiresAt: 3_000,
        blockExpiresAt: 50_000,
        streamStartedAt: 4_000,
        lastSampleAt: 4_100,
        lastSampleReceivedAt: 4_100,
        freshUntil: 4_115,
      }],
      invitations: [],
      invitationSecretAvailable: false,
      now: 4_100,
      ...actions,
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Apple Watch ready');
    expect(markup).toContain('Stop studio sharing');
    expect(markup).not.toContain('Copy iPhone invite');
    expect(markup).not.toContain('completionToken');
  });
});
