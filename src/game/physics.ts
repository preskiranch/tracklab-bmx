import { proSplitMinimumMph, type SplitRouteDecisionPoint } from '../lib/trackMapping';
import { cleanBikeCadenceRpm, cleanBikeSpeedKph, cleanBikeWatts } from '../lib/bikeSampleSanity';
import type { BikeSample, PlayerSlot, RiderDriveSource, RiderState, SplitBranchChoice, TrackZone } from '../types';
import { bmxVelocityMpsFromCadence } from './bmxRollout';
import { crossedTakeoff, surfaceAngleDeg } from './trackProfile';

const gravityPx = 430;
const groundRecoveryPerSecond = 4.2;
const maxAirPx = 34;
// Wattbike BLE characteristics are delivered independently. A cadence value can
// therefore remain unchanged while a fresh power or speed packet proves that the
// bike is still connected and reporting. Keep a normal three-second packet window
// so a rider does not coast between those partial updates.
const liveMetricWindowMs = 3000;
const liveRaceStartSampleGraceMs = 0;
const rollingFrictionMps2 = 0.42;
const airDragPerMeter = 0.0038;
const stopVelocityMps = 0.04;
const freewheelEngagementToleranceMps = 0.05;
// The first post-gate Wattbike signal is often a single low-watt packet. The
// start gate already rejects pre-gate noise, so let any positive live wattage
// begin the rider response immediately.
const minimumRaceDriveWatts = 1;
const minimumRaceDriveCadenceRpm = 1;
const minimumRaceDriveSpeedKph = 1.609344;
const initialLaunchResponseMps = 0.6;
const maxBmxRaceVelocityMps = 13.4;
const effectiveRiderBikeMassKg = 86;
const drivetrainEfficiency = 0.88;
const minimumDriveAccelerationMps2 = 0.55;
const maxDriveAccelerationMps2 = 9.8;
const lowSpeedLaunchBonusMps2 = 3.2;
const gateLaunchWindowMs = 1650;
const gateLaunchBonusMps2 = 1.6;
const demoThirtyFootTargetMs = 1680;
const demoGateLaunchBonusMps2 = 7.1;
const demoMaxDriveAccelerationMps2 = 14.2;
const thirtyFootSplitMeters = 30 * 0.3048;
const metersPerSecondPerMph = 0.44704;
const proSplitMinimumMps = proSplitMinimumMph * metersPerSecondPerMph;
const proSplitPenaltyMps = 1 * metersPerSecondPerMph;

export type BranchChoicesByPlayer = Partial<Record<PlayerSlot['id'], SplitBranchChoice>>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function metricIsUsable(sample: BikeSample | null | undefined, metricAt: number | undefined, nowMs: number, raceStartedAt: number) {
  if (!sample) {
    return false;
  }

  const metricRecordedAt = metricAt ?? sample.at;
  // The value itself must have been captured after the start gate. A later packet
  // must not make a pre-gate cadence or power value eligible for a false start.
  if (metricRecordedAt < raceStartedAt - liveRaceStartSampleGraceMs) {
    return false;
  }

  // Once a post-gate metric is eligible, the newest packet receipt can safely
  // keep it live. Direct BLE updates intentionally retain values that were not
  // included in the latest characteristic, while `sample.at` advances for each
  // fresh motion packet.
  const latestPacketAt = Math.max(metricRecordedAt, sample.at);
  return nowMs - latestPacketAt <= liveMetricWindowMs;
}

function wattsFallbackVelocityMps(watts: number, currentVelocityMps: number) {
  if (watts <= 0) {
    return null;
  }

  // Wattbike BLE/ANT packets do not always include cadence every frame. Use power as
  // a target-speed fallback, but never ratchet the target above what the wattage supports.
  return clamp(Math.sqrt(watts) * 0.32, 0, maxBmxRaceVelocityMps);
}

function coastVelocityMps(velocityMps: number, dt: number) {
  const drag = rollingFrictionMps2 + velocityMps * velocityMps * airDragPerMeter;
  return Math.max(0, velocityMps - drag * dt);
}

type ZoneDriveContext = {
  activeZone: TrackZone | undefined;
  pedalZonesConfigured: boolean;
};

function branchSelectionCount(zone: TrackZone) {
  let count = 0;
  for (const _splitId in zone.branchSelections ?? {}) {
    count += 1;
  }
  return count;
}

