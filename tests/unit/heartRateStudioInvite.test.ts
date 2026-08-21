import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HeartRateStudioInviteDialog,
  studioHeartRateActivityLabel,
} from '../../src/components/HeartRateStudioInviteDialog';
import {
  HeartRateStudioInviteError,
  claimHeartRateStudioInvitationForWatch,
  defaultHeartRateStudioConsent,
  heartRateStudioInviteHandoffHref,
  heartRateStudioInviteUrlDisposition,
  loadHeartRateStudioInvitationPreview,
  normalizeHeartRateStudioConsent,
  parseHeartRateStudioInviteHref,
  preserveHeartRateStudioInviteInHref,
  removeHeartRateStudioInviteFromHref,
} from '../../src/lib/heartRateCloud';

afterEach(() => vi.unstubAllGlobals());

const preview = {
  clubName: 'Preski Ranch BMX',
  riderName: 'Mason Fleming',
  sessionId: 'monitor-sprint-session-1',
  activityType: 'monitor-sprint' as const,
  relayScope: 'studio-block' as const,
  playerId: 2,
  expiresAt: 2_000_000_000_000,
};

function pairing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pairing-1',
    sessionId: 'monitor-sprint-session-1',
    activityType: 'monitor-sprint',
    relayScope: 'studio-block',
    riderId: 'account:athlete-1',
    playerId: 2,
    clubId: 'club-1',
    studioRiderId: 'studio-rider-1',
    pairCodeExpiresAt: 2_000_000_000_000,
    expiresAt: 2_000_000_100_000,
    claimedAt: null,
    revokedAt: null,
    liveStudioConsent: false,
    sessionStudioConsent: false,
    ...overrides,
  };
}

