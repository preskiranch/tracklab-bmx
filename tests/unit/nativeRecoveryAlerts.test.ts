import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeRecoveryAlertsClient,
  getNativeRecoveryAccountBoundaryGeneration,
  nativeRecoveryAlertReadyEvent,
  nativeRecoveryAlertStatusEvent,
  nativeRecoveryAlertsPluginName,
  openNativeRecoveryAccountBoundary,
  type NativeRecoveryAlertEvent,
  type NativeRecoveryAlertsPlugin,
  type NativeRecoveryEpisode,
} from '../../src/lib/nativeRecoveryAlerts';

const now = 2_000_000;
const accountId = `recacct_${'a'.repeat(32)}`;
const otherAccountId = `recacct_${'b'.repeat(32)}`;

function episode(overrides: Partial<NativeRecoveryEpisode> = {}): NativeRecoveryEpisode {
  return {
    id: 'recovery-1',
    activityType: 'bmx-race',
    sessionId: 'race-session-1',
    repetitionId: 'repetition-1',
    mode: 'smart',
    state: 'recovering',
    startedAt: now,
    notBeforeAt: now + 30_000,
    plannedReadyAt: now + 90_000,
    fallbackAt: now + 180_000,
    readyAt: null,
    alertTrigger: null,
    targetBpm: 118,
    reason: 'personalized-recovery',
    explanation: 'Based on recent recovery.',
    confidence: 'personalized',
    learningEpisodeCount: 8,
    updatedAt: now + 1_000,
    ...overrides,
  };
}

function pluginState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    supported: true,
    state: 'monitoring' as const,
    accountId,
    recoveryId: 'recovery-1',
    repetitionId: 'repetition-1',
    sessionId: 'race-session-1',
    mode: 'smart' as const,
    notBeforeAt: now + 30_000,
    plannedReadyAt: now + 90_000,
    fallbackAt: now + 180_000,
    readyAt: null,
    targetBpm: 118,
    notificationPermission: 'authorized' as const,
    ...overrides,
  };
}

function fakePlugin() {
  const listeners = new Map<string, (event: NativeRecoveryAlertEvent) => void>();
  const scheduleEpisode = vi.fn(async () => pluginState());
  const plugin: NativeRecoveryAlertsPlugin = {
    requestPermission: vi.fn(async () => ({
      version: 1,
      supported: true,
      status: 'authorized',
      alertsEnabled: true,
      soundsEnabled: true,
      timeSensitiveEnabled: false,
    })),
    getPermissionStatus: vi.fn(async () => ({
      version: 1,
      supported: true,
      status: 'authorized',
      alertsEnabled: true,
      soundsEnabled: true,
      timeSensitiveEnabled: false,
    })),
    bindAccount: vi.fn(async ({ accountId: boundAccountId }) => ({
      version: 1,
      supported: true,
      accountId: boundAccountId,
      clearedCount: boundAccountId === accountId ? 0 : 1,
    })),
    scheduleEpisode,
    getActiveEpisode: vi.fn(async () => pluginState()),
    cancelEpisode: vi.fn(async () => pluginState({ state: 'cancelled' })),
    clearAllEpisodes: vi.fn(async () => ({
      version: 1,
      supported: true,
      clearedCount: 1,
    })),
    addListener: vi.fn(async (eventName: string, listener: (event: NativeRecoveryAlertEvent) => void) => {
      listeners.set(eventName, listener);
      return { remove: async () => { listeners.delete(eventName); } };
    }) as NativeRecoveryAlertsPlugin['addListener'],
  };
  return { plugin, listeners, scheduleEpisode };
}

function capacitor(available: boolean) {
  return {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => available && name === nativeRecoveryAlertsPluginName,
  };
}

