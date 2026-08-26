export type RaceDisplayRankCandidate = Readonly<{
  id: string;
  distanceMeters: number;
  finishedAt: number | null;
  rank: number;
  disqualified?: boolean;
}>;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Produces one display-only, contiguous ranking across local, remote, and
 * ghost riders. False starters remain visible but never receive a place.
 */
export function normalizedRaceDisplayRanks(candidates: RaceDisplayRankCandidate[]) {
  const eligible = candidates
    .filter((candidate) => !candidate.disqualified)
    .sort((left, right) => {
      const leftFinished = left.finishedAt != null;
      const rightFinished = right.finishedAt != null;
      if (leftFinished !== rightFinished) return leftFinished ? -1 : 1;
      if (leftFinished && rightFinished) {
        const finishDifference = finite(left.finishedAt!, Number.MAX_SAFE_INTEGER)
          - finite(right.finishedAt!, Number.MAX_SAFE_INTEGER);
        if (finishDifference !== 0) return finishDifference;
      }
      const distanceDifference = finite(right.distanceMeters, 0) - finite(left.distanceMeters, 0);
      if (distanceDifference !== 0) return distanceDifference;
      const rankDifference = finite(left.rank, Number.MAX_SAFE_INTEGER)
        - finite(right.rank, Number.MAX_SAFE_INTEGER);
      return rankDifference || left.id.localeCompare(right.id);
    });

  return new Map(eligible.map((candidate, index) => [candidate.id, index + 1]));
}
