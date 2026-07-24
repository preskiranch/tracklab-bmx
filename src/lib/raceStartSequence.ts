export const liveRaceStagingSeconds = 20;

export type RaceStagingStep = {
  delayMs: number;
  secondsRemaining: number;
};

export function createRaceStagingSteps(totalSeconds = liveRaceStagingSeconds): RaceStagingStep[] {
  const safeSeconds = Math.max(1, Math.round(totalSeconds));
  return Array.from({ length: safeSeconds }, (_, index) => ({
    delayMs: index * 1000,
    secondsRemaining: safeSeconds - index,
  }));
}

export function raceStagingDurationMs(totalSeconds = liveRaceStagingSeconds) {
  return Math.max(1, Math.round(totalSeconds)) * 1000;
}