function riderDistanceInZoneCoordinates(
  zone: TrackZone,
  distanceMeters: number,
  actualBranches: Record<string, SplitBranchChoice>,
  selectedBranch: SplitBranchChoice,
  splitDecisionPoints: SplitRouteDecisionPoint[],
) {
  let riderRouteOffsetMeters = 0;
  let zoneRouteOffsetMeters = 0;

  for (const split of splitDecisionPoints) {
    const riderBranch = actualBranches[split.id] ?? selectedBranch;
    const zoneBranch = zone.branchSelections?.[split.id] ?? 'a';
    const amateurBranchLength = split.branchLengthByBranch.a;
    const riderBranchLength = split.branchLengthByBranch[riderBranch];
    const zoneBranchLength = split.branchLengthByBranch[zoneBranch];
    const riderSplitMeter = split.splitMeter + riderRouteOffsetMeters;
    const zoneSplitMeter = split.splitMeter + zoneRouteOffsetMeters;
    const riderMergeMeter = riderSplitMeter + riderBranchLength;

    if (distanceMeters < riderSplitMeter) {
      return distanceMeters + zoneRouteOffsetMeters - riderRouteOffsetMeters;
    }

    if (distanceMeters < riderMergeMeter) {
      if (riderBranch !== zoneBranch) {
        return null;
      }
      return distanceMeters + zoneSplitMeter - riderSplitMeter;
    }

    riderRouteOffsetMeters += riderBranchLength - amateurBranchLength;
    zoneRouteOffsetMeters += zoneBranchLength - amateurBranchLength;
  }

  return distanceMeters + zoneRouteOffsetMeters - riderRouteOffsetMeters;
}

function zoneDriveContext(
  zones: TrackZone[],
  distanceMeters: number,
  actualBranches: Record<string, SplitBranchChoice>,
  selectedBranch: SplitBranchChoice,
  splitDecisionPoints: SplitRouteDecisionPoint[],
): ZoneDriveContext {
  let activeZone: TrackZone | undefined;
  let activeZoneSpecificity = -1;
  const pedalZonesConfigured = zones.some((zone) => zone.type === 'pedal');

  for (const zone of zones) {
    const zoneDistanceMeters = riderDistanceInZoneCoordinates(
      zone,
      distanceMeters,
      actualBranches,
      selectedBranch,
      splitDecisionPoints,
    );
    if (zoneDistanceMeters == null) {
      continue;
    }

    if (zoneDistanceMeters < zone.startMeter || zoneDistanceMeters >= zone.endMeter) {
      continue;
    }

    const specificity = branchSelectionCount(zone);
    if (specificity > activeZoneSpecificity) {
      activeZone = zone;
      activeZoneSpecificity = specificity;
    }
  }

  return { activeZone, pedalZonesConfigured };
}

function zoneAllowsDrive(
  zone: TrackZone | undefined,
  pedalZonesConfigured: boolean,
) {
  if (pedalZonesConfigured) {
    return zone?.type === 'pedal';
  }

  return !zone || zone.type === 'pedal';
}

function driveAccelerationMps2(
  watts: number,
  velocityMps: number,
  targetVelocityMps: number,
  boost: number,
  gateLaunch: number,
  demoLaunchAssist: number,
) {
  const speedForPower = Math.max(1.2, velocityMps);
  const powerAcceleration = watts > 0
    ? watts * drivetrainEfficiency / (effectiveRiderBikeMassKg * speedForPower)
    : minimumDriveAccelerationMps2;
  const cadenceAcceleration = Math.max(0, (targetVelocityMps - velocityMps) * 1.35);
  const launchBonus = velocityMps < 2.5
    ? (1 - velocityMps / 2.5) * lowSpeedLaunchBonusMps2
    : 0;

  return clamp(
    Math.max(
      powerAcceleration
        + launchBonus
        + gateLaunch * gateLaunchBonusMps2
        + demoLaunchAssist * demoGateLaunchBonusMps2
        + boost * 0.45,
      cadenceAcceleration,
    ),
    minimumDriveAccelerationMps2,
    demoLaunchAssist > 0 ? demoMaxDriveAccelerationMps2 : maxDriveAccelerationMps2,
  );
}

function interpolateSplitTimeMs(
  previousDistance: number,
  distance: number,
  splitMeters: number,
  frameSeconds: number,
  elapsedMs: number,
) {
  if (distance <= previousDistance) {
    return Math.max(0, Math.round(elapsedMs));
  }

  const frameMs = frameSeconds * 1000;
  const frameStartMs = Math.max(0, elapsedMs - frameMs);
  const crossingRatio = clamp((splitMeters - previousDistance) / (distance - previousDistance), 0, 1);
  return Math.round(frameStartMs + crossingRatio * frameMs);
}

export function createInitialRiders(
  players: PlayerSlot[],
  branchChoicesByPlayer: BranchChoicesByPlayer = {},
): RiderState[] {
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
    lastRawWatts: 0,
    lastRawCadence: 0,
    lastRawSpeedKph: 0,
    driveAllowed: true,
    driveSource: 'coast',
    wattsAverage: 160,
    rank: player.id,
    thirtyFootTimeMs: null,
    finishedAt: null,
    selectedBranch: branchChoicesByPlayer[player.id] ?? 'a',
    actualBranches: {},
    proPenaltySections: {},
  }));
}