describe('studio Apple Watch invitation URL handling', () => {
  it('parses and preserves the secure invitation through same-origin sign-in only', () => {
    expect(parseHeartRateStudioInviteHref(
      'https://tracklab.test/?heartRateStudioInvite=abcd-efgh&screen=login',
    )).toEqual({ present: true, inviteCode: 'ABCD-EFGH' });

    expect(preserveHeartRateStudioInviteInHref(
      '/sign-in?mode=login',
      'https://tracklab.test/?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('/sign-in?mode=login&heartRateStudioInvite=ABCD-EFGH');

    expect(preserveHeartRateStudioInviteInHref(
      'https://untrusted.test/sign-in',
      'https://tracklab.test/?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('https://untrusted.test/sign-in');
  });

  it('creates a clean iPhone handoff link and removes only the resolved invite parameter', () => {
    expect(heartRateStudioInviteHandoffHref(
      'https://tracklab.test/?friendInvite=do-not-forward#private',
      'ABCD-EFGH',
    )).toBe('https://tracklab.test/?heartRateStudioInvite=ABCD-EFGH');

    expect(removeHeartRateStudioInviteFromHref(
      '/?heartRateStudioInvite=ABCD-EFGH&speed=mph#settings',
    )).toBe('/?speed=mph#settings');
  });

  it('removes terminal links but preserves authentication, rate-limit, network, and server failures', () => {
    for (const status of [400, 403, 404, 409, 410, 422]) {
      expect(heartRateStudioInviteUrlDisposition(
        new HeartRateStudioInviteError('terminal', { status, urlDisposition: 'remove' }),
      )).toBe('remove');
    }
    for (const status of [401, 429, 500, 503]) {
      expect(heartRateStudioInviteUrlDisposition(
        new HeartRateStudioInviteError('retry', { status, urlDisposition: 'preserve' }),
      )).toBe('preserve');
    }
    expect(heartRateStudioInviteUrlDisposition(new TypeError('offline'))).toBe('preserve');
  });
});

describe('studio Apple Watch invitation cloud contract', () => {
  it('loads an authenticated, redacted preview without carrying identity or credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      invitation: {
        ...preview,
        athleteProfileKey: 'must-not-cross-client-boundary',
        inviteCodeHash: 'must-not-cross-client-boundary',
        ingestToken: 'must-not-cross-client-boundary',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadHeartRateStudioInvitationPreview(' abcd efgh ');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/studio-invitations/preview?code=ABCD-EFGH',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result).toEqual(preview);
    expect(result).not.toHaveProperty('athleteProfileKey');
    expect(result).not.toHaveProperty('inviteCodeHash');
    expect(result).not.toHaveProperty('ingestToken');
  });

  it('keeps both studio sharing choices exactly off unless the athlete checks them', () => {
    expect(defaultHeartRateStudioConsent).toEqual({
      liveStudioConsent: false,
      sessionStudioConsent: false,
      studioBlockConsent: false,
    });
    expect(normalizeHeartRateStudioConsent({
      liveStudioConsent: 'true' as unknown as boolean,
      sessionStudioConsent: 1 as unknown as boolean,
    })).toEqual(defaultHeartRateStudioConsent);
  });

  it('claims the invitation, immediately claims its pair code, and returns only the native relay credential', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pairing: pairing(),
        pairCode: 'JKLM-NPQR',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pairing: {
          id: 'pairing-1',
          sessionId: 'monitor-sprint-session-1',
          activityType: 'monitor-sprint',
          relayScope: 'studio-block',
          riderId: 'account:athlete-1',
          playerId: 2,
        },
        ingestToken: 'native-memory-only-ingest-token',
        ingestExpiresAt: 2_000_000_100_000,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await claimHeartRateStudioInvitationForWatch('ABCD-EFGH', {
      liveStudioConsent: false,
      sessionStudioConsent: true,
      studioBlockConsent: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/heart-rate/studio-invitations/claim');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      inviteCode: 'ABCD-EFGH',
      liveStudioConsent: false,
      sessionStudioConsent: true,
      studioBlockConsent: true,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/heart-rate/pairings/claim');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ pairCode: 'JKLM-NPQR' });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('native-memory-only-ingest-token');
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain('native-memory-only-ingest-token');
    expect(result).toMatchObject({
      pairing: { id: 'pairing-1', sessionId: 'monitor-sprint-session-1', relayScope: 'studio-block' },
      ingestToken: 'native-memory-only-ingest-token',
      ingestExpiresAt: 2_000_000_100_000,
    });
    expect(result).not.toHaveProperty('pairCode');
  });

  it('classifies an expired or already-used invitation as terminal URL state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'This invitation is invalid, expired, cancelled, already claimed, or belongs to another athlete.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));

    const error = await claimHeartRateStudioInvitationForWatch('ABCD-EFGH').catch((caught) => caught);
    expect(error).toBeInstanceOf(HeartRateStudioInviteError);
    expect(heartRateStudioInviteUrlDisposition(error)).toBe('remove');
  });
});

describe('studio Apple Watch invitation dialog copy', () => {
  const baseProps = {
    authenticated: true,
    currentHref: 'https://tracklab.test/?heartRateStudioInvite=ABCD-EFGH',
    inviteCode: 'ABCD-EFGH',
    onClose: vi.fn(),
    onConfigureNativeRelay: vi.fn(),
    onRequestSignIn: vi.fn(),
    open: true,
    preview,
  } as const;

  it.each([
    ['bmx-race', 'BMX Race Intervals'],
    ['straight-sprint', 'Straight Sprint'],
    ['get-pulled', 'Get Pulled'],
    ['explore', 'Explore the World'],
    ['monitor-sprint', 'Monitor'],
    ['training-block', 'Studio training block'],
  ] as const)('labels the %s activity safely', (activityType, expectedLabel) => {
    expect(studioHeartRateActivityLabel(activityType)).toBe(expectedLabel);
  });

  it('does not reflect an unsupported activity value into the interface', () => {
    expect(studioHeartRateActivityLabel('<script>unsafe</script>')).toBe('Studio training');
    expect(studioHeartRateActivityLabel(null)).toBe('Studio training');
  });

  it('labels and describes the modal for assistive technology', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateStudioInviteDialog, {
      ...baseProps,
      platform: 'iphone',
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="heart-rate-studio-invite-heading"');
    expect(markup).toContain('aria-describedby="heart-rate-studio-invite-privacy"');
    expect(markup).toContain('aria-label="Close heart-rate invitation"');
  });

  it('renders both optional session sharing choices unchecked and explains private friend access', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateStudioInviteDialog, {
      ...baseProps,
      platform: 'iphone',
      preview: { ...preview, relayScope: 'session' },
    }));

    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain('Both choices are off by default');
    expect(markup).toContain('default Club and Founder friendships');
    expect(markup).toContain('not raw samples');
    expect(markup).toContain('saved summaries only when you explicitly consent');
  });

  it('requires one explicit studio-block permission before the continuous Watch relay can connect', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateStudioInviteDialog, {
      ...baseProps,
      platform: 'iphone',
    }));

    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup).toContain('Record this studio training block and share saved studio summaries');
    expect(markup).toContain('exact active session and pedal-zone windows');
    expect(markup).toContain('Raw idle and private samples stay athlete-owned');
    expect(markup).toContain('up to 12 hours');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Connect Apple Watch for this studio block');
  });

  it('tells an iPad user to hand off to the athlete’s paired iPhone', () => {
    const markup = renderToStaticMarkup(createElement(HeartRateStudioInviteDialog, {
      ...baseProps,
      platform: 'ipad',
    }));

    expect(markup).toContain('Continue on the athlete’s iPhone');
    expect(markup).toContain('not directly with the studio iPad');
    expect(markup).toContain('Copy iPhone handoff link');
  });
});
