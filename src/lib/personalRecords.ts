import type { GhostLap, PersonalRecords, PlayerId, PlayerSlot } from '../types';

export const getPulledMaxWattsLimit = 5_000;

export type PreviousPersonalBestTimes = Partial<Record<PlayerId, number>>;

export type PersonalRecordAchievement = {
  playerId: PlayerId;
  finishTimeMs: number;
  previousBestMs: number;
  improvementMs: number;
};

export type PersonalRecordAchievements = Partial<Record<PlayerId, PersonalRecordAchievement>>;

type RiderFinish = {
  playerId: PlayerId;
  finishTimeMs: number | null;
};

function normalizedPositiveInteger(value: unknown, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded > 0 && rounded <= maximum ? rounded : null;
}

/** Keep the private max-watts record small, numeric, and safe to sync. */
export function normalizePersonalRecords(value: unknown): PersonalRecords | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<PersonalRecords>;
  const watts = normalizedPositiveInteger(candidate.getPulledMaxWatts, getPulledMaxWattsLimit);
  const updatedAtValue = Number(candidate.getPulledMaxWattsUpdatedAt);
  const updatedAt = Number.isFinite(updatedAtValue) && updatedAtValue > 0
    ? Math.round(updatedAtValue)
    : undefined;
  const source = candidate.getPulledMaxWattsSource === 'recorded' || candidate.getPulledMaxWattsSource === 'manual'
    ? candidate.getPulledMaxWattsSource
    : undefined;
  if (watts == null) return undefined;
  return {
    getPulledMaxWatts: watts,
    ...(source ? { getPulledMaxWattsSource: source } : {}),
    ...(updatedAt ? { getPulledMaxWattsUpdatedAt: updatedAt } : {}),
  };
}

export function getPulledMaxWatts(records: PersonalRecords | null | undefined) {
  return normalizedPositiveInteger(records?.getPulledMaxWatts, getPulledMaxWattsLimit);
}

export function setManualGetPulledPersonalRecord(value: number | null, now = Date.now()): PersonalRecords | undefined {
  const watts = normalizedPositiveInteger(value, getPulledMaxWattsLimit);
  if (watts == null) return undefined;
  return {
    getPulledMaxWatts: watts,
    getPulledMaxWattsSource: 'manual',
    getPulledMaxWattsUpdatedAt: Math.max(1, Math.round(now)),
  };
}

/** Only a recorded value that beats the existing benchmark may raise it. */
export function recordGetPulledPersonalBest(
  records: PersonalRecords | null | undefined,
  peakWatts: number,
  now = Date.now(),
): PersonalRecords | undefined {
  const watts = normalizedPositiveInteger(peakWatts, getPulledMaxWattsLimit);
  if (watts == null) return normalizePersonalRecords(records);
  const current = normalizePersonalRecords(records);
  if (current?.getPulledMaxWatts != null && watts <= current.getPulledMaxWatts) return current;
  return {
    ...(current ?? {}),
    getPulledMaxWatts: watts,
    getPulledMaxWattsSource: 'recorded',
    getPulledMaxWattsUpdatedAt: Math.max(1, Math.round(now)),
  };
}

function normalizeRiderName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function previousPersonalBestTimes(
  players: PlayerSlot[],
  ghosts: GhostLap[],
  ownerKey: string,
): PreviousPersonalBestTimes {
  const ghostsByRider = new Map<string, number>();

  ghosts.forEach((ghost) => {
    if (
      ghost.ownerKey !== ownerKey
      || ghost.raceSource !== 'live'
      || !Number.isFinite(ghost.finishTimeMs)
      || ghost.finishTimeMs <= 0
    ) {
      return;
    }

    const riderName = normalizeRiderName(ghost.riderName);
    const currentBest = ghostsByRider.get(riderName);
    if (currentBest == null || ghost.finishTimeMs < currentBest) {
      ghostsByRider.set(riderName, ghost.finishTimeMs);
    }
  });

  return players.reduce<PreviousPersonalBestTimes>((bestTimes, player) => {
    const previousBest = ghostsByRider.get(normalizeRiderName(player.name));
    if (previousBest != null) {
      bestTimes[player.id] = previousBest;
    }
    return bestTimes;
  }, {});
}

export function personalRecordAchievements(
  finishes: RiderFinish[],
  previousBestTimes: PreviousPersonalBestTimes,
): PersonalRecordAchievements {
  return finishes.reduce<PersonalRecordAchievements>((achievements, finish) => {
    const previousBestMs = previousBestTimes[finish.playerId];
    if (
      finish.finishTimeMs == null
      || !Number.isFinite(finish.finishTimeMs)
      || finish.finishTimeMs <= 0
      || previousBestMs == null
      || finish.finishTimeMs >= previousBestMs
    ) {
      return achievements;
    }

    achievements[finish.playerId] = {
      playerId: finish.playerId,
      finishTimeMs: finish.finishTimeMs,
      previousBestMs,
      improvementMs: previousBestMs - finish.finishTimeMs,
    };
    return achievements;
  }, {});
}
