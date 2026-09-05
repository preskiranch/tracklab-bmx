import { describe, expect, it } from 'vitest';
import { reactionTreeLampState, reactionTreeStages } from '../../src/lib/reactionTree';

describe('reaction tree captured light', () => {
  it.each(reactionTreeStages)('keeps only %s bright after the cadence advances to green', (stopped) => {
    const states = reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'green', stopped));
    expect(states.filter(state => state === 'stopped')).toHaveLength(1);
    expect(states[reactionTreeStages.indexOf(stopped)]).toBe('stopped');
    expect(states.filter(state => state === 'dim')).toHaveLength(3);
  });
  it('does not assign a light to a false start', () => {
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'idle', 'too-early'))).toEqual(['dim', 'dim', 'dim', 'dim']);
  });
  it('resets the recorded glow and follows the next cadence', () => {
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'idle', null))).toEqual(['dim', 'dim', 'dim', 'dim']);
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'yellow-1', null))).toEqual(['lit', 'lit', 'dim', 'dim']);
  });
});