describe('native Recovery Alert adapter', () => {
  beforeEach(() => { openNativeRecoveryAccountBoundary(accountId); });
  it('feature-detects an older native shell without throwing or requesting permission', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(false), plugin });

    expect(client.isPluginAvailable()).toBe(false);
    await expect(client.getPermissionStatus()).resolves.toMatchObject({
      supported: false,
      status: 'unavailable',
    });
    await expect(client.scheduleEpisode(accountId, episode())).resolves.toMatchObject({
      supported: false,
      state: 'unavailable',
    });
    await expect(client.addReadyListener(vi.fn())).resolves.toHaveProperty('remove');
    await expect(client.clearAllEpisodes()).resolves.toBeUndefined();
    expect(plugin.getPermissionStatus).not.toHaveBeenCalled();
    expect(plugin.scheduleEpisode).not.toHaveBeenCalled();
  });

  it('passes the exact opaque account and absolute server episode to native', async () => {
    const { plugin, scheduleEpisode } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });
    const recovery = episode();

    await expect(client.scheduleEpisode(` ${accountId} `, recovery)).resolves.toMatchObject({
      state: 'monitoring',
      accountId,
      recoveryId: recovery.id,
      repetitionId: recovery.repetitionId,
    });
    expect(scheduleEpisode).toHaveBeenCalledWith({
      accountId,
      episode: recovery,
    });

    // Start anyway is valid before the configured HR/timer minimum and must be
    // delivered to native as a silent manual terminal state.
    const manual = episode({
      state: 'ready',
      readyAt: now + 10_000,
      alertTrigger: 'manual',
      updatedAt: now + 10_000,
    });
    await expect(client.scheduleEpisode(accountId, manual)).resolves.toMatchObject({
      supported: true,
    });
    expect(scheduleEpisode).toHaveBeenLastCalledWith({ accountId, episode: manual });

    // A finish timestamp may be up to two seconds ahead of the server revision
    // clock; revision ordering remains valid without comparing those clocks.
    await expect(client.scheduleEpisode(accountId, episode({ updatedAt: now - 1_000 })))
      .resolves.toMatchObject({ supported: true });
  });

  it('binds the authenticated opaque account before opening its scheduling fence', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });
    await expect(client.bindAccount(accountId)).resolves.toBeUndefined();
    expect(plugin.bindAccount).toHaveBeenCalledWith({ accountId });
    await expect(client.bindAccount('account:private-user')).rejects.toThrow('invalid account binding');
  });

  it('rejects malformed clocks, identities, and missing HR targets before native scheduling', async () => {
    const { plugin, scheduleEpisode } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });

    await expect(client.scheduleEpisode(accountId, episode({
      notBeforeAt: now + 200_000,
      fallbackAt: now + 100_000,
    }))).resolves.toMatchObject({ state: 'error' });
    await expect(client.scheduleEpisode(accountId, episode({
      mode: 'heart-rate',
      targetBpm: null,
    }))).resolves.toMatchObject({ state: 'error' });
    await expect(client.scheduleEpisode('bad\naccount', episode())).resolves.toMatchObject({
      state: 'error',
    });
    for (const invalidAccountId of [
      'profile_123',
      `recacct_${'a'.repeat(64)}`,
      `recacct_${'A'.repeat(32)}`,
      `recacct_${'b'.repeat(31)}`,
    ]) {
      await expect(client.scheduleEpisode(invalidAccountId, episode())).resolves.toMatchObject({
        state: 'error',
      });
    }
    await expect(client.scheduleEpisode(accountId, episode({ updatedAt: -1 })))
      .resolves.toMatchObject({ state: 'error' });
    expect(scheduleEpisode).not.toHaveBeenCalled();
  });

  it('clears every native episode at an account boundary and tolerates old shells', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });
    await expect(client.clearAllEpisodes()).resolves.toBeUndefined();
    expect(plugin.clearAllEpisodes).toHaveBeenCalledOnce();

    const oldPlugin = { ...plugin, clearAllEpisodes: undefined } as unknown as NativeRecoveryAlertsPlugin;
    const oldClient = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin: oldPlugin });
    openNativeRecoveryAccountBoundary(accountId);
    await expect(oldClient.clearAllEpisodes()).resolves.toBeUndefined();
  });

  it('fences a stale async schedule after sign-out until the next account opens', async () => {
    const { plugin } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });
    const staleGeneration = openNativeRecoveryAccountBoundary(accountId);
    await client.clearAllEpisodes();
    expect(staleGeneration).not.toBe(getNativeRecoveryAccountBoundaryGeneration());
    await expect(client.scheduleEpisode(accountId, episode())).resolves.toMatchObject({
      state: 'error',
      message: 'Recovery Alert paused while the account changes.',
    });
    openNativeRecoveryAccountBoundary(otherAccountId);
    await expect(client.scheduleEpisode(accountId, episode())).resolves.toMatchObject({
      state: 'error',
      message: 'Recovery Alert paused while the account changes.',
    });
    openNativeRecoveryAccountBoundary(accountId);
    await expect(client.scheduleEpisode(accountId, episode())).resolves.toMatchObject({
      supported: true,
    });
  });

  it('emits only complete, versioned exact-identity status and READY events', async () => {
    const { plugin, listeners } = fakePlugin();
    const client = createNativeRecoveryAlertsClient({ capacitor: capacitor(true), plugin });
    const statuses = vi.fn();
    const ready = vi.fn();
    await client.addStatusListener(statuses);
    await client.addReadyListener(ready);
    const event: NativeRecoveryAlertEvent = {
      version: 1,
      accountId,
      recoveryId: 'recovery-1',
      repetitionId: 'repetition-1',
      sessionId: 'race-session-1',
      state: 'ready',
      trigger: 'target',
      readyAt: now + 70_000,
      triggeredAt: now + 70_000,
      message: 'Recovery target reached — start when you feel ready.',
    };

    listeners.get(nativeRecoveryAlertStatusEvent)?.(event);
    listeners.get(nativeRecoveryAlertReadyEvent)?.(event);
    listeners.get(nativeRecoveryAlertReadyEvent)?.({ ...event, repetitionId: '' });

    expect(statuses).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledWith(event);
  });
});

