import { describe, expect, it } from 'vitest';
import {
  clubGroupCompletionIsTimely,
  clubGroupTrainingCompletionGraceMs,
} from '../../cloud/persistence.mjs';

describe('club group durable completion timing', () => {
  it('accepts exact activated results after 30 minutes but not after the 24-hour grace', () => {
    const expiresAt = 2_000_000_000_000;
    const authorization = {
      expiresAt,
      cancelledAt: null,
      assignments: [{
        startedAt: expiresAt - 10_000,
        activatedAt: expiresAt - 9_900,
      }],
    };
    const completions = [{ session: { endedAt: expiresAt - 1_000 } }];

    expect(clubGroupTrainingCompletionGraceMs).toBe(24 * 60 * 60 * 1_000);
    expect(clubGroupCompletionIsTimely(
      authorization,
      completions,
      expiresAt + 31 * 60_000,
    )).toBe(true);
    expect(clubGroupCompletionIsTimely(
      authorization,
      completions,
      expiresAt + clubGroupTrainingCompletionGraceMs,
    )).toBe(true);
    expect(clubGroupCompletionIsTimely(
      authorization,
      completions,
      expiresAt + clubGroupTrainingCompletionGraceMs + 1,
    )).toBe(false);
  });

  it('rejects cancelled, late-started, and late-ended payloads during completion grace', () => {
    const expiresAt = 2_000_000_000_000;
    const base = {
      expiresAt,
      cancelledAt: null,
      assignments: [{ startedAt: expiresAt - 100, activatedAt: expiresAt - 50 }],
    };
    const now = expiresAt + 60 * 60_000;

    expect(clubGroupCompletionIsTimely(
      { ...base, cancelledAt: expiresAt - 1 },
      [{ session: { endedAt: expiresAt - 1 } }],
      now,
    )).toBe(false);
    expect(clubGroupCompletionIsTimely(
      { ...base, assignments: [{ startedAt: expiresAt + 1, activatedAt: expiresAt - 50 }] },
      [{ session: { endedAt: expiresAt - 1 } }],
      now,
    )).toBe(false);
    expect(clubGroupCompletionIsTimely(
      base,
      [{ session: { endedAt: expiresAt + 1 } }],
      now,
    )).toBe(false);
  });
});
