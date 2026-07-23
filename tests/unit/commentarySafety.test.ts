import { describe, expect, it } from 'vitest';
import {
  commentaryLineMentionsRider,
  commentaryLineUsesDemeaningSarcasm,
  commentaryLineUsesForbiddenTelemetry,
} from '../../cloud/commentarySafety.mjs';

describe('commentary rider-name safety', () => {
  it('does not mistake a real rider name for forbidden race telemetry', () => {
    const riderNames = ['Miles Power', 'Cadence Watts'];

    expect(commentaryLineUsesForbiddenTelemetry(
      'Miles Power leads Cadence Watts into turn one.',
      riderNames,
    )).toBe(false);
    expect(commentaryLineUsesForbiddenTelemetry(
      'Miles Power is holding 120 RPM.',
      riderNames,
    )).toBe(true);
  });

  it('recognizes full and shortened rider-name calls', () => {
    const riderNames = ['Maya Torres', 'Jordan Lee'];

    expect(commentaryLineMentionsRider('Maya takes over in the rhythm section.', riderNames)).toBe(true);
    expect(commentaryLineMentionsRider('The leader takes over in the rhythm section.', riderNames)).toBe(false);
  });

  it('allows playful race wit but rejects insults or crash jokes', () => {
    expect(commentaryLineUsesDemeaningSarcasm(
      'Apparently calm missed this race entirely.',
    )).toBe(false);
    expect(commentaryLineUsesDemeaningSarcasm(
      'That rider is pathetic and does not belong.',
    )).toBe(true);
    expect(commentaryLineUsesDemeaningSarcasm(
      'A hilarious crash for the rider in fourth.',
    )).toBe(true);
  });
});
