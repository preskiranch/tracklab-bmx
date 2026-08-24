import { describe, expect, it } from 'vitest';
import {
  defaultRecoveryAlertPreference,
  normalizeRecoveryAlertDirective,
  normalizeRecoveryAlertPreference,
  normalizeRecoveryEffortSummary,
  normalizeRecoveryEpisode,
  planSmartRecovery,
} from '../../src/lib/recoveryAlert';

describe('Recovery Alert domain', () => {
  it('supports Off, Timer, Heart Rate, and Smart with bounded account preferences', () => {
    expect(defaultRecoveryAlertPreference).toMatchObject({
      timerSeconds: 600,
      minimumSeconds: 60,
      maximumSeconds: 600,
    });
    for (const mode of ['off', 'timer', 'heart-rate', 'smart'] as const) {
      expect(normalizeRecoveryAlertPreference({ mode }).mode).toBe(mode);
    }
    expect(normalizeRecoveryAlertPreference({
      mode: 'unknown',
      timerSeconds: Infinity,
      targetBpm: 221,
      minimumSeconds: 14,
      maximumSeconds: 1,
    })).toEqual({
      ...defaultRecoveryAlertPreference,
      targetBpm: 220,
      minimumSeconds: 15,
      maximumSeconds: 30,
    });
    expect(normalizeRecoveryAlertPreference({
      mode: 'smart',
      timerSeconds: 1_800,
      targetBpm: 220,
      minimumSeconds: 600,
      maximumSeconds: 600,
      updatedAt: 123,
    })).toEqual({
      mode: 'smart',
      timerSeconds: 1_800,
      targetBpm: 220,
      minimumSeconds: 600,
      maximumSeconds: 1_800,
      updatedAt: 123,
    });
    const normalizedSmart = normalizeRecoveryAlertPreference({
      mode: 'smart',
      timerSeconds: 300,
      minimumSeconds: 30,
      maximumSeconds: 120,
    });
    expect(normalizedSmart.maximumSeconds).toBe(300);
    expect(normalizedSmart.maximumSeconds).toBeGreaterThanOrEqual(normalizedSmart.timerSeconds);
  });

  it('keeps a selected fixed timer independent from Smart minimum recovery', () => {
    const preference = normalizeRecoveryAlertPreference({
      mode: 'timer',
      timerSeconds: 60,
      minimumSeconds: 120,
      maximumSeconds: 600,
    });
    expect(preference).toMatchObject({ mode: 'timer', timerSeconds: 60, minimumSeconds: 120 });
    // Episode planning uses timerSeconds directly; minimumSeconds remains a
    // Heart Rate/Smart guard and must not silently change the visible timer.
    expect(preference.timerSeconds).toBe(60);
  });

  it('accepts only bounded effort summaries and never needs raw telemetry', () => {
    expect(normalizeRecoveryEffortSummary({
      workDurationMs: 12_000,
      finishTimeMs: 11_500,
      averagePowerWatts: 610.4,
      peakPowerWatts: 1_420,
      peakCadenceRpm: 176,
      peakSpeedMps: 14.2,
    })).toEqual({
      workDurationMs: 12_000,
      finishTimeMs: 11_500,
      averagePowerWatts: 610.4,
      peakPowerWatts: 1_420,
      peakCadenceRpm: 176,
      peakSpeedMps: 14.2,
    });
    expect(normalizeRecoveryEffortSummary({ peakPowerWatts: 5_001 })).toBeNull();
    expect(normalizeRecoveryEffortSummary({ heartRateSamples: [180, 170] })).toBeNull();
    expect(normalizeRecoveryEffortSummary({ rawPower: [1, 2, 3] })).toBeNull();
  });

  it('uses a fixed fallback until two clean recoveries, then raises confidence after six', () => {
    const preference = { ...defaultRecoveryAlertPreference, mode: 'smart' as const };
    const summary = (recoverySeconds: number, peakPowerWatts = 1_000) => ({
      recoverySeconds,
      sampleCount: 5,
      effortSummary: { peakPowerWatts },
    });
    expect(planSmartRecovery(preference, [], {})).toMatchObject({
      plannedSeconds: 600,
      confidence: 'fixed',
      learningEpisodeCount: 0,
      reason: 'smart-learning-fixed-fallback',
    });
    expect(planSmartRecovery({
      ...preference,
      timerSeconds: 300,
      maximumSeconds: 120,
    }, [], {})).toMatchObject({
      plannedSeconds: 300,
      confidence: 'fixed',
    });
    expect(planSmartRecovery(preference, [summary(80), summary(100)], { peakPowerWatts: 1_000 }))
      .toMatchObject({
        plannedSeconds: 90,
        confidence: 'provisional',
        learningEpisodeCount: 2,
        reason: 'smart-personalized-estimate',
      });
    expect(planSmartRecovery(
      preference,
      [70, 80, 90, 100, 110, 120].map((seconds) => summary(seconds)),
      { peakPowerWatts: 1_000 },
    )).toMatchObject({
      plannedSeconds: 95,
      confidence: 'personalized',
      learningEpisodeCount: 6,
    });

    const sameHeartRateHistory = [
      { recoverySeconds: 90, sampleCount: 5, effortSummary: { finishTimeMs: 25_000 } },
      { recoverySeconds: 90, sampleCount: 5, effortSummary: { finishTimeMs: 25_000 } },
    ];
    const ordinary = planSmartRecovery(preference, sameHeartRateHistory, { finishTimeMs: 25_000 });
    const faster = planSmartRecovery(preference, sameHeartRateHistory, { finishTimeMs: 20_000 });
    expect(faster.plannedSeconds).toBeGreaterThan(ordinary.plannedSeconds);
    expect(faster.plannedSeconds).toBeLessThanOrEqual(Math.round(ordinary.plannedSeconds * 1.2));
  });

  it('keeps planned, fallback, and actual readiness clocks distinct', () => {
    const recovering = {
      id: 'recovery_123',
      activityType: 'bmx-race',
      sessionId: 'race-session',
      repetitionId: 'lap-2',
      mode: 'smart',
      state: 'recovering',
      startedAt: 1_000,
      notBeforeAt: 31_000,
      plannedReadyAt: 91_000,
      fallbackAt: 601_000,
      readyAt: null,
      targetBpm: 120,
      reason: 'smart-personalized-estimate',
      explanation: 'Early personalized estimate.',
      confidence: 'provisional',
      learningEpisodeCount: 3,
      alertedAt: null,
      alertTrigger: null,
      updatedAt: 2_000,
    };
    expect(normalizeRecoveryEpisode(recovering)).toEqual(recovering);
    expect(normalizeRecoveryEpisode({ ...recovering, plannedReadyAt: 700_000 })).toBeNull();
    expect(normalizeRecoveryAlertDirective({
      version: 1,
      accountId: `recacct_${'a'.repeat(32)}`,
      issuedAt: 2_000,
      ...recovering,
    })).toMatchObject({ accountId: `recacct_${'a'.repeat(32)}`, issuedAt: 2_000, id: 'recovery_123' });
    expect(normalizeRecoveryAlertDirective({
      version: 1,
      accountId: 'user:raw-account-id',
      issuedAt: 2_000,
      ...recovering,
    })).toBeNull();
    expect(normalizeRecoveryAlertDirective({
      version: 1,
      accountId: `recacct_${'a'.repeat(32)}`,
      ...recovering,
    })).toBeNull();
  });
});
