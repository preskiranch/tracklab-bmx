type PodiumTrophyProps = {
  rank: number;
  className?: string;
};

const trophies = [
  ['/assets/trophies/first-place-gold.png', 'First place gold cup'],
  ['/assets/trophies/second-place-silver.png', 'Second place silver cup'],
  ['/assets/trophies/third-place-bronze.png', 'Third place bronze cup'],
] as const;

export function PodiumTrophy({ rank, className = '' }: PodiumTrophyProps) {
  const trophy = trophies[rank - 1];
  if (!trophy) {
    return null;
  }

  return (
    <img
      className={`podium-trophy ${className}`}
      src={trophy[0]}
      alt={trophy[1]}
    />
  );
}
