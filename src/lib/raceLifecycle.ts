import { bmxSpeedKphFromCadence } from '../game/bmxRollout';
import type { BikeSample, PlayerSlot, RiderState } from '../types';

export const raceFinishCountdownMs = 10_000;
export const falseStartResetCountdownMs = 5000;
export const falseStartSpeedThresholdKph = 1.609344;
export const falseStartSampleFreshMs = 1800;

export type FalseStartDetection = {
  playerId: PlayerSlot['id'];
  playerName: string;
  deviceId: number;
  speedKph: number;
  source: 'speed' | 'cadence';
};

function metricIsFreshFromCadence(
  sample: BikeSample,
  metricAt: number | undefined,
  cadenceStartedAt: number,
  now: number,
) {
  const recordedAt = metricAt ?? sample.at;
  return recordedAt >= cadenceStartedAt && now - recordedAt <= falseStartSampleFreshMs;
}

export function detectFalseStart(
  players: PlayerSlot[],
  samplesByDevice: Map<number, BikeSample>,
  cadenceStartedAt: number,
  now = Date.now(),
): FalseStartDetection | null {
  if (cadenceStartedAt <= 0) {
    return null;
  }

  for (const player of players) {
    if (player.deviceId == null) {
      continue;
    }

    const sample = samplesByDevice.get(player.deviceId);
    if (!sample) {
      continue;
    }

    if (
      sample.speedKph != null
      && Number.isFinite(sample.speedKph)
      && metricIsFreshFromCadence(sample, sample.speedAt, cadenceStartedAt, now)
      && sample.speedKph >= falseStartSpeedThresholdKph
    ) {
      return {
        playerId: player.id,
        playerName: player.name,
        deviceId: player.deviceId,
        speedKph: sample.speedKph,
        source: 'speed',
      };
    }

    const cadenceSpeedKph = bmxSpeedKphFromCadence(sample.cadence);
    if (
      sample.cadence != null
      && Number.isFinite(sample.cadence)
      && metricIsFreshFromCadence(sample, sample.cadenceAt, cadenceStartedAt, now)
      && cadenceSpeedKph >= falseStartSpeedThresholdKph
    ) {
      return {
        playerId: player.id,
        playerName: player.name,
        deviceId: player.deviceId,
        speedKph: cadenceSpeedKph,
        source: 'cadence',
      };
    }
  }

  return null;
}

export function nextRaceFinishDeadline(
  currentDeadline: number | null,
  riders: RiderState[],
  now = Date.now(),
) {
  if (currentDeadline != null) {
    return currentDeadline;
  }

  return riders.some((rider) => rider.finishedAt != null)
    ? now + raceFinishCountdownMs
    : null;
}

export function countdownSeconds(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
