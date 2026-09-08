import { describe, it, expect } from 'vitest';
import { advanceReactionSeries } from '../../cloud/reactionTest.mjs';
const attempt = (id: number, ms = 100, falseStart = false) => ({
  id: `attempt-${id}`, seriesId: 'practice-series-1',
  startedAt: 1000, recordedAt: 1000 + ms, startedAtEpoch: 10000 + id * 1000,
  recordedAtEpoch: 10000 + id * 1000 + ms,
  reactionTimeMs: falseStart ? null : ms, cadenceDelayMs: 100,
  stage: falseStart ? 'too-early' : 'red', rating: falseStart ? 'false-start' : 'excellent',
  valid: !falseStart, falseStart, late: false,
});
describe('three-attempt reaction series', () => {
  it('scores disjoint groups and averages all three measured times', () => {
    const one = advanceReactionSeries({}, attempt(1, 100));
    const two = advanceReactionSeries(one.state, attempt(2, 200));
    const three = advanceReactionSeries(two.state, attempt(3, 300));
    expect(one.averageMs).toBeNull(); expect(two.averageMs).toBeNull();
    expect(three.averageMs).toBe(200); expect(three.state.times).toEqual([]);
    expect(advanceReactionSeries(three.state, attempt(4)).averageMs).toBeNull();
  });
  it('resets the group on a false start and a new practice session', () => {
    const one = advanceReactionSeries({}, attempt(1));
    const two = advanceReactionSeries(one.state, attempt(2));
    const reset = advanceReactionSeries(two.state, attempt(3, 0, true));
    expect(reset.state.times).toEqual([]);
    expect(advanceReactionSeries(reset.state, attempt(4)).averageMs).toBeNull();
    expect(advanceReactionSeries(two.state, { ...attempt(5), seriesId: 'another-series' }).state.times).toEqual([100]);
  });
  it('does not complete a series using a late out-of-order result', () => {
    const state = advanceReactionSeries({}, attempt(2)).state;
    expect(advanceReactionSeries(state, attempt(1)).state.times).toEqual([]);
  });
});
