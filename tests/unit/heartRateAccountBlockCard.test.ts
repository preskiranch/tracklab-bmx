import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  HeartRateAccountBlockCard,
  sanitizeHeartRateAccountBlockDisplayStatus,
} from '../../src/components/HeartRateAccountBlockCard';

const actions = {
  onStartOnIPhone: vi.fn(),
  onCopyIPhoneHandoff: vi.fn(),
  onShareIPhoneHandoff: vi.fn(),
  onOpenIPhoneHandoff: vi.fn(),
  onStop: vi.fn(),
  onRetry: vi.fn(),
};

describe('HeartRateAccountBlockCard', () => {
  it('explains the paired-iPhone, signed-in-device, and account-private model', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'idle' },
      ...actions,
    }));

    expect(markup).toContain('aria-label="Private Apple Watch heart-rate block"');
    expect(markup).toContain('Start on this iPhone');
    expect(markup).toContain('Copy iPhone handoff');
    expect(markup).toContain('Share iPhone handoff');
    expect(markup).toContain('Open iPhone handoff');
    expect(markup).toContain('including iPad');
    expect(markup).toContain('each exact session window');
    expect(markup).toContain('Raw heart-rate samples stay private');
    expect(markup).toContain('Clubs and Friends receive no live heart rate');
    expect(markup).not.toContain('Stop</button>');
  });

  it('distinguishes iPhone readiness from a live Watch sample', () => {
    const phoneReady = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'phone-ready' },
      ...actions,
    }));
    const waitingWatch = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'waiting-watch' },
      ...actions,
    }));

    expect(phoneReady).toContain('iPhone ready');
    expect(phoneReady).toContain('Confirm the TrackLab workout on Apple Watch');
    expect(waitingWatch).toContain('Waiting for Apple Watch');
    expect(waitingWatch).toContain('first fresh Watch sample');
    expect(waitingWatch).toContain('Stop');
    expect(waitingWatch).not.toContain('Apple Watch live');
  });

  it('marks starting as busy and queued sync as private without exposing incorrect actions', () => {
    const starting = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'starting' },
      ...actions,
    }));
    const queued = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'queued' },
      ...actions,
    }));

    expect(starting).toContain('aria-busy="true"');
    expect(starting).toContain('Starting');
    expect(starting).toContain('Stop');
    expect(queued).toContain('Private sync queued');
    expect(queued).toContain('queued on this iPhone for private cloud sync');
    expect(queued).toContain('Keep the TrackLab iPhone app installed and signed in until this status says Synced');
    expect(queued).not.toContain('safely queued');
    expect(queued).not.toContain('Start on this iPhone');
    expect(queued).not.toContain('Open iPhone handoff');
  });

  it('shows live only after a fresh Watch sample and offers a direct Stop action', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'live' },
      ...actions,
    }));

    expect(markup).toContain('Apple Watch live');
    expect(markup).toContain('private, exact TrackLab session windows');
    expect(markup).toContain('Stop');
    expect(markup).not.toContain('Copy iPhone handoff');
    expect(markup).not.toContain('Open iPhone handoff');
  });

  it('uses accessible alerts and Retry for unavailable and error states', () => {
    const unavailable = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'unavailable' },
      ...actions,
    }));
    const error = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'error' },
      ...actions,
    }));

    expect(unavailable).toContain('role="alert"');
    expect(unavailable).toContain('Continue on the paired iPhone');
    expect(unavailable).toContain('Retry');
    expect(error).toContain('role="alert"');
    expect(error).toContain('Connection needs attention');
    expect(error).toContain('Retry');
  });

  it('redacts links, labeled secrets, and opaque credentials from display-only status', () => {
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
    const unsafeDetail = `Retry https://tracklab.example/?token=${secret} bearer=${secret}`;
    const sanitized = sanitizeHeartRateAccountBlockDisplayStatus(unsafeDetail);
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockCard, {
      state: { phase: 'error', displayDetail: unsafeDetail },
      ...actions,
    }));

    expect(sanitized).toContain('[private link]');
    expect(sanitized).not.toContain(secret);
    expect(markup).not.toContain(secret);
    expect(markup).not.toContain('tracklab.example');
    expect(markup).not.toContain('token=');
  });
});