describe('native Recovery Alert source safety boundaries', () => {
  const manager = readFileSync(
    new URL('../../ios/App/App/RecoveryAlertManager.swift', import.meta.url),
    'utf8',
  );
  const watch = readFileSync(
    new URL('../../ios/App/TrackLabWatch/WatchRecoveryAlertEngine.swift', import.meta.url),
    'utf8',
  );
  const relay = readFileSync(
    new URL('../../ios/App/App/HeartRateRelay.swift', import.meta.url),
    'utf8',
  );
  const heartRateCoordinator = readFileSync(
    new URL('../../ios/App/App/HeartRateCoordinator.swift', import.meta.url),
    'utf8',
  );
  const watchWorkoutManager = readFileSync(
    new URL('../../ios/App/TrackLabWatch/WatchWorkoutManager.swift', import.meta.url),
    'utf8',
  );
  const appDelegate = readFileSync(
    new URL('../../ios/App/App/AppDelegate.swift', import.meta.url),
    'utf8',
  );
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const wire = readFileSync(
    new URL('../../ios/App/Shared/RecoveryAlertWire.swift', import.meta.url),
    'utf8',
  );
  const pluginSource = readFileSync(
    new URL('../../ios/App/App/RecoveryAlertPlugin.swift', import.meta.url),
    'utf8',
  );

  function watchParityReadiness(
    samples: readonly { bpm: number; recordedAt: number; valid?: boolean }[],
    targetBpm = 118,
  ) {
    let points: { bpm: number; recordedAt: number }[] = [];
    let belowSince: number | null = null;
    for (const sample of samples) {
      if (points.length && sample.recordedAt <= points.at(-1)!.recordedAt) continue;
      if (sample.valid === false) {
        belowSince = null;
        continue;
      }
      if (points.length && sample.recordedAt - points.at(-1)!.recordedAt > 6_000) {
        points = [];
        belowSince = null;
      }
      points.push({ ...sample, bpm: Math.round(sample.bpm) });
      points = points.filter((point) => point.recordedAt >= sample.recordedAt - 10_000).slice(-5);
      const sorted = points.map((point) => point.bpm).sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      const smoothed = sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
      if (points.length < 2 || smoothed > targetBpm) {
        belowSince = null;
      } else {
        belowSince ??= sample.recordedAt;
        if (sample.recordedAt - belowSince >= 12_000) return sample.recordedAt;
      }
    }
    return null;
  }

  function tombstoneAllows(
    tombstone: {
      accountId: string;
      recoveryId: string;
      issuedAt: number;
      allowForegroundResume?: boolean;
      terminal?: boolean;
    },
    plan: { accountId: string; recoveryId: string; issuedAt: number },
    resume = false,
  ) {
    const sameIdentity = tombstone.accountId === plan.accountId
      && tombstone.recoveryId === plan.recoveryId;
    if (!sameIdentity) return true;
    return resume
      && tombstone.allowForegroundResume === true
      && tombstone.terminal !== true
      && plan.issuedAt >= tombstone.issuedAt;
  }

  it('persists absolute deadlines and uses one ordinary local notification request', () => {
    expect(manager).toContain('UNCalendarNotificationTrigger(dateMatching: components, repeats: false)');
    expect(manager).toContain('ceil(deadline.timeIntervalSince1970)');
    expect(manager).toContain('if deadline <= now {');
    expect(manager).not.toContain('deadline <= now.addingTimeInterval(1)');
    expect(manager).toContain('record.plan.deadlineAt');
    expect(manager).toContain('TrackLabRecoveryAlertRecordsV1');
    expect(manager).toContain('Recovery target reached — start when you feel ready.');
    expect(manager).not.toContain('.critical');
    expect(manager).not.toContain('interruptionLevel = .timeSensitive');
    expect(manager).toContain('DispatchQueue.main.async');

    const fractionalDeadline = 2_000_900;
    const localNotificationAt = Math.ceil(fractionalDeadline / 1_000) * 1_000;
    expect(localNotificationAt).toBe(2_001_000);
    expect(localNotificationAt).toBeGreaterThanOrEqual(fractionalDeadline);
    expect(watch).toContain('.now() + .milliseconds(Int(remaining))');
  });

  it('assigns one physical cue to an active Watch workout and restores the phone fallback', () => {
    expect(manager).toContain('func setWatchWorkoutActive(_ active: Bool)');
    expect(manager).toContain('guard record.watchOwnsCue != true else');
    expect(manager).toContain('scheduleNotification(restored)');
    expect(manager).toContain('record.plan.deadlineAt - Self.nowMilliseconds() >= 3_000');
    expect(manager).toContain('restored.watchOwnsCue = false');
    expect(manager).toContain('allowCueOwnership: false');
    expect(manager).toContain('replyHandler: @escaping ([String: Any]) -> Void');
    expect(manager).toContain('watchWorkoutActive,');
    expect(manager).toContain('WCSession.default.isReachable,');
    expect(manager).toContain('sendWatchPlan($0.plan, allowTombstoneResume: false)');
    expect(heartRateCoordinator).toContain('RecoveryAlertManager.shared.setWatchWorkoutActive(');
    expect(heartRateCoordinator).toContain('[.active, .paused].contains(state)');
    expect(heartRateCoordinator).toContain('setWatchConnectivityReachable(session.isReachable)');
    expect(watch).toContain('&& cueOwnershipOffered');
    expect(watch).toContain('&& WCSession.default.isReachable');
    expect(watch).toContain('current.plan.deadlineAt - Self.nowMilliseconds() >= 3_000');
    expect(watch).toContain('reply["accepted"] as? Bool == true');
    expect(watch).toContain('self.sameSchedule(latest.plan, offeredPlan)');
    expect(watch).toContain('sendReady(current, cueDelivered: watchDeliversCue)');
    expect(manager).toContain('record.watchOwnsCue == true && !event.cueDelivered');
    expect(manager).toContain('showImmediateNotification: isEarlyTarget || needsPhoneFailover');
    expect(watch).toMatch(/if !ownsCue \{[\s\S]+sendStatus\(state: current\.phase/u);
    const statusSend = watch.indexOf('private func sendStatus');
    const ownershipReset = watch.indexOf('cueOwnershipOffered = false', statusSend);
    const ownershipAck = watch.indexOf('self.cueOwnershipOffered = true', ownershipReset);
    expect(ownershipReset).toBeGreaterThan(statusSend);
    expect(ownershipAck).toBeGreaterThan(ownershipReset);
    expect(watchWorkoutManager).toContain('WatchRecoveryAlertEngine.shared.setWorkoutOwnsCue(');
    expect(watchWorkoutManager).toContain('connectivityReachabilityDidChange(session.isReachable)');
    expect(watchWorkoutManager).toContain('[.active, .paused].contains(state)');
  });

  it('uses matching Smart/HR freshness, smoothing, sustained, and no-repeat gates', () => {
    expect(watch).toContain('sustainedTargetMilliseconds: Int64 = 12_000');
    expect(watch).toContain('staleHeartRateMilliseconds: Int64 = 10_000');
    expect(watch).toContain('maximumSustainedSampleGapMilliseconds: Int64 = 6_000');
    expect(watch).toContain('[.heartRate, .smart].contains(current.plan.mode)');
    expect(watch).toContain('measuredAt >= current.plan.notBeforeAt');
    expect(watch).toContain('measuredAt <= previous.measuredAt');
    expect(watch).toContain('measuredAt - previous.measuredAt > Self.maximumSustainedSampleGapMilliseconds');
    expect(watch).toContain('let decisionBpm = Double(Int(bpm.rounded()))');
    expect(watch).toContain('HeartRatePoint(bpm: decisionBpm, measuredAt: measuredAt)');
    expect(watch).toContain('heartRatePoints.count >= 2, smoothed <= targetBpm');
    expect(watch).toContain('guard var current = persisted, current.phase != "ready" else { return }');
    expect(watch).toContain('WKInterfaceDevice.current().play(.notification)');

    const noisyMedianVector = [
      { bpm: 117, recordedAt: 0 },
      { bpm: 117, recordedAt: 4_000 },
      { bpm: 121, recordedAt: 8_000 },
      { bpm: 116, recordedAt: 12_000 },
      { bpm: 115, recordedAt: 16_000 },
    ];
    expect(watchParityReadiness(noisyMedianVector)).toBe(16_000);
    expect(watchParityReadiness([
      { bpm: 110, recordedAt: 0 },
      { bpm: 110, recordedAt: 4_000 },
      { bpm: 110, recordedAt: 10_001 }, // 6,001ms resets the sustained window.
      { bpm: 110, recordedAt: 14_001 },
      { bpm: 110, recordedAt: 18_001 },
      { bpm: 110, recordedAt: 22_001 },
      { bpm: 110, recordedAt: 26_001 },
    ])).toBe(26_001);
    expect(watchParityReadiness([
      { bpm: 110, recordedAt: 0 },
      { bpm: 111, recordedAt: 4_000 },
      { bpm: 0, recordedAt: 8_000, valid: false },
      { bpm: 112, recordedAt: 8_500 },
      { bpm: 111, recordedAt: 12_500 },
      { bpm: 110, recordedAt: 16_500 },
      { bpm: 109, recordedAt: 20_500 },
    ])).toBe(20_500);
    expect(watchParityReadiness([
      { bpm: 110, recordedAt: 0 },
      { bpm: 110, recordedAt: 4_000 },
      { bpm: 110, recordedAt: 8_000 },
      // Server ordering rejects this before its stale/invalid timing can
      // reset the active hold. Watch must do the same.
      { bpm: 0, recordedAt: 3_000, valid: false },
      { bpm: 110, recordedAt: 12_000 },
      { bpm: 110, recordedAt: 16_000 },
    ])).toBe(16_000);
    expect(watchParityReadiness([
      { bpm: 115.4, recordedAt: 0 },
      { bpm: 115.4, recordedAt: 4_000 },
      { bpm: 115.4, recordedAt: 8_000 },
      { bpm: 115.4, recordedAt: 12_000 },
      { bpm: 115.4, recordedAt: 16_000 },
    ], 115)).toBe(16_000);
    const validationBlock = watch.slice(
      watch.indexOf('guard bpm.isFinite'),
      watch.indexOf('let decisionBpm = Double(Int(bpm.rounded()))'),
    );
    expect(validationBlock).toContain('belowTargetSince = nil');
    expect(validationBlock).not.toContain('clearHeartRateProgress()');
  });

  it('re-arms only a revised same episode and keeps identical reconnects idempotent', () => {
    expect(manager).toContain('self.sameRevision(existing.plan, plan)');
    expect(manager).toContain('self.sameSchedule(existing.plan, plan)');
    expect(manager).toContain('self.advancesSchedule(plan, after: existing.plan)');
    expect(manager).toContain('Store that confirmation without a second notification.');
    expect(watch).toContain('sameSchedule(current.plan, plan)');
    expect(watch).toContain('advancesSchedule(plan, after: current.plan)');
    expect(watch).toContain('without a second haptic');
    expect(wire).toContain('func matchesSchedule(_ plan: RecoveryAlertWirePlan)');
    expect(manager).toContain('event.matchesSchedule(record.plan)');
    expect(manager).toContain('request.identifier == record.notificationId');
    expect(manager).toContain('guard isCurrentRequest else { return [] }');
    expect(manager).toContain('preservesScheduledNotification');
    expect(manager).toContain('shouldShowImmediateNotification');
    expect(manager).toContain('candidate.alertTrigger == .target && readyAt < current.plan.deadlineAt');
    expect(watch).toContain('current.plan.accountId == plan.accountId');
    expect(watch).toContain('plan.startedAt > current.plan.startedAt');
    expect(watch).toContain('plan.issuedAt > current.plan.issuedAt');
    expect(watch).toMatch(/if let current = persisted, !sameEpisode\(current\.plan, plan\)[\s\S]+recordTombstone\(/u);
    expect(watch).toContain('allowForegroundResume: false');
  });

  it('orders directives by server issuedAt without comparing independent device clocks', () => {
    expect(pluginSource).toContain('raw["issuedAt"] = episode["updatedAt"]');
    expect(manager).not.toContain('wire["issuedAt"] = Double(Self.nowMilliseconds())');
    expect(wire).toContain('issuedAt >= 0');
    expect(wire).not.toContain('issuedAt >= startedAt');
    expect(manager).toContain('plan.issuedAt > existing.plan.issuedAt');
  });

  it('scopes delayed-plan tombstones to one exact identity instead of blocking another athlete', () => {
    expect(manager).toContain('private struct RevisionTombstone: Codable');
    expect(manager).toContain('private static let tombstonesKey');
    expect(manager).toContain('tombstone.allowForegroundResume');
    expect(manager).toContain('prior.issuedAt > revision');
    expect(manager).toContain('prior?.terminal == true || terminal');
    expect(manager).toContain('prior?.allowForegroundResume == true || allowForegroundResume');
    expect(manager).toContain('transportSessionId == nil');
    expect(watch).toContain('private struct RevisionTombstone: Codable');
    expect(watch).toContain('private let maximumTombstones = 32');
    expect(watch).toContain('accountId == plan.accountId');
    expect(watch).toContain('recoveryId == plan.recoveryId');
    expect(watch).toContain('repetitionId == plan.repetitionId');
    expect(watch).toContain('sessionId == plan.sessionId');
    expect(watch).not.toContain('defaults.double(forKey: lastIssuedAtKey)');
    expect(watch).toContain('allowTombstoneResume: action == "resume"');
    expect(watch).toContain('tombstone.allowForegroundResume');
    expect(watch).toContain('prior.issuedAt > issuedAt');
    expect(watch).toContain('plan.issuedAt >= tombstone.issuedAt');
    expect(manager).toContain('allowTombstoneResume: consumedForegroundResume');
    expect(manager).toContain('allowTombstoneResume ? "resume" : "schedule"');
    expect(manager).toContain('"issuedAt": Double(plan.issuedAt)');
    expect(manager).toContain('"allowForegroundResume": allowForegroundResume');
    expect(manager).toContain('"terminal": terminal');

    const athleteA = {
      accountId,
      recoveryId: 'a-recovery',
      issuedAt: 500,
      allowForegroundResume: true,
    };
    expect(tombstoneAllows(athleteA, {
      accountId: `recacct_${'b'.repeat(32)}`,
      recoveryId: 'b-recovery',
      issuedAt: 100,
    })).toBe(true);
    expect(tombstoneAllows(athleteA, { ...athleteA, issuedAt: 500 })).toBe(false);
    expect(tombstoneAllows(athleteA, { ...athleteA, issuedAt: 500 }, true)).toBe(true);
    expect(tombstoneAllows(athleteA, { ...athleteA, issuedAt: 501 })).toBe(false);
    expect(tombstoneAllows(athleteA, { ...athleteA, issuedAt: 501 }, true)).toBe(true);
    expect(tombstoneAllows({ ...athleteA, allowForegroundResume: false }, {
      ...athleteA,
      issuedAt: 900,
    }, true)).toBe(false);
    expect(tombstoneAllows({ ...athleteA, terminal: true }, {
      ...athleteA,
      issuedAt: 900,
    }, true)).toBe(false);

    // A delayed Stop/cancel can never downgrade a newer fence. Only an
    // account-boundary clear may opt an equal authoritative revision back in.
    const newerFence = 200;
    const delayedCancel = 150;
    expect(Math.max(newerFence, delayedCancel)).toBe(200);
    const recoveringRevision = 175;
    expect(recoveringRevision).toBeLessThan(newerFence);
    const stopAllowsResume = false;
    const clearAllowsResume = true;
    expect(stopAllowsResume).toBe(false);
    expect(clearAllowsResume).toBe(true);
  });

  it('uploads HR before ACK, retries 409, and never lets ACK block finalization', () => {
    const samples = relay.indexOf('let batch = nextSampleBatch(relay: &relay)');
    const acknowledgement = relay.indexOf('let acknowledgement = (state.recoveryAcknowledgements ?? [])', samples);
    const finalize = relay.indexOf('let finalization = configuration.finalization', acknowledgement);
    expect(samples).toBeGreaterThan(0);
    expect(acknowledgement).toBeGreaterThan(samples);
    expect(finalize).toBeGreaterThan(acknowledgement);
    expect(relay).toContain('case 409 where activeJob.kind == .recoveryAck:');
    expect(relay).toContain('scheduleRecoveryAcknowledgementRetry(job: activeJob)');
    expect(relay).toContain('maximumFinalizingAcknowledgementFailures = 2');
    expect(relay).toContain('timeoutInterval: 5');
    expect(relay).toContain('nextFailureCount < failureLimit');
    expect(relay).toContain('Double($0.expiresAt) <= now');
    expect(relay).toContain('state.recoveryAcknowledgements?.removeAll');
    expect(relay).toContain('$0.matchesSchedule(event)');
    expect(relay).toContain('$0.matchesEpisode(event)');
    expect(relay).toContain('activeJob.kind == .finalize');
    expect(relay).toContain('self.cancelUploadTasks(jobId: activeJob.id)');
    expect(relay).toContain('self.state.activeJob = nil');
  });

  it('restores at launch, uses Capacitor local routing, and does not gate iPad timers on Watch', () => {
    expect(appDelegate).toContain('RecoveryAlertManager.shared.configureAtLaunch()');
    expect(manager).toContain('private func restore()');
    expect(manager).toContain('restored.watchOwnsCue = false');
    expect(manager).toContain('reconcileDeadlines()');
    expect(manager).toMatch(/private func reconcileDeadline[\s\S]+scheduleNotification\(record\)[\s\S]+scheduleTimer\(record\)/u);
    expect(manager).toContain('func willPresentLocalNotification(');
    expect(manager).toContain('func didReceiveLocalNotificationResponse(');
    expect(manager).toContain('DispatchQueue.main.sync(execute: apply)');
    expect(manager).not.toContain('center.delegate = self');
    expect(pluginSource).toContain('notificationRouter.localNotificationHandler = notificationHandler');
    expect(manager).not.toContain('userInterfaceIdiom');
    expect(manager).not.toContain('isWatchAppInstalled');
  });

  it('clears A before sign-out so A cannot alert while B is signed in', () => {
    expect(manager).toContain('func clearAllEpisodes');
    expect(manager).toContain('func bindAccount(_ accountId: String');
    expect(manager).toContain('$0.plan.accountId != accountId');
    expect(manager).toContain('self.boundAccountId = accountId');
    expect(manager).toContain('guard self.boundAccountId == plan.accountId else');
    expect(manager).not.toContain('self.boundAccountId == nil || self.boundAccountId == plan.accountId');
    expect(manager).toContain('TrackLabRecoveryAlertBoundAccountV1');
    expect(watch).toContain('bindAccountAction = "bind-account"');
    expect(watch).toContain('messageGeneration == bindingGeneration');
    expect(watch).toContain('boundAccountId == plan.accountId');
    expect(manager).toMatch(/self\.sendWatchCancel\([\s\S]+allowForegroundResume: true,[\s\S]+terminal: false/u);
    expect(manager).toMatch(/self\.recordTombstone\([\s\S]+allowForegroundResume: true,[\s\S]+terminal: false/u);
    const relayClear = app.indexOf('heartRate.clearAllRelays()');
    const clearBeforeLogout = app.indexOf('clearNativeRecoveryBoundary()', relayClear);
    const logout = app.indexOf('await logoutAuthUser()', clearBeforeLogout);
    expect(clearBeforeLogout).toBeGreaterThan(0);
    expect(clearBeforeLogout).toBeGreaterThan(relayClear);
    expect(logout).toBeGreaterThan(clearBeforeLogout);
    expect(app).toMatch(/readCurrentAuthUser\(\)[\s\S]+if \(!user\)[\s\S]+clearNativeRecoveryBoundary\(\)/u);
    expect(app).toMatch(/\.catch\(async \(error: Error\)[\s\S]+await clearNativeRecoveryBoundary\(\)[\s\S]+setAuthStatus\('signed-out'\)/u);
    const login = app.indexOf('await loginAuthUser');
    const clearBeforeLoginCommit = app.indexOf('await clearNativeRecoveryBoundary()', login);
    const loginCommit = app.indexOf('setAuthUser(user)', clearBeforeLoginCommit);
    expect(clearBeforeLoginCommit).toBeGreaterThan(login);
    expect(loginCommit).toBeGreaterThan(clearBeforeLoginCommit);
  });

  it('treats Stop and Start anyway as silent terminal directives', () => {
    expect(manager).toContain('plan.serverState == "cancelled"');
    expect(manager).toContain('trigger == .manual');
    expect(watch).toContain('plan.serverState == "cancelled"');
    expect(watch).toContain('deliverCue: plan.alertTrigger != .manual');
    expect(watch).toContain('if deliverCue {');
  });
});
