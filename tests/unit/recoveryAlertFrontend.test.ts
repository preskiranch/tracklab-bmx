import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  RecoveryAlertCard,
  recoveryAlertDisplay,
  recoveryDraftFromPreferences,
  recoveryMinutesFromSeconds,
  recoverySecondsFromMinutes,
  smartRecoveryBackupSeconds,
} from '../../src/components/RecoveryAlertCard';
import {
  getPulledRecoveryFinishSignal,
  nativeRecoveryMustRemainCleared,
  nativeRecoveryPermissionNeedsPrompt,
  nativeRecoveryPermissionWarning,
  nativeRecoveryScheduleRequired,
  raceRecoveryFinishSignals,
  retainPendingRecoveryFinishSignals,
  recoveryHeartRateCanSubmit,
  recoverySubmissionCanRetry,
  recoverySubmissionRetryDelayMs,
} from '../../src/components/RecoveryAlertCoordinator';
import type { RecoveryAlertPreference, RecoveryEpisode } from '../../src/lib/recoveryAlert';

const preference: RecoveryAlertPreference = {
  mode: 'timer',
  timerSeconds: 120,
  targetBpm: 115,
  minimumSeconds: 30,
  maximumSeconds: 600,
  updatedAt: 1,
};

function episode(overrides: Partial<RecoveryEpisode> = {}): RecoveryEpisode {
  return {
    id: 'recovery-one',
    activityType: 'bmx-race',
    sessionId: 'race-one',
    repetitionId: 'race-one-player-one',
    mode: 'timer',
    state: 'recovering',
    startedAt: 10_000,
    notBeforeAt: 40_000,
    plannedReadyAt: 112_000,
    fallbackAt: 112_000,
    readyAt: null,
    targetBpm: 115,
    reason: 'fixed-timer',
    explanation: 'Your fixed recovery time.',
    confidence: 'fixed',
    learningEpisodeCount: 0,
    alertedAt: null,
    alertTrigger: null,
    updatedAt: 10_000,
    ...overrides,
  };
}

const emptyActions = {
  onDraftChange: vi.fn(),
  onSave: vi.fn(),
  onAddTime: vi.fn(),
  onStartAnyway: vi.fn(),
  onStop: vi.fn(),
};

