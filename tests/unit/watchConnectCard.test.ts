import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WatchConnectCard } from '../../src/components/WatchConnectCard';

describe('WatchConnectCard', () => {
  it('offers one simple first-use action and explicit studio consent', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      context: 'studio',
      studioName: 'Preski Ranch',
      state: {
        phase: 'connect',
        connectedUntil: null,
        remainingMs: 0,
        detail: 'Press once to connect this Watch for four hours.',
      },
      onConnect: vi.fn(),
    }));

    expect(markup).toContain('Watch Connect');
    expect(markup).toContain('First time only');
    expect(markup).toContain('approve Apple Health');
    expect(markup).toContain('Training summaries');
    expect(markup).toContain('Required.');
    expect(markup).toContain('Live BPM');
    expect(markup).toContain('not raw heart-rate samples');
    expect(markup).not.toMatch(/invite|pairing|relay|QR/iu);
    expect(markup).toContain('disabled=""');
  });

  it('shows a connected countdown and explains bike-independent identity', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      context: 'studio',
      enrolled: true,
      state: {
        phase: 'connected',
        connectedUntil: Date.now() + 13_320_000,
        remainingMs: 13_320_000,
        detail: 'Ready for every TrackLab program during this four-hour session.',
      },
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onForgetWatch: vi.fn(),
    }));

    expect(markup).toContain('Connected · 3h 42m left');
    expect(markup).toContain('Ready all session');
    expect(markup).toContain('Disconnect');
    expect(markup).toContain('Forget Watch');
    expect(markup).toContain('claimed profile—not a bike or tablet');
    expect(markup).toContain('reconnecting a Wattbike does not end');
    expect(markup).not.toContain('Share with');
  });

  it('uses one press to reconnect after four hours without repeating setup', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      enrolled: true,
      state: {
        phase: 'ended',
        connectedUntil: Date.now() - 3_600_000,
        remainingMs: 0,
        detail: 'Press Watch Connect to start a new four-hour session. Setup does not repeat.',
      },
      onConnect: vi.fn(),
    }));

    expect(markup).toContain('Session ended');
    expect(markup).toContain('Watch Connect');
    expect(markup).toContain('setup will not repeat');
    expect(markup).not.toMatch(/invite|QR/iu);
  });

  it('renders only the simple progress state while connecting', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      enrolled: true,
      state: {
        phase: 'connecting',
        connectedUntil: null,
        remainingMs: 0,
        detail: 'Keep the paired iPhone and Apple Watch nearby while TrackLab connects.',
      },
      onConnect: vi.fn(),
    }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Connecting…');
    expect(markup).not.toContain('>Disconnect</button>');
  });

  it('lets an athlete with one studio switch Watch Connect back to My account', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      state: {
        phase: 'connect',
        connectedUntil: null,
        remainingMs: 0,
        detail: 'Press once to connect this Watch for four hours.',
      },
      targetOptions: [
        { value: 'personal', label: 'My account' },
        { value: 'club-one', label: 'Preski Ranch' },
      ],
      targetValue: 'club-one',
      onTargetChange: vi.fn(),
    }));
    expect(markup).toContain('Use with');
    expect(markup).toContain('My account');
    expect(markup).toContain('Preski Ranch');
    expect(markup).not.toMatch(/invite|pairing|relay|QR/iu);
  });

  it('gives an iPad a clear paired-iPhone instruction without a dead action', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      state: {
        phase: 'connect',
        connectedUntil: null,
        remainingMs: 0,
        detail: 'Open TrackLab on the paired iPhone and press Watch Connect.',
      },
    }));
    expect(markup).toContain('Open TrackLab on the paired iPhone');
    expect(markup).not.toContain('<button');
  });

  it('gives an iPhone a clear retry after showing the exact missing Watch app reason', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      state: {
        phase: 'connect',
        connectedUntil: null,
        remainingMs: 0,
        detail: 'Install the TrackLab BMX companion app on Apple Watch.',
      },
      onCheckAgain: vi.fn(),
      showWatchInstall: true,
    }));
    expect(markup).toContain('Install the TrackLab BMX companion app on Apple Watch.');
    expect(markup).toContain('Install Watch App');
    expect(markup).toContain('href="https://testflight.apple.com/"');
    expect(markup).toContain('scroll to Information, then tap Install beside Apple Watch');
    expect(markup).toContain('Check again');
    expect(markup).toContain('tabindex="-1"');
  });

  it('offers the same Watch Connect button if automatic reload recovery needs retry', () => {
    const markup = renderToStaticMarkup(createElement(WatchConnectCard, {
      athleteName: 'Mason Fleming',
      enrolled: true,
      retryWhileConnecting: true,
      state: {
        phase: 'connecting',
        connectedUntil: Date.now() + 14_400_000,
        remainingMs: 14_400_000,
        detail: 'Watch Connect needs another try.',
      },
      onConnect: vi.fn(),
    }));
    expect(markup).toContain('Watch Connect');
    expect(markup).toContain('class="primary"');
    expect(markup).not.toContain('aria-disabled="true"');
  });
});
