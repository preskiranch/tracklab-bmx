import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudioHeartRateBlockCard } from '../../src/components/StudioHeartRateBlockCard';

const actions = {
  onCreateInvitation: vi.fn(),
  onCopyInvitation: vi.fn(),
  onShareInvitation: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
};

describe('StudioHeartRateBlockCard', () => {
  it('shows a one-time iPhone handoff without receiving or rendering invitation secrets', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockCard, {
      riderName: 'Mason Fleming',
      bikeLabel: 'Bike 2 · Monitor 701',
      state: { phase: 'waiting-athlete' },
      ...actions,
    }));

    expect(markup).toContain('Mason Fleming');
    expect(markup).toContain('Bike 2 · Monitor 701');
    expect(markup).toContain('Waiting for athlete');
    expect(markup).toContain('paired with their Apple Watch');
    expect(markup).toContain('Copy iPhone invite');
    expect(markup).toContain('Share invite');
    expect(markup).toContain('Cancel setup');
    expect(markup).not.toContain('ingestToken');
    expect(markup).not.toContain('saveToken');
    expect(markup).not.toContain('heartRateStudioInvite=');
  });

  it('explains that one ready block covers exact active windows across studio modes', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockCard, {
      riderName: 'Mason Fleming',
      state: { phase: 'watch-ready', liveBpmSharing: false },
      ...actions,
    }));

    expect(markup).toContain('Apple Watch ready');
    expect(markup).toContain('Supported studio modes');
    expect(markup).toContain('exact active session and pedal-zone windows');
    expect(markup).toContain('Raw idle and private samples stay athlete-owned');
    expect(markup).toContain('default Club and Founder friendships');
    expect(markup).toContain('saved summaries only with explicit athlete consent');
    expect(markup).toContain('Live BPM sharing is off');
    expect(markup).toContain('explicit consent');
    expect(markup).toContain('Stop studio sharing');
    expect(markup).toContain('does not stop the athlete’s Apple Watch workout');
    expect(markup).not.toContain('Copy iPhone invite');
  });

  it('exposes an accessible alert with retry and cancel actions after failure', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockCard, {
      riderName: 'Mason Fleming',
      state: { phase: 'error', detail: 'The invitation expired before the athlete connected.' },
      ...actions,
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('The invitation expired');
    expect(markup).toContain('Retry');
    expect(markup).toContain('Cancel setup');
  });

  it('keeps disconnected setup explicit about paired-iPhone consent and raw idle privacy', () => {
    const markup = renderToStaticMarkup(createElement(StudioHeartRateBlockCard, {
      riderName: 'Mason Fleming',
      state: { phase: 'disconnected' },
      ...actions,
    }));

    expect(markup).toContain('Connect Apple Watch');
    expect(markup).toContain('approves this once on their paired iPhone');
    expect(markup).toContain('Raw idle and private samples stay athlete-owned');
    expect(markup).toContain('get no heart-rate access');
  });
});
