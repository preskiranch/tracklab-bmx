import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClubOwnerTrainingPreparationDialog } from '../../src/components/ClubOwnerTrainingPreparationDialog';

const actions = {
  onHeartRateOpen: vi.fn(),
  onStart: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
};

describe('ClubOwnerTrainingPreparationDialog', () => {
  it('locks the reserved athlete/bike snapshots and makes optional Watch setup explicit before the gate', () => {
    const markup = renderToStaticMarkup(createElement(ClubOwnerTrainingPreparationDialog, {
      activityLabel: 'BMX Race',
      phase: 'ready',
      detail: 'Riders are locked.',
      riders: [
        { playerId: 1, riderName: 'Athlete One', bikeLabel: 'Bike 1', heartRatePhase: 'watch-ready' },
        { playerId: 2, riderName: 'Athlete Two', bikeLabel: 'Bike 2', heartRatePhase: 'waiting-athlete' },
      ],
      ...actions,
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Reserved club riders"');
    expect(markup).toContain('Athlete One');
    expect(markup).toContain('Bike 1');
    expect(markup).toContain('Watch ready');
    expect(markup).toContain('Athlete Two');
    expect(markup).toContain('Waiting for athlete');
    expect(markup).toContain('Apple Watch is optional');
    expect(markup).toContain('Continue without Apple Watch');
    expect(markup).toContain('Cancel preparation');
  });

  it('uses the direct race label only when every reserved athlete is Watch-ready', () => {
    const markup = renderToStaticMarkup(createElement(ClubOwnerTrainingPreparationDialog, {
      activityLabel: 'Straight Sprint',
      phase: 'ready',
      detail: 'Riders are locked.',
      riders: [
        { playerId: 1, riderName: 'Athlete One', heartRatePhase: 'watch-ready' },
        { playerId: 2, riderName: 'Athlete Two', heartRatePhase: 'watch-ready' },
      ],
      ...actions,
    }));

    expect(markup).toContain('Start Straight Sprint');
    expect(markup).not.toContain('Continue without Apple Watch');
  });

  it('announces reservation errors and exposes retry without enabling Start', () => {
    const markup = renderToStaticMarkup(createElement(ClubOwnerTrainingPreparationDialog, {
      activityLabel: 'BMX Race',
      phase: 'error',
      detail: 'Bike 3 is already reserved.',
      riders: [],
      ...actions,
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Bike 3 is already reserved.');
    expect(markup).toContain('Retry preparation');
    expect(markup).not.toContain('Start BMX Race');
  });

  it('shows owner-safe Watch Connect recognition without legacy invite controls', () => {
    const markup = renderToStaticMarkup(createElement(ClubOwnerTrainingPreparationDialog, {
      activityLabel: 'BMX Race',
      phase: 'ready',
      detail: 'Riders are locked.',
      riders: [
        {
          playerId: 1,
          riderName: 'Athlete One',
          bikeLabel: 'Bike 1',
          heartRatePhase: 'disconnected',
          watchConnectLabel: 'Recognized',
        },
        {
          playerId: 2,
          riderName: 'Athlete Two',
          bikeLabel: 'Bike 2',
          heartRatePhase: 'disconnected',
          watchConnectLabel: 'Connected · 3h 42m left',
        },
      ],
      watchConnectMode: true,
      ...actions,
    }));

    expect(markup).toContain('Recognized');
    expect(markup).toContain('Connected · 3h 42m left');
    expect(markup).toContain('paired iPhone');
    expect(markup).not.toContain('Disconnect Watch');
    expect(markup).not.toMatch(/Creating invite|Waiting for athlete|Waiting for Watch/iu);
  });
});
