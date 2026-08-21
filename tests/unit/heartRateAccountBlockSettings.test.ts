import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  HeartRateAccountBlockSettings,
  heartRateAccountBlockCardState,
} from '../../src/components/HeartRateAccountBlockSettings';
import type { HeartRateAccountBlockStatus } from '../../src/lib/heartRateCloud';
import type { NativeHeartRateAvailability } from '../../src/lib/nativeHeartRate';

const iPhone: NativeHeartRateAvailability = {
  version: 1,
  supported: true,
  platform: 'iphone',
  paired: true,
  watchAppInstalled: true,
  healthDataAvailable: true,
  minimumIOS: '17.0',
  minimumWatchOS: '10.0',
};

const iPad: NativeHeartRateAvailability = {
  ...iPhone,
  supported: false,
  platform: 'ipad',
  reason: 'Continue on the paired iPhone.',
};

function block(overrides: Partial<HeartRateAccountBlockStatus> = {}): HeartRateAccountBlockStatus {
  return {
    pairingId: 'account-pairing-1',
    blockId: 'account-block-1',
    relayScope: 'account-block',
    state: 'waiting-watch',
    pairCodeExpiresAt: 20_000,
    ingestExpiresAt: null,
    effectiveExpiresAt: 100_000,
    claimedAt: null,
    revokedAt: null,
    stopRequestedAt: null,
    drainExpiresAt: null,
    streamStartedAt: null,
    streamEndedAt: null,
    lastSampleAt: null,
    lastSampleReceivedAt: null,
    freshUntil: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const actions = {
  onStartOnIPhone: vi.fn(),
  onCopyIPhoneHandoff: vi.fn(),
  onShareIPhoneHandoff: vi.fn(),
  onOpenIPhoneHandoff: vi.fn(),
  onStop: vi.fn(),
  onRetry: vi.fn(),
};

describe('HeartRateAccountBlockSettings', () => {
  it('offers Copy and Share on iPad but never claims it can open the paired iPhone remotely', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockSettings, {
      availability: iPad,
      block: null,
      relayState: null,
      action: { phase: 'idle' },
      ...actions,
    }));

    expect(markup).toContain('Copy iPhone handoff');
    expect(markup).toContain('Share iPhone handoff');
    expect(markup).not.toContain('Open iPhone handoff');
    expect(markup).not.toContain('Start on this iPhone');
  });

  it('offers direct Start and Open only in the native iPhone path', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockSettings, {
      availability: iPhone,
      block: null,
      relayState: null,
      action: { phase: 'idle' },
      ...actions,
    }));

    expect(markup).toContain('Start on this iPhone');
    expect(markup).toContain('Copy iPhone handoff');
    expect(markup).toContain('Open iPhone handoff');
    expect(markup).not.toContain('Share iPhone handoff');

    const unsupported = renderToStaticMarkup(createElement(HeartRateAccountBlockSettings, {
      availability: { ...iPhone, supported: false, reason: 'Apple Watch is not available.' },
      block: null,
      relayState: null,
      action: { phase: 'idle' },
      ...actions,
    }));
    expect(unsupported).not.toContain('Start on this iPhone');
    expect(unsupported).not.toContain('Open iPhone handoff');
  });

  it('hides one-use handoff actions after claim and waits for a fresh Watch sample', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateAccountBlockSettings, {
      availability: iPad,
      block: block({ claimedAt: 2_000 }),
      relayState: null,
      action: { phase: 'idle' },
      ...actions,
    }));

    expect(markup).toContain('Waiting for Apple Watch');
    expect(markup).toContain('waiting for a fresh Apple Watch sample');
    expect(markup).toContain('Stop');
    expect(markup).not.toContain('Copy iPhone handoff');
    expect(markup).not.toContain('Share iPhone handoff');
  });

  it('uses owner-safe server freshness for live and stopRequested for queued', () => {
    expect(heartRateAccountBlockCardState({
      availability: iPad,
      block: block({ state: 'live', claimedAt: 2_000, freshUntil: 12_000 }),
      relayState: null,
      action: { phase: 'idle' },
      now: 10_000,
    }).phase).toBe('live');
    expect(heartRateAccountBlockCardState({
      availability: iPhone,
      block: block({ stopRequestedAt: 8_000, drainExpiresAt: 20_000 }),
      relayState: null,
      action: { phase: 'idle' },
      now: 10_000,
    }).phase).toBe('queued');
  });
});
