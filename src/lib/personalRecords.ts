import type { GhostLap, PlayerId, PlayerSlot } from '../types';

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