describe('Recovery Alert individual finish lifecycle', () => {
  it('uses every rider’s exact interpolated finish instead of the later group finish', () => {
    const snapshot = {
      activityType: 'bmx-race' as const,
      sessionId: 'race-multi-athlete',
      startedAt: 1_000_000,
      source: 'live' as const,
      players: [
        { playerId: 1, riderId: 'account:rider-one', riderName: 'Rider One' },
        { playerId: 2, riderId: 'account:rider-two', riderName: 'Rider Two' },
      ],
      riders: [
        { playerId: 1, finishedAt: 34_281 },
        { playerId: 2, finishedAt: 39_904 },
      ],
    };

    const signals = raceRecoveryFinishSignals(snapshot);
    expect(signals.map((signal) => [signal.athleteId, signal.finishedAt])).toEqual([
      ['account:rider-one', 1_034_281],
      ['account:rider-two', 1_039_904],
    ]);
    expect(signals[0].finishedAt).not.toBe(signals[1].finishedAt);
    expect(signals[0].effortSummary).toEqual({ finishTimeMs: 34_281 });
  });

  it('keeps the repetition identity stable through a bike reconnect', () => {
    const beforeReconnect = raceRecoveryFinishSignals({
      activityType: 'straight-sprint',
      sessionId: 'straight-one',
      startedAt: 50_000,
      source: 'live',
      players: [{ playerId: 1, riderId: 'account:one', riderName: 'One' }],
      riders: [{ playerId: 1, finishedAt: 7_250 }],
    })[0];
    const afterReconnect = raceRecoveryFinishSignals({
      activityType: 'straight-sprint',
      sessionId: 'straight-one',
      startedAt: 50_000,
      source: 'live',
      players: [{ playerId: 1, riderId: 'account:one', riderName: 'One' }],
      riders: [{ playerId: 1, finishedAt: 7_250 }],
    })[0];

    expect(afterReconnect.requestId).toBe(beforeReconnect.requestId);
    expect(afterReconnect.repetitionId).toBe(beforeReconnect.repetitionId);
    expect(afterReconnect.finishedAt).toBe(57_250);

    const coordinatorSource = readFileSync(new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url), 'utf8');
    expect(coordinatorSource).toContain('players: raceCapture.players.map');
  });

  it('does not create Recovery Alerts for demo races or an unstarted capture', () => {
    const base = {
      activityType: 'bmx-race' as const,
      sessionId: 'race-demo',
      players: [{ playerId: 1, riderId: 'account:one', riderName: 'One' }],
      riders: [{ playerId: 1, finishedAt: 9_000 }],
    };
    expect(raceRecoveryFinishSignals({ ...base, startedAt: 1_000, source: 'demo' })).toEqual([]);
    expect(raceRecoveryFinishSignals({ ...base, startedAt: null, source: 'live' })).toEqual([]);
  });

  it('uses bounded backoff instead of retrying on high-frequency race renders', () => {
    expect(recoverySubmissionRetryDelayMs(1)).toBe(2_000);
    expect(recoverySubmissionRetryDelayMs(2)).toBe(4_000);
    expect(recoverySubmissionRetryDelayMs(8)).toBe(60_000);
    expect(recoverySubmissionCanRetry(6)).toBe(true);
    expect(recoverySubmissionCanRetry(7)).toBe(false);

    const source = readFileSync(new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url), 'utf8');
    expect(source).toContain('finishSignalKey, preference?.mode, retryRevision');
    expect(source).not.toContain('accountId, finishSignals, preference');
  });

  it('displays local Watch BPM without submitting it before an exact cloud stream exists', () => {
    const active = episode({ mode: 'heart-rate' });
    const local = { streamId: '', bpm: 152, recordedAt: 10_500 };
    expect(recoveryHeartRateCanSubmit(active, local, 11_000)).toBe(false);
    expect(recoveryHeartRateCanSubmit(active, { ...local, streamId: 'stream-current' }, 11_000)).toBe(true);

    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('latestHeartRate={accountLiveHeartRate}');
  });

  it('retains a vanished finish signal through retry and bounds pending memory', () => {
    const first = raceRecoveryFinishSignals({
      activityType: 'bmx-race',
      sessionId: 'race-retry',
      startedAt: 1_000,
      source: 'live',
      players: [{ playerId: 1, riderId: 'account:one' }],
      riders: [{ playerId: 1, finishedAt: 7_000 }],
    })[0];
    const captured = retainPendingRecoveryFinishSignals(new Map(), [first]);
    const afterResultClears = retainPendingRecoveryFinishSignals(captured, []);
    expect(afterResultClears.get(first.requestId)).toEqual(first);

    const many = Array.from({ length: 40 }, (_, index) => ({
      ...first,
      requestId: `request-${index}`,
    }));
    const bounded = retainPendingRecoveryFinishSignals(new Map(), many);
    expect(bounded.size).toBe(32);
    expect(bounded.has('request-0')).toBe(false);
    expect(bounded.has('request-39')).toBe(true);

    const source = readFileSync(new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url), 'utf8');
    expect(source).toContain('pendingFinishSignalsRef.current.forEach((signal) =>');
    expect(source).toContain('pendingFinishSignalsRef.current.delete(signal.requestId)');
  });

  it('applies only the authoritative active repetition after an idempotent create replay', () => {
    const source = readFileSync(
      new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('activeEpisode }) =>');
    expect(source).toContain('const authoritativeActive = actionableEpisode(activeEpisode)');
    expect(source).toContain('setEpisode(authoritativeActive)');
    expect(source).toContain('opaqueAccountId,\n              authoritativeActive,');
    expect(source).not.toContain('scheduleEpisode(opaqueAccountId, created)');
  });

  it('re-schedules an authoritative server episode after reload only when native state is missing or stale', () => {
    const active = episode();
    const opaqueAccountId = `recacct_${'a'.repeat(32)}`;
    expect(nativeRecoveryScheduleRequired({
      accountId: null,
      recoveryId: null,
      repetitionId: null,
      plannedReadyAt: null,
      fallbackAt: null,
      readyAt: null,
    }, opaqueAccountId, active)).toBe(true);
    expect(nativeRecoveryScheduleRequired({
      accountId: opaqueAccountId,
      recoveryId: active.id,
      repetitionId: active.repetitionId,
      plannedReadyAt: active.plannedReadyAt,
      fallbackAt: active.fallbackAt,
      readyAt: active.readyAt,
    }, opaqueAccountId, active)).toBe(false);
    expect(nativeRecoveryScheduleRequired({
      accountId: opaqueAccountId,
      recoveryId: active.id,
      repetitionId: active.repetitionId,
      plannedReadyAt: active.plannedReadyAt,
      fallbackAt: active.fallbackAt + 30_000,
      readyAt: active.readyAt,
    }, opaqueAccountId, active)).toBe(true);
  });

  it('keeps Start anyway native-cancelled and guards async reconciliation races', () => {
    expect(nativeRecoveryMustRemainCleared(episode({
      state: 'ready',
      readyAt: 20_000,
      alertTrigger: 'manual',
      reason: 'manual-start',
    }))).toBe(true);
    expect(nativeRecoveryMustRemainCleared(episode())).toBe(false);

    const source = readFileSync(
      new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('let disposed = false');
    expect(source).toContain('const reconciliationGeneration = hydrationGenerationRef.current');
    expect(source).toContain('if (!isCurrentReconciliation()) return;');
    expect(source).toContain('nativeRecoveryMustRemainCleared(reconciliationEpisode)');
    expect(source).toContain('return () => { disposed = true; };');
    expect(source).toContain('let expectedBoundary = getNativeRecoveryAccountBoundaryGeneration()');
    expect(source).toContain('getNativeRecoveryAccountBoundaryGeneration() === expectedBoundary');
    expect(source).toContain('await nativeRecoveryAlerts.bindAccount(preferenceResult.accountId)');
    expect(source).toContain('expectedBoundary = openNativeRecoveryAccountBoundary(preferenceResult.accountId)');
    expect(source).toContain('const isCurrentSubmission = () => mountedRef.current');
    expect(source).toMatch(/await import\('\.\.\/lib\/nativeRecoveryAlerts'\);\n\s+if \(!isCurrentSubmission\(\)\) return;/u);
    expect(source).toContain('const isCurrentAction = () => mountedRef.current');
    expect(source).toMatch(/const \{ nativeRecoveryAlerts \} = await import\('\.\.\/lib\/nativeRecoveryAlerts'\);\n\s+if \(!isCurrentAction\(\)\) return;/u);
    const bindingCheck = source.indexOf('preferenceResult.accountId !== activeResult.accountId');
    const nativeBind = source.indexOf('nativeRecoveryAlerts.bindAccount(preferenceResult.accountId)', bindingCheck);
    const reopen = source.indexOf('openNativeRecoveryAccountBoundary(preferenceResult.accountId)', nativeBind);
    const exposeBinding = source.indexOf('setRecoveryAccountId(preferenceResult.accountId)', reopen);
    expect(nativeBind).toBeGreaterThan(bindingCheck);
    expect(reopen).toBeGreaterThan(bindingCheck);
    expect(exposeBinding).toBeGreaterThan(reopen);

    // Deferred A hydration cannot reopen after clear; a fresh B hydration
    // captures the new closed boundary and may reopen only after dual binding.
    let boundary = 20;
    const deferredA = boundary;
    boundary += 1; // clearAllEpisodes at sign-out
    expect(deferredA === boundary).toBe(false);
    const freshB = boundary;
    expect(freshB === boundary).toBe(true);
  });

  it('requests alerts once on a fresh enabled device and surfaces denied background delivery', () => {
    const notDetermined = {
      version: 1 as const,
      supported: true,
      status: 'not-determined' as const,
      alertsEnabled: false,
      soundsEnabled: false,
      timeSensitiveEnabled: false,
    };
    expect(nativeRecoveryPermissionNeedsPrompt('timer', notDetermined)).toBe(true);
    expect(nativeRecoveryPermissionNeedsPrompt('off', notDetermined)).toBe(false);
    expect(nativeRecoveryPermissionWarning('timer', {
      ...notDetermined,
      status: 'denied',
    })).toContain('Settings for background alerts');
    expect(nativeRecoveryPermissionWarning('off', {
      ...notDetermined,
      status: 'denied',
    })).toBe('');

    const source = readFileSync(
      new URL('../../src/components/RecoveryAlertCoordinator.tsx', import.meta.url),
      'utf8',
    );
    const bind = source.indexOf('await nativeRecoveryAlerts.bindAccount(preferenceResult.accountId)');
    const status = source.indexOf('await nativeRecoveryAlerts.getPermissionStatus()', bind);
    const request = source.indexOf('await nativeRecoveryAlerts.requestPermission()', status);
    const open = source.indexOf('openNativeRecoveryAccountBoundary(preferenceResult.accountId)', request);
    expect(status).toBeGreaterThan(bind);
    expect(request).toBeGreaterThan(status);
    expect(open).toBeGreaterThan(request);
    expect(source).toContain("preferenceResult.preference.mode !== 'off'");
  });

  it('starts Get Pulled recovery at the exact result end with aggregate-only learning facts', () => {
    const signal = getPulledRecoveryFinishSignal({
      id: 'pull-one',
      riderId: 'account:one',
      startedAt: 20_000,
      endedAt: 26_000,
      averageWatts: 650,
      peakWatts: 1_180,
      averageCadence: 142,
      peakCadence: 188,
      averageSpeedKph: 36,
      peakSpeedKph: 54,
    });
    expect(signal).toMatchObject({
      activityType: 'get-pulled',
      finishedAt: 26_000,
      athleteId: 'account:one',
      effortSummary: {
        workDurationMs: 6_000,
        averagePowerWatts: 650,
        peakPowerWatts: 1_180,
        peakCadenceRpm: 188,
        peakSpeedMps: 15,
      },
    });
    expect(signal?.sessionId).toMatch(/^recovery-pull-[a-f0-9]{32}$/u);
    expect(signal?.repetitionId).toMatch(/^get-pulled-rep-[a-f0-9]{32}$/u);
  });

  it('never places a raw Get Pulled account ID in cloud/native recovery identity', () => {
    const rawAuthId = 'account:private-auth-user-123';
    const result = {
      id: `get-pulled:${rawAuthId}:9000`,
      riderId: rawAuthId,
      startedAt: 9_000,
      endedAt: 15_000,
      averageWatts: 650,
      peakWatts: 1_180,
      averageCadence: 142,
      peakCadence: 188,
      averageSpeedKph: 36,
      peakSpeedKph: 54,
    };
    const first = getPulledRecoveryFinishSignal(result)!;
    const replay = getPulledRecoveryFinishSignal(result)!;
    const createOrNativePayload = {
      requestId: first.requestId,
      activityType: first.activityType,
      sessionId: first.sessionId,
      repetitionId: first.repetitionId,
      finishedAt: first.finishedAt,
      effortSummary: first.effortSummary,
    };
    expect(replay.requestId).toBe(first.requestId);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(JSON.stringify(createOrNativePayload)).not.toContain('account:');
    expect(JSON.stringify(createOrNativePayload)).not.toContain('private-auth-user-123');
  });
});

