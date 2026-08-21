import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStudioWatchConnectList,
  replaceOwnerStudioWatchConnectAthlete,
  runOwnerStudioWatchDisconnect,
} from '../../src/components/OwnerStudioWatchConnectSettings';
import type { WatchConnectStudioProjection } from '../../src/lib/watchConnectCloud';

const studio = { clubId: 'club-one', clubName: 'Preski Studio' };
const athlete: WatchConnectStudioProjection = {
  clubId: studio.clubId,
  studioRiderId: 'rider-one',
  riderName: 'Athlete One',
  state: 'connected',
  enrollment: {
    id: 'enrollment-one',
    scope: 'studio',
    clubId: studio.clubId,
    studioRiderId: 'rider-one',
    state: 'trusted',
    liveStudioConsent: false,
    sessionStudioConsent: true,
    createdAt: 10,
    updatedAt: 10,
  },
  connection: {
    id: 'connection-one',
    enrollmentId: 'enrollment-one',
    scope: 'studio',
    clubId: studio.clubId,
    studioRiderId: 'rider-one',
    state: 'connected',
    connectedAt: 10,
    connectedUntil: 14_400_010,
    remainingMs: 13_320_000,
    liveStudioConsent: false,
    sessionStudioConsent: true,
  },
};
const disconnected: WatchConnectStudioProjection = {
  ...athlete,
  state: 'not-set-up',
  enrollment: { ...athlete.enrollment!, state: 'revoked', sessionStudioConsent: false },
  connection: {
    ...athlete.connection!,
    state: 'revoked',
    remainingMs: 0,
    sessionStudioConsent: false,
  },
};

describe('owner studio Watch Connect settings', () => {
  it('keeps studio Watch management visible in regular Settings', () => {
    const markup = renderToStaticMarkup(createElement(OwnerStudioWatchConnectList, {
      studio,
      athletes: [athlete],
      busyRiderId: null,
      error: '',
      onDisconnect: vi.fn(),
    }));
    expect(markup).toContain('Preski Studio Watch Connect');
    expect(markup).toContain('Studio athletes');
    expect(markup).toContain('Athlete One');
    expect(markup).toContain('Disconnect Watch');
    expect(markup).toContain('does not remove the athlete');
  });

  it('uses the exact club and enrollment, then replaces the safe row immediately', async () => {
    const action = vi.fn(async () => disconnected);
    await expect(runOwnerStudioWatchDisconnect(studio, athlete, action)).resolves.toBe(disconnected);
    expect(action).toHaveBeenCalledWith('club-one', 'enrollment-one');
    expect(replaceOwnerStudioWatchConnectAthlete([athlete], disconnected)).toEqual([]);
  });

  it('surfaces disconnect errors and rejects a mismatched studio before the request', async () => {
    const failure = vi.fn(async () => { throw new Error('Could not disconnect Watch.'); });
    await expect(runOwnerStudioWatchDisconnect(studio, athlete, failure))
      .rejects.toThrow('Could not disconnect Watch.');
    const action = vi.fn(async () => disconnected);
    await expect(runOwnerStudioWatchDisconnect({ ...studio, clubId: 'other-club' }, athlete, action))
      .rejects.toThrow('no longer available');
    expect(action).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(createElement(OwnerStudioWatchConnectList, {
      studio,
      athletes: [athlete],
      busyRiderId: null,
      error: 'Could not disconnect Watch.',
      onDisconnect: vi.fn(),
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Could not disconnect Watch.');
  });
});
