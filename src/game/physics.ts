import type { BikeSample, PlayerSlot, RiderState } from '../types';
import { bmxVelocityMpsFromCadence } from './bmxRollout';
import { crossedTakeoff, surfaceAngleDeg } from './trackProfile';

const gravityPx = 430;
const groundRecoveryPerSecond = 4.2;
const maxAirPx = 34;
const liveMetricWindowMs = 1800;
const rollingFrictionMps2 = 0.42;
const airDragPerMeter = 0.0038;
const stopVelocityMps = 0.04;
const freewheelEngagementToleranceMps = 0.05;
const effectiveRiderBikeMassKg = 86;
const drivetrainEfficiency = 0.88;
const minimumDriveAccelerationMps2 = 0.55;
const maxDriveAccelerationMps2 = 7.5;
const lowSpeedLaunchBonusMps2 = 2.2;

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

function coastVelocityMps(velocityMps: number, dt: number) {
  const drag = rollingFrictionMps2 + velocityMps * velocityMps * airDragPerMeter;
  return Math.max(0, velocityMps - drag * dt);
}

function driveAccelerationMps2(watts: number, velocityMps: number, targetVelocityMps: number, boost: number) {
  const speedForPower = Math.max(1.2, velocityMps);
  const powerAcceleration = watts > 0
    ? watts * drivetrainEfficiency / (effectiveRiderBikeMassKg * speedForPower)
    : minimumDriveAccelerationMps2;
  const cadenceAcceleration = Math.max(0, (targetVelocityMps - velocityMps) * 1.35);
  const launchBonus = velocityMps < 2.5
    ? (1 - velocityMps / 2.5) * lowSpeedLaunchBonusMps2
    : 0;

  return clamp(
    Math.max(powerAcceleration + launchBonus + boost * 0.45, cadenceAcceleration),
    minimumDriveAccelerationMps2,
    maxDriveAccelerationMps2,
  );
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

    const wattsAverage = rider.wattsAverage * 0.94 + watts * 0.06;
    const sprintSpike = watts > Math.max(260, wattsAverage + 135);
    const boost = Math.max(0, Math.min(1, rider.boost + (sprintSpike ? 0.22 : -0.7 * dt)));
    const coastVelocity = coastVelocityMps(rider.velocity, dt);
    const cadenceVelocity = cadence > 0 ? bmxVelocityMpsFromCadence(cadence) : null;
    const driveEngaged = cadenceVelocity != null && cadenceVelocity > coastVelocity + freewheelEngagementToleranceMps;
    const velocity = driveEngaged
      ? Math.min(cadenceVelocity, coastVelocity + driveAccelerationMps2(watts, coastVelocity, cadenceVelocity, boost) * dt)
      : coastVelocity;
    const settledVelocity = velocity < stopVelocityMps && !driveEngaged ? 0 : velocity;
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