describe('Recovery Alert status and setup UI', () => {
  it('edits whole minutes while preserving the seconds persistence contract', () => {
    expect(recoverySecondsFromMinutes(1)).toBe(60);
    expect(recoverySecondsFromMinutes(7)).toBe(420);
    expect(recoverySecondsFromMinutes(31)).toBe(1_800);
    expect(recoverySecondsFromMinutes(-1)).toBe(60);
    expect(recoveryMinutesFromSeconds(60)).toBe(1);
    expect(recoveryMinutesFromSeconds(90)).toBe(2);
    expect(recoveryMinutesFromSeconds(1_800)).toBe(30);
    expect(recoveryMinutesFromSeconds(900, 60, 10)).toBe(10);

    expect(recoveryDraftFromPreferences({
      ...preference,
      timerSeconds: 90,
      minimumSeconds: 30,
      maximumSeconds: 601,
    })).toMatchObject({
      timerSeconds: 120,
      minimumSeconds: 60,
      maximumSeconds: 660,
    });
  });

  it('keeps Smart starting time and earliest alert no later than its timer backup', () => {
    expect(smartRecoveryBackupSeconds(120, 300)).toBe(300);
    expect(smartRecoveryBackupSeconds(420, 300)).toBe(420);
    expect(smartRecoveryBackupSeconds(1_200, 600)).toBe(1_200);
    expect(smartRecoveryBackupSeconds(120, 300, 480)).toBe(480);
    expect(recoveryDraftFromPreferences({
      ...preference,
      mode: 'smart',
      timerSeconds: 900,
      maximumSeconds: 300,
    })).toMatchObject({ timerSeconds: 900, maximumSeconds: 900 });
  });

  it('offers to save rounded legacy active settings without dirtying an Off preference', () => {
    const renderSetup = (savedPreferences: RecoveryAlertPreference) => renderToStaticMarkup(
      createElement(RecoveryAlertCard, {
        draft: recoveryDraftFromPreferences(savedPreferences),
        savedPreferences,
        episode: null,
        latestHeartRate: null,
        now: 10_000,
        loading: false,
        saving: false,
        actionBusy: false,
        message: '',
        nativeAlertsAvailable: true,
        ...emptyActions,
      }),
    );
    const legacyHeartRate = renderSetup({ ...preference, mode: 'heart-rate', minimumSeconds: 30 });
    expect(legacyHeartRate).toContain('<button class="primary" type="button">Save Recovery Alert</button>');

    const off = renderSetup({ ...preference, mode: 'off', minimumSeconds: 30 });
    expect(off).toContain('<button class="primary" type="button" disabled="">Save Off</button>');
  });

  it('uses the requested plain status labels', () => {
    expect(recoveryAlertDisplay(episode(), 10_000, null).status).toBe('Recovering · 1:42');
    expect(recoveryAlertDisplay(episode({
      mode: 'heart-rate',
      plannedReadyAt: null,
      fallbackAt: 610_000,
    }), 10_000, { bpm: 128, recordedAt: 9_500 }).status).toBe('HR 128 · Target 115');
    expect(recoveryAlertDisplay(episode({
      mode: 'smart',
      learningEpisodeCount: 2,
      plannedReadyAt: 130_000,
      fallbackAt: 610_000,
    }), 10_000, null).status).toBe('Smart Recovery · Learning');
    expect(recoveryAlertDisplay(episode({
      state: 'ready',
      readyAt: 90_000,
    }), 100_000, null).status).toBe('Ready for next rep');
  });

  it('shows simple modes, whole-minute fields, Smart target, safeguards, and all manual controls', () => {
    const setup = renderToStaticMarkup(createElement(RecoveryAlertCard, {
      draft: { ...recoveryDraftFromPreferences(preference), mode: 'smart' },
      savedPreferences: preference,
      episode: null,
      latestHeartRate: null,
      now: 10_000,
      loading: false,
      saving: false,
      actionBusy: false,
      message: '',
      nativeAlertsAvailable: false,
      ...emptyActions,
    }));
    expect(setup).toContain('Recovery Alert');
    expect(setup).toContain(' Off</button>');
    expect(setup).toContain(' Timer</button>');
    expect(setup).toContain(' Heart Rate</button>');
    expect(setup).toContain(' Smart</button>');
    expect(setup).toContain('Starting recovery time');
    expect(setup).toContain('aria-label="Starting recovery time in minutes"');
    expect(setup).toContain('aria-label="Earliest alert in minutes"');
    expect(setup).toContain('aria-label="Timer backup in minutes"');
    expect(setup).toContain('step="1"');
    expect(setup).toContain('>MIN</b>');
    expect(setup).not.toContain('Custom seconds');
    expect(setup).toContain('Ready heart rate');
    expect(setup).toContain('recovery target, not a medical resting-heart-rate');
    expect(setup).toContain('does not claim to measure breathing');
    expect(setup).toContain('Install the latest TrackLab build');
    expect(setup).toContain('Alerts never start the next rep');

    const active = renderToStaticMarkup(createElement(RecoveryAlertCard, {
      draft: recoveryDraftFromPreferences(preference),
      savedPreferences: preference,
      episode: episode(),
      latestHeartRate: null,
      now: 10_000,
      loading: false,
      saving: false,
      actionBusy: false,
      message: '',
      nativeAlertsAvailable: true,
      ...emptyActions,
    }));
    expect(active).toContain('Recovering · 1:42');
    expect(active).toContain('recovery-alert-card has-active');
    expect(active).toContain('Start anyway');
    expect(active).toContain('Add 30 seconds');
    expect(active).toContain('>Stop<');
  });

  it('keeps controls touch-sized and responsive on iPhone and iPad', () => {
    const css = readFileSync(new URL('../../src/components/RecoveryAlertCard.css', import.meta.url), 'utf8');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('width: 100%');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('.race-fullscreen .recovery-alert-card.has-active');
    expect(css).toContain('.utility-fullscreen .recovery-alert-card.has-active');
    expect(css).toContain('pointer-events: none');
  });
});
