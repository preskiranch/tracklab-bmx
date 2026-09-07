import type { ReactionTestStage, ReactionTestResult } from './reactionTest';

export const reactionTreeStages = ['red', 'yellow-1', 'yellow-2', 'green'] as const;
export type ReactionTreeLamp = typeof reactionTreeStages[number];

/** Keep the recorded lamp highlighted while the live cadence continues to green. */
export function reactionTreeLampState(lamp: ReactionTreeLamp, active: ReactionTestStage, stopped: ReactionTestResult['stage'] | null) {
  if (stopped === 'too-early') return 'dim';
  if (lamp === stopped) return 'stopped';
  return reactionTreeStages.indexOf(lamp) <= reactionTreeStages.indexOf(active as ReactionTreeLamp) ? 'lit' : 'dim';
}
