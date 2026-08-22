import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioWatchConnectStatus } from '../../src/components/StudioWatchConnectStatus';
import {
  clubTabletWatchConnectSelectionState,
  studioWatchConnectSelectionState,
} from '../../src/lib/studioWatchConnectSelection';
import { watchConnectSessionDurationMs } from '../../src/lib/watchConnect';
import type { WatchConnectStudioProjection } from '../../src/lib/watchConnectCloud';

const now = Date.UTC(2026, 7, 21, 8);
const enrollment = {
  id: 'enrollment-1',
  scope: 'studio' as const,
  clubId: 'club-1',
  studioRiderId: 'rider-1',
  state: 'trusted' as const,
  liveStudioConsent: false,
  sessionStudioConsent: true,
  createdAt: now,
  updatedAt: now,
};
const projection: WatchConnectStudioProjection = {
  clubId: 'club-1',
  studioRiderId: 'rider-1',
  riderName: 'Mason Fleming',
  state: 'connected',
  enrollment,
  connection: {
    id: 'connection-1',
    enrollmentId: enrollment.id,
    scope: 'studio',
    clubId: 'club-1',
    studioRiderId: 'rider-1',
    state: 'connected',
    connectedAt: now,
    connectedUntil: now + watchConnectSessionDurationMs,
    remainingMs: watchConnectSessionDurationMs,
    liveStudioConsent: false,
    sessionStudioConsent: true,
  },
};

describe('studio Watch Connect selection', () => {
  it('automatically recognizes the exact selected claimed athlete', () => {
    const state = studioWatchConnectSelectionState({
      clubId: 'club-1',
      studioRiderId: 'rider-1',
      claimed: true,
      projections: [projection],
      now,
    });
    const markup = renderToStaticMarkup(createElement(StudioWatchConnectStatus, {
      athleteName: 'Mason Fleming',
      state,
    }));

    expect(state.phase).toBe('connected');
    expect(markup).toContain('Connected · 4h 0m left');
    expect(markup).toContain('Mason Fleming Watch Connect');
  });

  it('never borrows status from another club, rider, or account', () => {
    for (const selected of [
      { clubId: 'wrong-club', studioRiderId: 'rider-1', claimed: true },
      { clubId: 'club-1', studioRiderId: 'wrong-rider', claimed: true },
    ]) {
      expect(studioWatchConnectSelectionState({
        ...selected,
        projections: [projection],
        now,
      }).phase).toBe('not-set-up');
    }
  });

  it('does not recognize unclaimed names even if display text matches', () => {
    const state = studioWatchConnectSelectionState({
      clubId: 'club-1',
      studioRiderId: 'rider-1',
      claimed: false,
      projections: [projection],
      now,
    });
    expect(state.phase).toBe('unclaimed');
    expect(state.detail).toContain('claim their TrackLab profile');
  });

  it('preserves recognition when the bike disconnects or the tablet slot changes', () => {
    const selection = {
      clubId: 'club-1',
      studioRiderId: 'rider-1',
      claimed: true,
      projections: [projection],
      now,
    };
    const beforeBikeChange = studioWatchConnectSelectionState(selection);
    // No bike or player slot is part of the selection contract.
    const afterBikeChange = studioWatchConnectSelectionState(selection);
    expect(afterBikeChange).toEqual(beforeBikeChange);
    expect(Object.keys(selection)).not.toContain('bikeId');
    expect(Object.keys(selection)).not.toContain('playerId');
  });

  it('renders the kiosk-safe roster snapshot without owner controls or identity fields', () => {
    const state = clubTabletWatchConnectSelectionState({
      claimed: true,
      status: {
        recognized: true,
        state: 'connected',
        connectedUntil: now + watchConnectSessionDurationMs,
        remainingMs: watchConnectSessionDurationMs,
        liveSharingEnabled: true,
      },
      now,
    });
    expect(state.label).toBe('Connected · 4h 0m left');
    expect(state.detail).toContain('every program');
  });

  it('makes an active Watch with private live sharing explicit', () => {
    const state = clubTabletWatchConnectSelectionState({
      claimed: true,
      status: {
        recognized: true,
        state: 'connected',
        connectedUntil: now + watchConnectSessionDurationMs,
        remainingMs: watchConnectSessionDurationMs,
        liveSharingEnabled: false,
      },
      now,
    });
    expect(state.phase).toBe('connected');
    expect(state.label).toBe('Watch connected · live sharing off');
    expect(state.detail).toContain('live BPM stays private');
  });
});
