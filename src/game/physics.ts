import type { BikeSample, PlayerSlot, RiderState } from '../types';
import { crossedTakeoff, surfaceAngleDeg } from './trackProfile';

const gravityPx = 430;
const groundRecoveryPerSecond = 4.2;
const maxAirPx = 34;
const liveMetricWindowMs = 1800;
const rollingFrictionMps2 = 0.34;
const airDragPerMeter = 0.16;
const stopVelocityMps = 0.04;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function metricIsUsable(sample: BikeSample | null | undefined, metricAt: number | undefined, nowMs: number, raceStartedAt: number) {
  if (!sample) {
    return false;
  }

  const recordedAt = metricAt ?? sample.at;
  return recordedAt >= raceStartedAt && nowMs - recordedAt <= liveMetricWindowMs;
}

export function createInitialRiders(players: PlayerSlot[]): RiderState[] {
  return players.map((player) => ({
    playerId: player.id,
    distance: 0,
    velocity: 0,
    boost: 0,
    air: 0,
    verticalVelocity: 0,
    pitch: 0,
    pedalPhase: 0,
    landingCompression: 0,
    phase: 'pedaling',
    lastWatts: 0,
    wattsAverage: 160,
    rank: player.id,
    finishedAt: null,
  }));
}

export function stepRiders(
  riders: RiderState[],
  players: PlayerSlot[],
  samplesByDevice: Map<number, BikeSample>,
  dt: number,
  raceStartedAt: number,
  raceLengthMeters: number,
): RiderState[] {
  const stepped = riders.map((rider) => {
    if (rider.finishedAt) {
      return rider;
    }

    const player = players.find((slot) => slot.id === rider.playerId);
    const sample = player?.deviceId == null ? null : samplesByDevice.get(player.deviceId);
    const nowMs = Date.now();
    const watts = metricIsUsable(sample, sample?.wattsAt, nowMs, raceStartedAt) ? sample?.watts ?? 0 : 0;
    const cadence = metricIsUsable(sample, sample?.cadenceAt, nowMs, raceStartedAt) ? sample?.cadence ?? 0 : 0;
    const sampledSpeed = metricIsUsable(sample, sample?.speedAt, nowMs, raceStartedAt) ? sample?.speedKph ?? null : null;

    const wattsAverage = rider.wattsAverage * 0.94 + watts * 0.06;
    const sprintSpike = watts > Math.max(260, wattsAverage + 135);
    const boost = Math.max(0, Math.min(1, rider.boost + (sprintSpike ? 0.22 : -0.7 * dt)));
    const cadenceLift = Math.min(1.4, cadence / 95);
    const hasDriveSignal = watts > 8 || cadence > 4;
    const hasSpeedSignal = (sampledSpeed ?? 0) > 0.8;
    const speedFromPower = hasDriveSignal
      ? 1.2 + Math.sqrt(Math.max(0, watts)) * 0.27 + cadenceLift * 0.65 + boost * 2.8
      : 0;
    const speedFromSensor = sampledSpeed == null ? null : sampledSpeed / 3.6;
    const targetVelocity = hasDriveSignal || hasSpeedSignal ? Math.max(speedFromPower, speedFromSensor ?? 0) : null;
    const velocity = targetVelocity == null
      ? Math.max(0, rider.velocity - (rollingFrictionMps2 + rider.velocity * rider.velocity * airDragPerMeter) * dt)
      : rider.velocity + (targetVelocity - rider.velocity) * Math.min(1, dt * 2.5);
    const settledVelocity = velocity < stopVelocityMps && targetVelocity == null ? 0 : velocity;
    const previousDistance = rider.distance;
    const distance = Math.min(raceLengthMeters, previousDistance + settledVelocity * dt);
    const cadenceRps = Math.max(0.1, cadence / 60);
    const pedalPhase = (rider.pedalPhase + cadenceRps * dt) % 1;

    let air = rider.air;
    let verticalVelocity = rider.verticalVelocity;
    let pitch = rider.pitch;
    let landingCompression = Math.max(0, rider.landingCompression - dt * groundRecoveryPerSecond);
    let phase = rider.phase;

    const takeoff = crossedTakeoff(previousDistance, distance);

    if (phase !== 'airborne' && takeoff && settledVelocity > 2.2 && cadence > 18) {
      const cadenceLaunch = clamp(cadence / 110, 0.35, 1.25);
      const speedLaunch = clamp(settledVelocity / 12, 0.45, 1.3);
      verticalVelocity = (145 + speedLaunch * 56 + cadenceLaunch * 32 + boost * 34) * takeoff.lift;
      pitch = -10 - boost * 8;
      landingCompression = 0;
      phase = 'airborne';
    }

    if (phase === 'airborne') {
      air += verticalVelocity * dt;
      verticalVelocity -= gravityPx * dt;
      const descent = clamp(-verticalVelocity / 330, 0, 1);
      const lift = clamp(verticalVelocity / 350, 0, 1);
      pitch = -14 * lift + 12 * descent + boost * -4;

      if (air > maxAirPx) {
        air = maxAirPx;
        verticalVelocity = Math.min(0, verticalVelocity);
      }

      if (air <= 0 && verticalVelocity < 0) {
        air = 0;
        landingCompression = clamp(Math.abs(verticalVelocity) / 430, 0.18, 1);
        verticalVelocity = 0;
        pitch = 3;
        phase = 'landing';
      }
    } else if (phase === 'landing') {
      pitch = 4 * landingCompression;
      if (landingCompression <= 0.04) {
        landingCompression = 0;
        pitch = 0;
        phase = 'pedaling';
      }
    } else {
      pitch = surfaceAngleDeg(distance) + (cadence > 0 ? Math.sin(pedalPhase * Math.PI * 2) * 1.1 : 0);
    }

    const finishedAt = distance >= raceLengthMeters ? Date.now() - raceStartedAt : null;

    return {
      ...rider,
      distance,
      velocity: settledVelocity,
      boost,
      air,
      verticalVelocity,
      pitch,
      pedalPhase,
      landingCompression,
      phase,
      lastWatts: watts,
      wattsAverage,
      finishedAt,
    };
  });

  const ranked = [...stepped].sort((a, b) => {
    if (a.finishedAt && b.finishedAt) {
      return a.finishedAt - b.finishedAt;
    }

    if (a.finishedAt) {
      return -1;
    }

    if (b.finishedAt) {
      return 1;
    }

    return b.distance - a.distance;
  });

  const rankByPlayer = new Map(ranked.map((rider, index) => [rider.playerId, index + 1]));
  return stepped.map((rider) => ({
    ...rider,
    rank: rankByPlayer.get(rider.playerId) ?? rider.rank,
  }));
}
