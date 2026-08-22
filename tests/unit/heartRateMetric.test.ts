import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HeartRateMetric, heartRateReadingState, liveHeartRateFreshnessMs } from '../../src/components/HeartRateMetric';
import { HeartRateSettingsCard } from '../../src/components/HeartRateSettingsCard';

describe('HeartRateMetric', () => {
  it('shows a fresh physiological reading as live BPM', () => {
    expect(heartRateReadingState(153.4, 9_000, 10_000)).toEqual({
      state: 'live',
      bpm: 153,
      detail: 'Live now',
    });
    const html = renderToStaticMarkup(createElement(HeartRateMetric, {
      bpm: 153.4,
      recordedAt: 9_000,
      now: 10_000,
    }));
    expect(html).toContain('153 beats per minute');
    expect(html).toContain('data-heart-rate-state="live"');
  });

  it('never presents a stale reading as live', () => {
    const reading = heartRateReadingState(171, 1_000, 1_000 + liveHeartRateFreshnessMs + 1);
    expect(reading.state).toBe('stale');
    expect(reading.bpm).toBeNull();
  });

  it('renders missing and implausible values as an em dash instead of zero BPM', () => {
    for (const bpm of [null, 0, 261, Number.NaN]) {
      const html = renderToStaticMarkup(createElement(HeartRateMetric, { bpm, recordedAt: 10_000, now: 10_000 }));
      expect(html).toContain('No recent reading');
      expect(html).not.toContain('0 beats per minute');
    }
  });
});

describe('HeartRateSettingsCard', () => {
  it('keeps both studio-sharing choices explicit and separate from Friends', () => {
    const html = renderToStaticMarkup(createElement(HeartRateSettingsCard, {
      availability: {
        version: 1,
        supported: true,
        platform: 'iphone',
        paired: true,
        watchAppInstalled: true,
        healthDataAvailable: true,
        minimumIOS: '17.0',
        minimumWatchOS: '10.0',
      },
      status: { version: 1, state: 'active', sessionId: 'watch-block:test', at: 10_000 },
      readingState: 'live',
      latest: { source: 'apple-watch', sessionId: 'watch-block:test', sequence: 1, bpm: 150, recordedAt: 10_000, receivedAt: 10_000 },
      onStart: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onEnd: () => undefined,
      onRetry: () => undefined,
      studioSharing: {
        clubName: 'Preski Ranch',
        liveConsent: false,
        sessionConsent: false,
        onLiveConsentChange: () => undefined,
        onSessionConsentChange: () => undefined,
      },
    }));
    expect(html).toContain('Share live BPM');
    expect(html).toContain('Share the session summary');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('do not change Friends access');
    expect(html).not.toContain('checked=""');
  });

  it('labels the read-only details as Watch status beside Watch Connect', () => {
    const html = renderToStaticMarkup(createElement(HeartRateSettingsCard, {
      availability: null,
      status: null,
      readingState: 'checking',
      latest: null,
      showWorkoutActions: false,
      onStart: () => undefined,
      onPause: () => undefined,
      onResume: () => undefined,
      onEnd: () => undefined,
      onRetry: () => undefined,
    }));
    expect(html).toContain('Connection details');
    expect(html).toContain('Watch status');
    expect(html).not.toContain('<h2 id="heart-rate-settings-heading">Apple Watch heart rate</h2>');
  });
});
