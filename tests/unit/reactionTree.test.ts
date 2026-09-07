import { describe, expect, it } from 'vitest';
import { reactionTreeLampState, reactionTreeStages } from '../../src/lib/reactionTree';

describe('reaction tree captured light', () => {
  it.each(reactionTreeStages)('keeps %s highlighted while the remaining lamps advance to green', (stopped) => {
    const states = reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'green', stopped));
    expect(states.filter(state => state === 'stopped')).toHaveLength(1);
    expect(states[reactionTreeStages.indexOf(stopped)]).toBe('stopped');
    expect(states.filter(state => state === 'lit')).toHaveLength(3);
  });
  it('continues each cue after a red reaction without lighting future cues early', () => {
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'red', 'red'))).toEqual(['stopped', 'dim', 'dim', 'dim']);
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'yellow-1', 'red'))).toEqual(['stopped', 'lit', 'dim', 'dim']);
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'yellow-2', 'red'))).toEqual(['stopped', 'lit', 'lit', 'dim']);
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'green', 'red'))).toEqual(['stopped', 'lit', 'lit', 'lit']);
  });
  it('does not assign a light to a false start', () => {
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'idle', 'too-early'))).toEqual(['dim', 'dim', 'dim', 'dim']);
  });
  it('resets the recorded glow and follows the next cadence', () => {
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'idle', null))).toEqual(['dim', 'dim', 'dim', 'dim']);
    expect(reactionTreeStages.map(lamp => reactionTreeLampState(lamp, 'yellow-1', null))).toEqual(['lit', 'lit', 'dim', 'dim']);
  });
});