export function stepRiders(
  riders: RiderState[],
  players: PlayerSlot[],
  samplesByDevice: Map<number, BikeSample>,
  dt: number,
  raceStartedAt: number,
  raceLengthMeters: number,
  branchChoicesByPlayer: BranchChoicesByPlayer = {},
  splitDecisionPoints: SplitRouteDecisionPoint[] = [],
  trackZones: TrackZone[] = [],
  nowMs = Date.now(),
  inputAllowedAt = raceStartedAt,
): RiderState[] {
  const stepped = riders.map((rider) => {
    if (rider.finishedAt != null) {
      return rider;
    }

    const player = players.find((slot) => slot.id === rider.playerId);
    const sample = player?.deviceId == null ? null : samplesByDevice.get(player.deviceId);
    const elapsedMs = nowMs - raceStartedAt;
    const selectedBranch = branchChoicesByPlayer[rider.playerId] ?? rider.selectedBranch ?? 'a';
    let actualBranches = rider.actualBranches;
    let proPenaltySections = rider.proPenaltySections;
    const rawWatts = metricIsUsable(sample, sample?.wattsAt, nowMs, inputAllowedAt)
      ? cleanBikeWatts(sample?.physicsWatts ?? sample?.watts ?? 0) ?? 0
      : 0;
    const rawCadence = metricIsUsable(sample, sample?.cadenceAt, nowMs, inputAllowedAt)
      ? cleanBikeCadenceRpm(sample?.cadence ?? 0) ?? 0
      : 0;
    const rawSpeedKph = metricIsUsable(sample, sample?.speedAt, nowMs, inputAllowedAt)
      ? cleanBikeSpeedKph(sample?.speedKph ?? 0) ?? 0
      : 0;
    const { activeZone, pedalZonesConfigured } = zoneDriveContext(
      trackZones,
      rider.distance,
      actualBranches,
      selectedBranch,
      splitDecisionPoints,
    );
    const driveAllowed = zoneAllowsDrive(activeZone, pedalZonesConfigured);
    const hasPedalingDrive = rawWatts >= minimumRaceDriveWatts
      || rawCadence >= minimumRaceDriveCadenceRpm
      || rawSpeedKph >= minimumRaceDriveSpeedKph;
    const watts = driveAllowed && hasPedalingDrive ? rawWatts : 0;
    const cadence = driveAllowed && hasPedalingDrive ? rawCadence : 0;

    const wattsAverage = rider.wattsAverage * 0.94 + watts * 0.06;
    const sprintSpike = watts > Math.max(260, wattsAverage + 135);
    const boost = Math.max(0, Math.min(1, rider.boost + (sprintSpike ? 0.22 : -0.7 * dt)));
    // A mapped gap between pedal zones represents an obstacle/coasting section.
    // Preserve the exact entry momentum there, and for the first frame back in a
    // pedal zone, so drive resumes from the exit speed without a transition dip.
    const preserveZoneMomentum = !driveAllowed || !rider.driveAllowed;
    const coastVelocity = preserveZoneMomentum
      ? rider.velocity
      : coastVelocityMps(rider.velocity, dt);
    const cadenceVelocity = cadence > 0 ? Math.min(bmxVelocityMpsFromCadence(cadence), maxBmxRaceVelocityMps) : null;
    const powerVelocity = wattsFallbackVelocityMps(watts, coastVelocity);
    const speedVelocity = hasPedalingDrive && rawSpeedKph > 0
      ? Math.min(rawSpeedKph / 3.6, maxBmxRaceVelocityMps)
      : null;
    const targetDriveVelocity = cadenceVelocity ?? powerVelocity ?? speedVelocity;
    const driveEngaged = targetDriveVelocity != null && targetDriveVelocity > coastVelocity + freewheelEngagementToleranceMps;
    const driveSource: RiderDriveSource = !driveAllowed
      ? 'blocked'
      : driveEngaged
        ? cadenceVelocity != null
          ? 'cadence'
          : powerVelocity != null
            ? 'power'
            : 'speed'
        : 'coast';
    const previousDistance = rider.distance;
    const gateLaunch = driveEngaged
      ? clamp(1 - elapsedMs / gateLaunchWindowMs, 0, 1)
      : 0;
    const demoElapsedMs = sample?.source === 'demo' && sample.demoActiveMs != null
      ? sample.demoActiveMs
      : elapsedMs;
    const demoTargetProgress = clamp(demoElapsedMs / demoThirtyFootTargetMs, 0, 1);
    const demoTargetDistance = thirtyFootSplitMeters * demoTargetProgress * demoTargetProgress;
    const demoDistanceDeficit = Math.max(0, demoTargetDistance - previousDistance);
    const demoLaunchAssist = driveEngaged && sample?.source === 'demo' && rider.thirtyFootTimeMs == null
      ? clamp(demoDistanceDeficit / 0.55, 0, 1)
      : 0;
    const acceleratedVelocity = driveEngaged
      ? Math.min(
        targetDriveVelocity,
        coastVelocity + driveAccelerationMps2(
          watts,
          coastVelocity,
          targetDriveVelocity,
          boost,
          gateLaunch,
          demoLaunchAssist,
        ) * dt,
      )
      : coastVelocity;
    const velocity = driveEngaged && previousDistance <= 0.001 && coastVelocity <= 0.001
      ? Math.max(acceleratedVelocity, Math.min(targetDriveVelocity, initialLaunchResponseMps))
      : acceleratedVelocity;
    const baseSettledVelocity = velocity < stopVelocityMps && !driveEngaged ? 0 : velocity;
    let settledVelocity = baseSettledVelocity;
    let predictedDistance = previousDistance + settledVelocity * dt;

    splitDecisionPoints.forEach((split) => {
      if (!actualBranches[split.id] && previousDistance < split.splitMeter && predictedDistance >= split.splitMeter) {
        const actualBranch: SplitBranchChoice = selectedBranch === 'b' && settledVelocity >= proSplitMinimumMps ? 'b' : 'a';
        actualBranches = { ...actualBranches, [split.id]: actualBranch };
      }

      const actualBranch = actualBranches[split.id];
      const onProSet = actualBranch === 'b'
        && previousDistance >= split.splitMeter
        && previousDistance <= split.mergeMeterByBranch.b;
      if (onProSet && !proPenaltySections[split.id] && settledVelocity > 0 && settledVelocity < proSplitMinimumMps) {
        settledVelocity = Math.max(0, settledVelocity - proSplitPenaltyMps);
        proPenaltySections = { ...proPenaltySections, [split.id]: true };
        predictedDistance = previousDistance + settledVelocity * dt;
      }
    });

    const nextDistance = previousDistance + settledVelocity * dt;
    const crossedFinish = previousDistance < raceLengthMeters
      && nextDistance >= raceLengthMeters;
    const distance = nextDistance >= raceLengthMeters ? raceLengthMeters : nextDistance;
    const endZoneContext = zoneDriveContext(
      trackZones,
      distance,
      actualBranches,
      selectedBranch,
      splitDecisionPoints,
    );
    const endDriveAllowed = zoneAllowsDrive(
      endZoneContext.activeZone,
      endZoneContext.pedalZonesConfigured,
    );
    const endDriveSource: RiderDriveSource = !endDriveAllowed
      ? 'blocked'
      : driveSource === 'blocked'
        ? 'coast'
        : driveSource;
    const visibleCadence = endDriveAllowed ? cadence : 0;
    const thirtyFootTimeMs = rider.thirtyFootTimeMs == null
      && previousDistance < thirtyFootSplitMeters
      && distance >= thirtyFootSplitMeters
      ? interpolateSplitTimeMs(previousDistance, distance, thirtyFootSplitMeters, dt, elapsedMs)
      : rider.thirtyFootTimeMs;
    const cadenceRps = visibleCadence / 60;
    const pedalPhase = cadenceRps > 0
      ? (rider.pedalPhase + cadenceRps * dt) % 1
      : 0;

    let air = rider.air;
    let verticalVelocity = rider.verticalVelocity;
    let pitch = rider.pitch;
    let landingCompression = Math.max(0, rider.landingCompression - dt * groundRecoveryPerSecond);
    let phase = rider.phase;

    const takeoff = crossedTakeoff(previousDistance, distance);

    if (phase !== 'airborne' && takeoff && settledVelocity > 2.2 && driveAllowed && cadence > 18) {
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
      pitch = surfaceAngleDeg(distance) + (visibleCadence > 0 ? Math.sin(pedalPhase * Math.PI * 2) * 1.1 : 0);
    }

    const finishedAt = crossedFinish
      ? interpolateSplitTimeMs(previousDistance, nextDistance, raceLengthMeters, dt, elapsedMs)
      : distance >= raceLengthMeters
        ? elapsedMs
        : null;

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
      lastWatts: endDriveAllowed ? watts : 0,
      lastRawWatts: rawWatts,
      lastRawCadence: rawCadence,
      lastRawSpeedKph: rawSpeedKph,
      driveAllowed: endDriveAllowed,
      driveSource: endDriveSource,
      wattsAverage,
      thirtyFootTimeMs,
      finishedAt,
      selectedBranch,
      actualBranches,
      proPenaltySections,
    };
  });

  const ranked = [...stepped].sort((a, b) => {
    if (a.finishedAt != null && b.finishedAt != null) {
      return a.finishedAt - b.finishedAt;
    }

    if (a.finishedAt != null) {
      return -1;
    }

    if (b.finishedAt != null) {
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
