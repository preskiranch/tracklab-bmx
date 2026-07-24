import { describe, expect, it } from 'vitest';
import { createCommentaryCapacity } from '../../cloud/commentaryCapacity.mjs';

describe('commentary generation capacity', () => {
  it('bounds expensive AI work and restores capacity after release', () => {
    const capacity = createCommentaryCapacity(2);
    const releaseFirst = capacity.tryAcquire();
    const releaseSecond = capacity.tryAcquire();

    expect(capacity.active).toBe(2);
    expect(capacity.tryAcquire()).toBeNull();

    releaseFirst?.();
    expect(capacity.active).toBe(1);
    expect(capacity.tryAcquire()).toBeTypeOf('function');

    releaseSecond?.();
  });

  it('makes release idempotent', () => {
    const capacity = createCommentaryCapacity(1);
    const release = capacity.tryAcquire();

    release?.();
    release?.();

    expect(capacity.active).toBe(0);
    expect(capacity.tryAcquire()).toBeTypeOf('function');
  });
});
