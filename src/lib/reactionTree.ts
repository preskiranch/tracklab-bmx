import type { ReactionTestStage, ReactionTestResult } from './reactionTest';

export const reactionTreeStages = ['red', 'yellow-1', 'yellow-2', 'green'] as const;
export type ReactionTreeLamp = typeof reactionTreeStages[number];

/** A captured result owns the display even while the remaining cadence finishes. */
export function reactionTreeLampState(lamp: ReactionTreeLamp, active: ReactionTestStage, stopped: ReactionTestResult['stage'] | null) {
  if (stopped !== null) return lamp === stopped ? 'stopped' : 'dim';
  return reactionTreeStages.indexOf(lamp) <= reactionTreeStages.indexOf(active as ReactionTreeLamp) ? 'lit' : 'dim';
}
