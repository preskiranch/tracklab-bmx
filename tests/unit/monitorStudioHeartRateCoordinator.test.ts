import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  activeMonitorHeartRateBlock,
  activeMonitorHeartRateInvitation,
  clubMonitorSavedStatus,
  nativeHeartRateWorkoutBelongsToAccount,
  personalMonitorSavedStatus,
  queueClubMonitorBikeOperation,
} from '../../src/App';
import { StudioHeartRateBlockCard } from '../../src/components/StudioHeartRateBlockCard';
import type {
  HeartRateStudioBlockStatus,
  HeartRateStudioInvitation,
} from '../../src/lib/heartRateCloud';

const invitation = (overrides: Partial<HeartRateStudioInvitation> = {}): HeartRateStudioInvitation => ({
  id: 'invite-one',
  clubId: 'club-one',
  studioRiderId: 'rider-one',
  sessionId: 'monitor-sprint:anchor',
  activityType: 'monitor-sprint',
  relayScope: 'studio-block',
  playerId: 1,
  expiresAt: 20_000,
  claimedAt: null,
  revokedAt: null,
  createdAt: 1_000,
  ...overrides,
});

const block = (overrides: Partial<HeartRateStudioBlockStatus> = {}): HeartRateStudioBlockStatus => ({
  invitationId: 'invite-one',
  clubId: 'club-one',
  studioRiderId: 'rider-one',
  anchorSessionId: 'monitor-sprint:anchor',
  activityType: 'monitor-sprint',
  relayScope: 'studio-block',
  playerId: 1,
  state: 'waiting-athlete',
  invitationExpiresAt: 20_000,
  pairCodeExpiresAt: null,
  blockExpiresAt: null,
  streamStartedAt: null,
  lastSampleAt: null,
  lastSampleReceivedAt: null,
  freshUntil: null,
  ...overrides,
});

describe('Monitor studio heart-rate coordinator', () => {
  it('serializes reserve, activate, cancel, and replacement work per exact Wattbike', async () => {
    const chains = new Map<number, Promise<void>>();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

    const first = queueClubMonitorBikeOperation(chains, 101, async () => {
      events.push('first-start');
      markFirstStarted();
      await firstGate;
      events.push('first-end');
    });
    const second = queueClubMonitorBikeOperation(chains, 101, async () => {
      events.push('second');
    });
    await firstStarted;
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });

  it('continues the per-bike queue after a rejected operation', async () => {
    const chains = new Map<number, Promise<void>>();
    const failed = queueClubMonitorBikeOperation(chains, 101, async () => {
      throw new Error('reserve failed');
    });
    const recovered = queueClubMonitorBikeOperation(chains, 101, async () => 'replacement reserved');

    await expect(failed).rejects.toThrow('reserve failed');
    await expect(recovered).resolves.toBe('replacement reserved');
  });

  it('selects only a live, owner-matched continuous Monitor invitation and block', () => {
    expect(activeMonitorHeartRateInvitation([
      invitation({ id: 'wrong-club', clubId: 'club-two' }),
      invitation({ id: 'expired', expiresAt: 9_999 }),
      invitation({ id: 'active', createdAt: 3_000 }),
    ], 'club-one', 'rider-one', 10_000)?.id).toBe('active');

    expect(activeMonitorHeartRateBlock([
      block({ invitationId: 'ended', state: 'ended' }),
      block({ invitationId: 'ready', state: 'watch-ready', freshUntil: 30_000 }),
    ], 'club-one', 'rider-one')?.invitationId).toBe('ready');
    expect(activeMonitorHeartRateBlock([
      block({ state: 'stopped' }),
      block({ state: 'expired' }),
    ], 'club-one', 'rider-one')).toBeNull();
    expect(activeMonitorHeartRateInvitation([
      invitation({ id: 'already-claimed', claimedAt: 12_000, expiresAt: 20_000 }),
    ], 'club-one', 'rider-one', 13_000)).toBeNull();
  });

  it('binds native live heart rate to the exact signed-in account or its known studio pairing', () => {
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-block:rider-one:random', 'rider-one', new Set(),
    )).toBe(true);
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-block:rider-one:random', 'rider-two', new Set(),
    )).toBe(false);
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-studio-block:pair-one', 'rider-one', new Set(['pair-one']),
    )).toBe(true);
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-studio-block:pair-other', 'rider-one', new Set(['pair-one']),
    )).toBe(false);
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-connect:pair-one-extra', 'rider-one', new Set(['pair-one']),
    )).toBe(false);
    expect(nativeHeartRateWorkoutBelongsToAccount(
      'watch-connect:', 'rider-one', new Set(['']),
    )).toBe(false);

  });

  it('keeps session persistence distinct from Watch heart-rate sync state', () => {
    expect(personalMonitorSavedStatus('queued')).toMatchObject({
      state: 'saved', label: 'Session saved · HR syncing',
    });
    expect(personalMonitorSavedStatus('not-recording')).toMatchObject({
      state: 'saved', label: 'Session saved · No Watch HR',
    });
    expect(clubMonitorSavedStatus('pending')).toMatchObject({
      state: 'saved', label: 'Athlete saved · HR syncing',
    });
    expect(clubMonitorSavedStatus('unknown')).toMatchObject({
      state: 'saved', label: 'Athlete saved · HR unconfirmed',
    });
  });

  it('distinguishes athlete acceptance from a fresh Watch sample and explains safe owner stop', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockCard, {
      riderName: 'Mason Fleming',
      state: { phase: 'waiting-watch' },
      onCancel: () => undefined,
    }));

    expect(markup).toContain('Waiting for Apple Watch');
    expect(markup).toContain('Stop studio sharing');
    expect(markup).toContain('does not stop the athlete’s Apple Watch workout');
    expect(markup).not.toContain('Disconnect Watch');
  });
});
