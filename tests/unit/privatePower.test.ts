import { describe, expect, it } from 'vitest';
import { redactPrivatePower } from '../../src/lib/privatePower';

describe('private power redaction', () => {
  it('removes power fields recursively without changing the private source record', () => {
    const source = {
      riderName: 'Rider One',
      watts: 940,
      summary: {
        topWatts: 1_220,
        averagePower: 640,
        cadence: 176,
      },
      zones: [{ maxPower: 1_100, speedKph: 42 }],
      deviceLabel: 'WattbikePM25043950',
    };

    expect(redactPrivatePower(source)).toEqual({
      riderName: 'Rider One',
      summary: { cadence: 176 },
      zones: [{ speedKph: 42 }],
      deviceLabel: 'WattbikePM25043950',
    });
    expect(source.watts).toBe(940);
    expect(source.summary.topWatts).toBe(1_220);
  });
});
