import { describe, expect, it } from 'vitest';
import {
  createMonitorSprintArm,
  monitorMaximumCadenceRpm,
  monitorMetrics,
  monitorSprintArmIsExpired,
  monitorSprintArmLifetimeMs,
  monitorSprintArmMatchesPlayer,
  monitorSprintSessionFromArm,
  monitorSprintShouldCapture,
} from '../../src/components/MonitorView';
import { bmxSpeedKphFromCadence } from '../../src/game/bmxRollout';
import type { BikeSample, PlayerSlot } from '../../src/types';

function sample(overrides: Partial<BikeSample> = {}): BikeSample {
  return {
    at: 1_000,
    cadence: 66,
    cadenceAt: 1_000,
    deviceId: 58_701,
    label: 'WattbikePM25058701',
    signal: 1,
    source: 'bluetooth',
    speedAt: 1_000,
    speedKph: 0,
    watts: 63,
    wattsAt: 1_000,
    ...overrides,
  };
}

function player(overrides: Partial<PlayerSlot> = {}): PlayerSlot {
  return {
    id: 2,
    name: 'Mason Fleming',
    colorName: 'yellow',
    accent: '#f9d548',
    deviceId: 58_701,
    riderId: 'studio-rider-mason',
    ...overrides,
  };
}

describe('Monitor View metrics', () => {
  it('derives speed from cadence using the shared 44/16 BMX rollout', () => {
    const metrics = monitorMetrics(sample(), 1_000);

    expect(metrics.watts).toBe(63);
    expect(metrics.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(66), 6);
    expect(metrics.speedKph).toBeGreaterThan(0);
  });

  it('does not display Wattbike speed in place of BMX rollout speed', () => {
    const metrics = monitorMetrics(sample({ cadence: 60, speedKph: 80 }), 1_000);

    expect(metrics.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(60), 6);
    expect(metrics.speedKph).not.toBe(80);
  });

  it('rejects impossible post-sprint flywheel cadence without changing live metrics', () => {
    const metrics = monitorMetrics(sample({ cadence: 100_000, watts: 940 }), 1_000);

    expect(metrics.live).toBe(true);
    expect(metrics.cadence).toBe(0);
    expect(metrics.speedKph).toBe(0);
    expect(metrics.watts).toBe(0);
  });

  it('preserves legitimate elite cadence through the human-range ceiling', () => {
    const metrics = monitorMetrics(sample({ cadence: monitorMaximumCadenceRpm }), 1_000);

    expect(metrics.cadence).toBe(monitorMaximumCadenceRpm);
    expect(metrics.speedKph).toBeCloseTo(bmxSpeedKphFromCadence(monitorMaximumCadenceRpm), 6);
  });

  it('does not begin recording from backward crank cadence without one watt of power', () => {
    expect(monitorSprintShouldCapture(monitorMetrics(sample({ watts: 0, cadence: 90 }), 1_000))).toBe(false);
    expect(monitorSprintShouldCapture(monitorMetrics(sample({ watts: 1, cadence: 90 }), 1_000))).toBe(true);
  });

  it('preallocates a server-safe sprint identity without starting the sprint clock', () => {
    const arm = createMonitorSprintArm(player(), 1_000, () => 'fixed-arm-id');

    expect(arm).toEqual({
      id: 'monitor-sprint:fixed-arm-id',
      playerId: 2,
      riderId: 'studio-rider-mason',
      riderName: 'Mason Fleming',
      deviceId: 58_701,
      armedAt: 1_000,
    });
    expect(arm).not.toHaveProperty('startedAt');
  });

  it('keeps the prearmed identity but starts the authoritative clock at the first watt sample', () => {
    const arm = createMonitorSprintArm(player(), 1_000, () => 'fixed-arm-id');
    expect(arm).not.toBeNull();

    expect(monitorSprintSessionFromArm(arm!, 4_250)).toEqual({
      ...arm,
      startedAt: 4_250,
    });
    expect(monitorSprintSessionFromArm(arm!, 999)).toBeNull();
  });

  it('invalidates a prearm when the exact rider, lane, or Wattbike assignment changes', () => {
    const arm = createMonitorSprintArm(player(), 1_000, () => 'fixed-arm-id');
    expect(arm).not.toBeNull();

    expect(monitorSprintArmMatchesPlayer(arm!, player())).toBe(true);
    expect(monitorSprintArmMatchesPlayer(arm!, player({ riderId: 'studio-rider-other' }))).toBe(false);
    expect(monitorSprintArmMatchesPlayer(arm!, player({ deviceId: 58_702 }))).toBe(false);
    expect(monitorSprintArmMatchesPlayer(arm!, player({ id: 3 }))).toBe(false);
  });

  it('rotates an unused arm before its one-use cloud reservation can expire', () => {
    const arm = createMonitorSprintArm(player(), 1_000, () => 'fixed-arm-id');
    expect(arm).not.toBeNull();

    expect(monitorSprintArmIsExpired(arm!, 1_000 + monitorSprintArmLifetimeMs - 1)).toBe(false);
    expect(monitorSprintArmIsExpired(arm!, 1_000 + monitorSprintArmLifetimeMs)).toBe(true);
  });

  it('rejects a nonce that cannot be used as a strict cloud session identifier', () => {
    expect(createMonitorSprintArm(player(), 1_000, () => 'unsafe/session')).toBeNull();
  });
});
